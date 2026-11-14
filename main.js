const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Keep in sync with VIDEO_EXTS in engine.py.
const VIDEO_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'mpg', 'mpeg', 'ts', 'mp3', 'wav', 'm4a', 'flac', 'ogg'];
const VIDEO_SET = new Set(VIDEO_EXTS);

// In a packaged build engine.py is unpacked next to app.asar (see "asarUnpack" in
// package.json), because Python can't read files from inside the asar archive.
const ENGINE = path.join(__dirname, 'engine.py')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// The installer writes the Python it found or installed to resources\python-path.txt
// (see build/installer.nsh). Fall back to "python" on PATH (development, or if
// that Python was removed later).
function pythonCmd() {
  try {
    const p = fs.readFileSync(path.join(process.resourcesPath, 'python-path.txt'), 'utf8').trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* not installed by the installer */ }
  return 'python';
}

let win, current = null, cancelled = false, running = false;

function createWindow() {
  win = new BrowserWindow({
    width: 860, height: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  // A file dropped outside the drop handler must never navigate the app away.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const isVideo = f => VIDEO_SET.has(path.extname(f).slice(1).toLowerCase());
// Same naming as Path.with_suffix() in engine.py: "movie.mp4" -> "movie.srt".
const stem = f => f.slice(0, f.length - path.extname(f).length);
const srtFor = f => stem(f) + '.srt';
const partialFor = f => stem(f) + '.partial.jsonl';
const stateFor = f => stem(f) + '.state.json';
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function listVideos(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && isVideo(d.name))
      .map(d => path.join(dir, d.name))
      .sort(byName);
  } catch {
    return [];
  }
}

// Turns dropped paths into video files: folders are expanded (top level only),
// non-video files are dropped.
function expandPaths(paths) {
  const out = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || !p) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...listVideos(p));
    else if (st.isFile() && isVideo(p)) out.push(p);
  }
  return out;
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(stateFor(file), 'utf8')); } catch { return null; }
}

function mergeState(file, fields) {
  try {
    const p = stateFor(file);
    fs.writeFileSync(p + '.tmp', JSON.stringify({ ...(readState(file) || {}), ...fields,
      updated: new Date().toISOString() }, null, 2));
    fs.renameSync(p + '.tmp', p);
  } catch { /* progress itself lives in the .partial.jsonl */ }
}

// Saved progress for one file, read from its .partial.jsonl and .state.json.
function inspect(file) {
  const state = readState(file);
  let segments = 0, lastTime = 0;
  try {
    for (const line of fs.readFileSync(partialFor(file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { lastTime = JSON.parse(line).end; segments++; } catch { break; }  // torn last line
    }
  } catch { /* no partial file */ }
  const duration = state?.duration || 0;
  return {
    status: state?.status || null,
    model: state?.model || null,
    language: state?.language || null,
    error: state?.error || null,
    duration,
    lastTime,
    segments,
    hasPartial: segments > 0,
    hasSrt: fs.existsSync(srtFor(file)),
    pct: segments && duration ? Math.min(lastTime / duration * 100, 99.9) : 0
  };
}

ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video/Audio', extensions: VIDEO_EXTS }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled || !r.filePaths.length ? null : listVideos(r.filePaths[0]);
});

ipcMain.handle('expand', (_, paths) => expandPaths(paths));

ipcMain.handle('inspect', (_, paths) => {
  const out = {};
  for (const p of Array.isArray(paths) ? paths : []) if (typeof p === 'string') out[p] = inspect(p);
  return out;
});

const OOM = /mkl_malloc|MemoryError|out of memory|bad_alloc|failed to allocate/i;

