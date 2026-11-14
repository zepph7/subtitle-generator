const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
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

// ------------------------------------------------------------------ Python
// Which Python runs engine.py, checked at startup (see checkRequirements):
//   1. the app's private environment <userData>/python-env, created by the
//      "Install faster-whisper" button (works where pip into the system Python is
//      blocked, e.g. Ubuntu 23.04+, Debian 12, Homebrew)
//   2. Windows: the Python the installer found/installed (resources\python-path.txt)
//   3. python3 / python on PATH and the usual install locations. Mac apps started
//      from Finder don't get the terminal's PATH, so Homebrew and python.org
//      locations are listed explicitly.
const IS_WIN = process.platform === 'win32';
const MIN_PY = [3, 9];
const venvDir = () => path.join(app.getPath('userData'), 'python-env');
const venvPython = () => path.join(venvDir(), IS_WIN ? 'Scripts\\python.exe' : 'bin/python3');
// faster-whisper 1.2.x passes an option that PyAV 17+ removed, so a fresh
// "pip install faster-whisper" fails on every file. PyAV is pinned below 17, and a
// Python that has a newer PyAV is reported as needing repair.
const PIP_PACKAGES = ['faster-whisper', 'av<17'];
const PY_PROBE = [
  'import sys, json',
  'fw = False; broken = None',
  'try:',
  '    import faster_whisper, av',
  '    if int(av.__version__.split(".")[0]) >= 17:',
  '        broken = "PyAV " + av.__version__ + " is not compatible with faster-whisper " + faster_whisper.__version__',
  '    else:',
  '        fw = True',
  'except Exception:',
  '    pass',
  'print(json.dumps({"exe": sys.executable, "version": list(sys.version_info[:3]), "fw": fw,',
  '                  "broken": broken, "venv": sys.prefix != sys.base_prefix}))'
].join('\n');

let pythonExe = null;      // Python with faster-whisper, set by checkRequirements()
let basePython = null;     // a usable Python without faster-whisper (to create the venv from)
let installing = false;

function pythonCandidates() {
  const list = [venvPython()];
  if (IS_WIN) {
    try {
      const p = fs.readFileSync(path.join(process.resourcesPath, 'python-path.txt'), 'utf8').trim();
      if (p) list.push(p);
    } catch { /* not installed by the Windows installer */ }
    list.push('python', 'py');
  } else {
    list.push('python3',
      '/opt/homebrew/bin/python3',                                        // Homebrew, Apple Silicon
      '/usr/local/bin/python3',                                           // Homebrew Intel / python.org
      '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',// python.org
      '/usr/bin/python3',
      'python');
  }
  return [...new Set(list)];
}

function probe(cmd) {
  return new Promise(resolve => {
    if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) return resolve(null);
    execFile(cmd, ['-c', PY_PROBE], {
      timeout: 60000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).pop())); } catch { resolve(null); }
    });
  });
}

const versionOk = v => v[0] === MIN_PY[0] && v[1] >= MIN_PY[1];

function installHint() {
  if (process.platform === 'linux') {
    return 'Install Python 3 with your package manager, then click "Check again":\n' +
      '  Ubuntu / Debian / Mint:  sudo apt install python3 python3-venv\n' +
      '  Fedora:                  sudo dnf install python3\n' +
      '  Arch / Manjaro:          sudo pacman -S python';
  }
  if (process.platform === 'darwin') {
    return 'Install Python 3 from https://www.python.org/downloads/macos/\n' +
      'or, with Homebrew:  brew install python\n' +
      'then click "Check again".';
  }
  return 'Reinstall Subtitle Generator (its installer can install Python for you),\n' +
    'or install Python from https://www.python.org/downloads/ and tick\n' +
    '"Add python.exe to PATH", then click "Check again".';
}

