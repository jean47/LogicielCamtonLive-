const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, session } = require('electron');
const { createSecretStore } = require('./secret-store.cjs');
const { createStreamEngine } = require('./stream-engine.cjs');
const { createUpdateService } = require('./update-service.cjs');
const { createDisplayCaptureService } = require('./display-capture.cjs');

const APP_ID = 'fr.camtonlive.desktop';
const isDevelopment = !app.isPackaged;
let mainWindow;
let isQuitting = false;
let secretStore;
let streamEngine;
let updateService;
let displayCapture;

function isTrustedUrl(url) {
  return isDevelopment
    ? url.startsWith('http://127.0.0.1:3000/')
    : url.startsWith('file://') && url.endsWith('/dist/index.html');
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url || '';
    if (!isTrustedUrl(senderUrl)) throw new Error('Origine de fenêtre non autorisée.');
    return handler(event, ...args);
  });
}

app.setAppUserModelId(APP_ID);
// Keep the former profile directory so existing LumaCast settings and encrypted keys remain available.
app.setPath('userData', path.join(app.getPath('appData'), 'LumaCast'));

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 920,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e12',
    title: `Camton Live ${app.getVersion()}`,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDevelopment
      ? url.startsWith('http://127.0.0.1:3000/')
      : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (isDevelopment) mainWindow.loadURL('http://127.0.0.1:3000');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return mainWindow;
}

function emitStreamStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream:status', status);
}

function emitUpdateState(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:state', status);
}

handleTrusted('desktop:list-capture-sources', async () => {
  const sources = await displayCapture.listSources();
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
  }));
});
handleTrusted('desktop:select-capture-source', (_event, sourceId) => displayCapture.selectSource(sourceId));

handleTrusted('credentials:get-status', () => secretStore.getStatus());
handleTrusted('credentials:save', (_event, platform, values) => secretStore.save(platform, values));
handleTrusted('credentials:clear', (_event, platform) => secretStore.clear(platform));
handleTrusted('credentials:reset', () => secretStore.reset());

handleTrusted('stream:start', async (_event, options) => {
  const platforms = Array.isArray(options?.platforms) ? options.platforms : [];
  const credentials = await secretStore.getForStreaming(platforms);
  return streamEngine.start({
    platforms,
    profileName: options?.profileName,
    credentials,
  });
});
handleTrusted('stream:chunk', (_event, chunk) => streamEngine.pushChunk(chunk));
handleTrusted('stream:stop', () => streamEngine.stop());
handleTrusted('updates:get-state', () => updateService.getState());
handleTrusted('updates:download', () => updateService.download());
handleTrusted('updates:install', () => updateService.install());

app.whenReady().then(() => {
  secretStore = createSecretStore({ app, safeStorage });
  streamEngine = createStreamEngine({ app, emit: emitStreamStatus });
  updateService = createUpdateService({
    app,
    emit: emitUpdateState,
    getIsStreaming: () => streamEngine?.isActive() || false,
  });
  displayCapture = createDisplayCaptureService({
    desktopCapturer,
    session: session.defaultSession,
    isTrustedRequest: (request) => isTrustedUrl(request.frame?.url || ''),
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = isTrustedUrl(webContents.getURL());
    const mediaPermission = permission === 'media'
      && (details?.mediaTypes || []).some((type) => type === 'audio' || type === 'video');
    callback(trusted && (mediaPermission || permission === 'display-capture'));
  });

  createMainWindow();
  const updateCheckTimer = setTimeout(() => updateService.check(), 5000);
  updateCheckTimer.unref();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', (event) => {
  if (!isQuitting && streamEngine?.isActive()) {
    event.preventDefault();
    isQuitting = true;
    streamEngine.stop().finally(() => app.quit());
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