// One Python process per file: when it exits, the OS reclaims all of its memory.
function runOne(file, { model, lang, overwrite, restart, mismatch }) {
  return new Promise(resolve => {
    const args = ['-u', ENGINE, file, '--model', model, '--language', lang,
      '--resume-mismatch', mismatch];
    if (overwrite) args.push('--overwrite');
    if (restart) args.push('--restart');
    const p = spawn(pythonCmd(), args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    });
    current = p;

    let buf = '', err = '', failMsg = null, saved = false, skipped = false, settled = false;

    const handleLine = line => {
      const prog = line.match(/progress:\s*([\d.]+)%/);
      if (prog) { send('progress', { file, pct: parseFloat(prog[1]) }); return; }
      if (/^\s*saved /.test(line)) { saved = true; return; }
      if (/^\[\d+\/\d+\] .* - skipped \(subtitle already exists\)$/.test(line)) { skipped = true; return; }
      const fail = line.match(/^\s*FAILED:\s*(.*)$/);
      if (fail) failMsg = fail[1];
    };

    p.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop();
      lines.forEach(handleLine);
    });
    p.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); });

    const finish = result => {
      if (settled) return;
      settled = true;
      current = null;
      resolve(result);
    };

    p.on('error', e => finish({ state: 'error', error: e.message }));
    p.on('close', code => {
      if (buf) { handleLine(buf); buf = ''; }
      fs.rm(srtFor(file) + '.part', { force: true }, () => {});
      if (cancelled) return finish({ state: 'cancelled' });   // partial file is kept for resume
      if (skipped) return finish({ state: 'skipped' });
      if (saved && code === 0) return finish({ state: 'done' });

      // Hard crashes (e.g. mkl_malloc aborting the process) never reach Python's
      // exception handler, so record the failure here. The .partial.jsonl is kept.
      let error = failMsg || err.trim().split(/\r?\n/).pop() || `engine exited with code ${code}`;
      if (!failMsg && OOM.test(err)) error = 'Out of memory (progress saved, select again to resume)';
      mergeState(file, { status: 'failed', error });
      finish({ state: 'error', error });
    });
  });
}

// Saved progress was made with other settings: ask what to do.
async function askMismatch(file, info, model, lang) {
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Settings changed',
    message: `"${path.basename(file)}" was started with model "${info.model}" and language "${info.language}".`,
    detail: `You selected model "${model}" and language "${lang}". ` +
      `${Math.floor(info.pct)}% is already done with the old settings.`,
    buttons: ['Resume with previous settings', 'Restart from beginning', 'Skip this file'],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: 'Do the same for the remaining files',
    noLink: true
  });
  return { choice: ['resume', 'restart', 'skip'][r.response], all: r.checkboxChecked };
}

const SUMMARY_KEY = { done: 'done', error: 'failed', skipped: 'skipped', cancelled: 'cancelled' };
const MODEL_RE = /^[\w.-]+$/, LANG_RE = /^([a-z]{2,3}|auto)$/;

ipcMain.handle('run', async (_, opts) => {
  if (running) return null;
  const jobs = (Array.isArray(opts?.files) ? opts.files : [])
    .filter(j => j && typeof j.path === 'string' && j.path)
    .map(j => ({ path: j.path, restart: !!j.restart }));
  const model = MODEL_RE.test(opts?.model) ? opts.model : 'small';
  const lang = LANG_RE.test(opts?.lang) ? opts.lang : 'auto';
  const skipExisting = !!opts?.skipExisting;

  running = true;
  cancelled = false;
  const summary = { done: 0, failed: 0, skipped: 0, cancelled: 0 };
  let rememberedChoice = null;

  const report = (file, state, error) => {
    summary[SUMMARY_KEY[state]]++;
    send('status', { file, state, error });
  };

  for (const job of jobs) {
    if (cancelled) break;
    const file = job.path;
    const info = inspect(file);
    let runModel = model, runLang = lang, restart = job.restart;

    if (!restart) {
      if (!info.hasPartial && info.hasSrt && (info.status === 'done' || skipExisting)) {
        // Finished videos keep only their .srt; remove a leftover .state.json from older versions.
        if (info.status) fs.rm(stateFor(file), { force: true }, () => {});
        report(file, 'skipped');
        continue;
      }
      if (info.hasPartial && info.model && (info.model !== model || info.language !== lang)) {
        const ans = rememberedChoice || await askMismatch(file, info, model, lang);
        if (ans.all) rememberedChoice = ans;
        if (cancelled) break;
        if (ans.choice === 'skip') { report(file, 'skipped'); continue; }
        if (ans.choice === 'restart') restart = true;
        else if (MODEL_RE.test(info.model) && LANG_RE.test(info.language)) {
          runModel = info.model;
          runLang = info.language;
        }
      }
    }

    send('status', { file, state: 'running', resumePct: restart ? 0 : info.pct });
    const r = await runOne(file, {
      model: runModel, lang: runLang, overwrite: !skipExisting, restart, mismatch: 'continue'
    });
    report(file, r.state, r.error);
  }

  running = false;
  send('finished', summary);
  return summary;
});

ipcMain.on('cancel', () => {
  cancelled = true;
  if (current) current.kill();
});
