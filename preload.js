const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = ['progress', 'status', 'finished'];

contextBridge.exposeInMainWorld('api', {
  pick: () => ipcRenderer.invoke('pick'),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  // Expands dropped folders and filters out non-video files (done in main).
  expand: paths => ipcRenderer.invoke('expand', paths),
  // Saved progress (.state.json / .partial.jsonl / .srt) for each path.
  inspect: paths => ipcRenderer.invoke('inspect', paths),
  // File.path was removed in Electron 32; this is the supported replacement.
  pathForFile: file => webUtils.getPathForFile(file),
  run: o => ipcRenderer.invoke('run', o),
  cancel: () => ipcRenderer.send('cancel'),
  on: (ch, cb) => {
    if (CHANNELS.includes(ch)) ipcRenderer.on(ch, (_, d) => cb(d));
  }
});
