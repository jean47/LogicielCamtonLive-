const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, session, shell } = require('electron');
const { createSecretStore } = require('./secret-store.cjs');
const { createStreamEngine } = require('./stream-engine.cjs');
const { createUpdateService } = require('./update-service.cjs');
const { createDisplayCaptureService } = require('./display-capture.cjs');
const { createRecorder } = require('./recorder.cjs');
const { createBugReporter } = require('./bug-report.cjs');
const { measureUpload } = require('./speed-test.cjs');

const APP_ID = 'fr.camtonlive.desktop';
// Une mise à jour peut relancer l'application alors qu'une instance est déjà en
// train de démarrer : deux instances écriraient dans le même stockage chiffré.
const singleInstance = app.requestSingleInstanceLock();
const isDevelopment = !app.isPackaged;
let mainWindow;
let isQuitting = false;
let secretStore;
let streamEngine;
let updateService;
let displayCapture;
let recorder;
let bugReporter;
// Les erreurs du renderer n'apparaissent nulle part dans une version empaquetée :
// on les garde pour le rapport de problème, sinon un écran incomplet reste muet.
const rendererIssues = [];

function recordRendererIssue(payload) {
  const level = String(payload?.level ?? '');
  if (!/error|warning/i.test(level)) return;
  const text = String(payload?.message || '').trim().slice(0, 400);
  if (!text) return;
  rendererIssues.push(`${level} : ${text}`);
  if (rendererIssues.length > 20) rendererIssues.shift();
}

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
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.removeMenu();
  // Electron 37+ passe un objet, les versions précédentes des arguments séparés.
  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (event && typeof event === 'object' && 'message' in event) recordRendererIssue(event);
    else recordRendererIssue({ level: Number(level) >= 3 ? 'error' : 'warning', message });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recordRendererIssue({ level: 'error', message: `processus de rendu arrêté (${details?.reason || 'inconnu'})` });
  });

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

function emitRecordingState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('record:state', state);
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
handleTrusted('record:start', () => recorder.start());
handleTrusted('record:chunk', (_event, chunk) => recorder.push(chunk));
handleTrusted('record:stop', () => recorder.stop());
handleTrusted('record:discard', () => recorder.discard());
handleTrusted('record:convert', (_event, filePath, durationMs) => recorder.convert(filePath, durationMs));
handleTrusted('record:reveal', (_event, filePath) => {
  const { path: target } = recorder.reveal(filePath);
  shell.showItemInFolder(target);
  return true;
});
handleTrusted('record:directory', () => recorder.directory());
handleTrusted('speed:measure', () => measureUpload());
handleTrusted('report:save', async (_event, input) => {
  const diagnostics = streamEngine.getDiagnostics();
  const outputs = Array.isArray(diagnostics.outputs) ? diagnostics.outputs : [];
  const stderr = outputs.flatMap((output) => output.stderr || []);
  if (Array.isArray(diagnostics.lastSession?.stderr)) stderr.push(...diagnostics.lastSession.stderr);
  return bugReporter.save({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    encoder: diagnostics.encoder ? `${diagnostics.encoder.name} (${diagnostics.encoder.label})` : 'inconnu',
    activeOutputs: outputs.map((output) => output.platform).join(', ') || 'aucune',
    description: input?.description,
    stderr,
    rendererIssues: [...rendererIssues],
  });
});
handleTrusted('report:open-issue', (_event, input) => bugReporter.openIssue({
  version: app.getVersion(),
  description: input?.description,
}));
// L'installateur écrit la version qu'il vient de copier. Si elle diffère de celle
// qui tourne, la copie a été partielle : c'est le seul moyen de le voir depuis
// l'application, et c'est ce qui produit des écrans à moitié dessinés.
handleTrusted('app:install-check', () => {
  const running = app.getVersion();
  const marker = path.join(path.dirname(app.getPath('exe')), 'version-installee.txt');
  let installed = null;
  try {
    installed = require('node:fs').readFileSync(marker, 'utf8').trim() || null;
  } catch {
    installed = null;
  }
  const consistent = !installed || installed === running;
  if (!consistent) recordRendererIssue({ level: 'error', message: `installation partielle : ${installed} installé, ${running} lancé` });
  return { running, installed, consistent };
});
handleTrusted('updates:get-state', () => updateService.getState());
handleTrusted('updates:check', () => updateService.check());
handleTrusted('updates:download', () => updateService.download());
handleTrusted('updates:install', () => updateService.install());
handleTrusted('updates:reveal-installer', () => updateService.revealInstaller());

// Un direct ou un enregistrement en cours interdit toute mise à jour : elle
// fermerait l'application au milieu d'une capture.
function isBusy() {
  return Boolean(streamEngine?.isActive()) || Boolean(recorder?.isRecording());
}

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  secretStore = createSecretStore({ app, safeStorage });
  streamEngine = createStreamEngine({ app, emit: emitStreamStatus });
  updateService = createUpdateService({
    app,
    emit: (state) => {
      emitUpdateState(state);
      // Téléchargement automatique : l'utilisateur n'a plus rien à cliquer, seule
      // l'installation au prochain démarrage reste, et elle est silencieuse aussi.
      if (state.status === 'available' && !isBusy()) {
        updateService.download().catch(() => {});
      }
    },
    getIsStreaming: () => isBusy(),
    revealInFolder: (filePath) => shell.showItemInFolder(filePath),
  });
  recorder = createRecorder({ app, emit: emitRecordingState });
  bugReporter = createBugReporter({ app, openExternal: (url) => shell.openExternal(url) });
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
  // Installateur déjà téléchargé et vérifié : on l'applique au démarrage, sans
  // demande. L'installateur relance lui-même l'application, donc l'utilisateur
  // retrouve Camton Live en nouvelle version. Un échec précédent est respecté :
  // dans ce cas la bannière propose de réessayer à la main.
  const autoInstallTimer = setTimeout(async () => {
    const snapshot = updateService.getState();
    if (snapshot.status !== 'downloaded' || snapshot.lastInstallFailed || isBusy()) return;
    try {
      await updateService.install();
    } catch {
      // La bannière reste disponible avec le bouton d'installation.
    }
  }, 8000);
  autoInstallTimer.unref?.();
  // Une vérification ratée au démarrage ne doit pas condamner la session entière :
  // on repasse toutes les six heures, sans toucher à un téléchargement en cours.
  const updatePollTimer = setInterval(() => {
    const { status } = updateService.getState();
    if (['idle', 'up-to-date', 'unavailable', 'available'].includes(status)) updateService.check();
  }, 6 * 60 * 60 * 1000);
  updatePollTimer.unref?.();
  updateCheckTimer.unref();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', (event) => {
  const streaming = streamEngine?.isActive();
  const recording = recorder?.isRecording();
  if (!isQuitting && (streaming || recording)) {
    event.preventDefault();
    isQuitting = true;
    Promise.all([
      streaming ? streamEngine.stop() : null,
      recording ? recorder.stop() : null,
    ]).finally(() => app.quit());
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
