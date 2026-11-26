const { contextBridge, ipcRenderer } = require('electron');

function onStreamStatus(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('stream:status', listener);
  return () => ipcRenderer.removeListener('stream:status', listener);
}

function onUpdateState(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('updates:state', listener);
  return () => ipcRenderer.removeListener('updates:state', listener);
}

contextBridge.exposeInMainWorld('lumaCastDesktop', Object.freeze({
  isDesktopApp: true,
  listCaptureSources: () => ipcRenderer.invoke('desktop:list-capture-sources'),
  selectCaptureSource: (sourceId) => ipcRenderer.invoke('desktop:select-capture-source', sourceId),
  getCredentialStatus: () => ipcRenderer.invoke('credentials:get-status'),
  saveCredentials: (platform, values) => ipcRenderer.invoke('credentials:save', platform, values),
  clearCredentials: (platform) => ipcRenderer.invoke('credentials:clear', platform),
  resetCredentials: () => ipcRenderer.invoke('credentials:reset'),
  startStream: (options) => ipcRenderer.invoke('stream:start', options),
  pushChunk: (chunk) => ipcRenderer.invoke('stream:chunk', chunk),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  onStreamStatus,
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState,
}));
