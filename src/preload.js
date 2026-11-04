const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('runon', {
  platform: process.platform,
  setTheme: invoke('theme:set'),
  listEntries: invoke('entries:list'),
  createEntry: invoke('entries:create'),
  readEntry: invoke('entries:read'),
  saveEntrySync: (filename, text) => ipcRenderer.sendSync('entries:saveSync', filename, text),
  deleteEntry: invoke('entries:delete'),
  exportPdf: invoke('entries:exportPdf'),
  openFolder: invoke('folder:open'),
  openChat: invoke('chat:open'),
  copyText: invoke('clipboard:write'),
  requestMediaAccess: invoke('media:access'),
  openPrivacySettings: invoke('settings:openPrivacy'),
  toggleFullscreen: invoke('window:toggleFullscreen'),
  beginRecording: invoke('video:begin'),
  writeRecordingChunk: invoke('video:chunk'),
  abortRecording: invoke('video:abort'),
  finishRecording: invoke('video:finish'),
  onFullscreenChange: (callback) => ipcRenderer.on('fullscreen', (_event, value) => callback(value)),
  onNewEntry: (callback) => ipcRenderer.on('menu:newEntry', () => callback()),
});
