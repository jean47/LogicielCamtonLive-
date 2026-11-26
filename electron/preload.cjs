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

function onRecordingState(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('record:state', listener);
  return () => ipcRenderer.removeListener('record:state', listener);
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
  startRecording: () => ipcRenderer.invoke('record:start'),
  pushRecordingChunk: (chunk) => ipcRenderer.invoke('record:chunk', chunk),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  discardRecording: () => ipcRenderer.invoke('record:discard'),
  convertRecording: (filePath, durationMs) => ipcRenderer.invoke('record:convert', filePath, durationMs),
  revealRecording: (filePath) => ipcRenderer.invoke('record:reveal', filePath),
  getRecordingDirectory: () => ipcRenderer.invoke('record:directory'),
  onRecordingState,
  measureUpload: () => ipcRenderer.invoke('speed:measure'),
  saveBugReport: (input) => ipcRenderer.invoke('report:save', input),
  openBugIssue: (input) => ipcRenderer.invoke('report:open-issue', input),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState,
}));