async function checkRequirements() {
  pythonExe = null;
  basePython = null;
  let tooOld = null, broken = null;
  for (const cmd of pythonCandidates()) {
    const r = await probe(cmd);
    if (!r) continue;
    if (!versionOk(r.version)) { tooOld = tooOld || r; continue; }
    if (r.fw) {
      pythonExe = r.exe;
      return { ok: true, python: r.exe, version: r.version.join('.'), platform: process.platform };
    }
    if (r.broken && !broken) broken = r.broken;
    if (!r.venv && !basePython) basePython = r.exe;
  }
  return {
    ok: false,
    platform: process.platform,
    python: basePython,
    tooOld: tooOld ? `${tooOld.exe} (Python ${tooOld.version.join('.')})` : null,
    broken,
    minVersion: MIN_PY.join('.'),
    hint: installHint()
  };
}

// Runs a command, streaming its output to the setup panel. Resolves to { code, out }.
function runLogged(cmd, args) {
  return new Promise(resolve => {
    send('setupLog', `> ${path.basename(cmd)} ${args.join(' ')}`);
    let out = '', buf = '';
    const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const onData = d => {
      const s = d.toString();
      out += s;
      buf += s;
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) send('setupLog', l);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', e => resolve({ code: -1, out: e.message }));
    p.on('close', code => { if (buf.trim()) send('setupLog', buf); resolve({ code, out }); });
  });
}

// Creates <userData>/python-env and installs faster-whisper into it.
async function installRequirements() {
  if (installing) return { ok: false, error: 'An installation is already running.' };
  if (!basePython) await checkRequirements();
  if (pythonExe) return { ok: true };
  if (!basePython) return { ok: false, error: 'Python was not found.', hint: installHint() };

  installing = true;
  try {
    const dir = venvDir();
    send('setupLog', `Creating a private Python environment in ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });           // remove a broken earlier attempt
    let r = await runLogged(basePython, ['-m', 'venv', dir]);
    if (r.code !== 0) {
      const debianHint = /ensurepip|python3-venv/i.test(r.out)
        ? '\nOn Ubuntu/Debian install the venv module first:  sudo apt install python3-venv' : '';
      return { ok: false, error: 'Could not create the Python environment.' + debianHint };
    }
    send('setupLog', 'Installing faster-whisper (about 300 MB, this can take several minutes)...');
    await runLogged(venvPython(), ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', 'pip']);
    r = await runLogged(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', ...PIP_PACKAGES]);
    if (r.code !== 0) return { ok: false, error: 'pip could not install faster-whisper (see the log above).' };
    const check = await checkRequirements();
    if (!check.ok) return { ok: false, error: 'faster-whisper was installed but cannot be loaded.' };
    send('setupLog', 'Done. faster-whisper is ready.');
    return { ok: true, check };
  } finally {
    installing = false;
  }
}

function pythonCmd() {
  return pythonExe || (IS_WIN ? 'python' : 'python3');
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

ipcMain.handle('checkReqs', () => checkRequirements());
ipcMain.handle('installReqs', () => installRequirements());

ipcMain.handle('inspect', (_, paths) => {
  const out = {};
  for (const p of Array.isArray(paths) ? paths : []) if (typeof p === 'string') out[p] = inspect(p);
  return out;
});

const OOM = /mkl_malloc|MemoryError|out of memory|bad_alloc|failed to allocate/i;

// One Python process per file: when it exits, the OS reclaims all of its memory.
function runOne(file, { model, lang, words, overwrite, restart, mismatch }) {
  return new Promise(resolve => {
    const args = ['-u', ENGINE, file, '--model', model, '--language', lang,
      '--resume-mismatch', mismatch];
    if (words) args.push('--words', words);
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
  if (running || installing) return null;
  if (!pythonExe) await checkRequirements();
  const jobs = (Array.isArray(opts?.files) ? opts.files : [])
    .filter(j => j && typeof j.path === 'string' && j.path)
    .map(j => ({ path: j.path, restart: !!j.restart }));
  const model = MODEL_RE.test(opts?.model) ? opts.model : 'small';
  const lang = LANG_RE.test(opts?.lang) ? opts.lang : 'auto';
  const skipExisting = !!opts?.skipExisting;
  const words = typeof opts?.words === 'string'
    ? opts.words.replace(/\s+/g, ' ').trim().slice(0, 500) : '';

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
      model: runModel, lang: runLang, words, overwrite: !skipExisting, restart, mismatch: 'continue'
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
