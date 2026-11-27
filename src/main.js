import { LIVE_PROFILES, PLATFORM_DETAILS, PLATFORM_IDS, captureConstraints } from './platforms.js';
import { createCompositor } from './compositor.js';
import { createAudioDesk } from './audio-desk.js';
import releaseNotes from './release-notes.json';
import { parseNotes, shouldAnnounce } from './whats-new.js';
import { describeMeasurement } from './speed-verdict.js';
import './styles/index.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const desktop = window.lumaCastDesktop;

function readArray(key, fallbackKey = null) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || (fallbackKey ? localStorage.getItem(fallbackKey) : 'null') || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const storedPlatforms = readArray('lumacast-platforms', 'sf-platforms').filter((id) => PLATFORM_IDS.includes(id));
const state = {
  sourceTab: 'pc',
  sourceStream: null,
  timerInterval: null,
  demoStartedAt: null,
  demoRunning: false,
  selectedPlatforms: new Set(storedPlatforms),
  quality: localStorage.getItem('lumacast-quality') || localStorage.getItem('sf-quality') || 'balanced',
  credentialStatus: { available: false, twitch: false, youtube: false, tiktok: false, relay: false },
  streamStatuses: {},
  isStreaming: false,
  isStarting: false,
  stopRequested: false,
  mediaRecorder: null,
  mixedStream: null,
  auxAudioStream: null,
  chunkQueue: Promise.resolve(),
  compositor: null,
  overlayStream: null,
  sceneEnabled: false,
  overlayCorner: 'br',
  overlayScale: 0.22,
  recording: false,
  recordRecorder: null,
  recordQueue: Promise.resolve(),
  recordBytes: 0,
  recordStartedAt: 0,
  recordingTimer: null,
  lastRecording: null,
  converting: false,
  queuedBytes: 0,
  toastTimer: null,
  modalCleanup: null,
  removeStreamListener: null,
  updateStatus: { status: 'idle', latestVersion: null, releaseNotes: '', progress: 0 },
  updateDismissed: false,
  removeUpdateListener: null,
};

const audioDesk = createAudioDesk({
  listElement: $('#audioTracks'),
  master: { volume: $('#masterVolume'), mute: $('#masterMuted'), meter: $('#masterLevel') },
  onStatus: ({ active, micReady }) => {
    state.audioStatus = { active, micReady };
    $('#audioSectionStatus').innerHTML = micReady
      ? `<span class="status-dot ready"></span> ${active > 1 ? `${active} pistes actives` : 'Micro actif'}`
      : '<span class="status-dot muted"></span> Micro à activer';
  },
  onError: (error, noun) => showMediaError(error, noun),
  onToast: (message, type) => showToast(message, type),
});

const SEEN_VERSION_KEY = 'camton-seen-version';

function showWhatsNew({ version, notes, eyebrow = 'NOUVEAUTÉS' }) {
  const items = Array.isArray(notes) ? notes : parseNotes(notes);
  if (!items.length) return false;
  showModal({
    title: `Quoi de neuf dans la ${version}`,
    eyebrow,
    body: 'Voici ce qui change dans cette version. Tes réglages restent en place.',
    items,
    mark: '✦',
    action: 'Découvrir',
  });
  return true;
}

function announceWhatsNew() {
  if (!shouldAnnounce({ currentVersion: releaseNotes.version, lastSeenVersion: localStorage.getItem(SEEN_VERSION_KEY) })) return;
  const shown = showWhatsNew({ version: releaseNotes.version, notes: releaseNotes.notes });
  if (shown) localStorage.setItem(SEEN_VERSION_KEY, releaseNotes.version);
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  $('#toastText').textContent = message;
  $('.toast-mark', toast).textContent = type === 'warning' ? '!' : '✓';
  toast.classList.toggle('toast-warning', type === 'warning');
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const IS_BETA = /^0\./.test(APP_VERSION);

function versionLabel() {
  if (!APP_VERSION) return 'Bêta';
  return IS_BETA ? `Bêta ${APP_VERSION}` : APP_VERSION;
}

function renderAppVersion() {
  const label = versionLabel();
  for (const selector of ['#appVersion', '#appVersionPill']) {
    const target = $(selector);
    if (target) target.textContent = label;
  }
}

function renderUpdateNotice(update = state.updateStatus) {
  state.updateStatus = update || state.updateStatus;
  const notice = $('#updateNotice');
  if (!desktop?.isDesktopApp || state.updateDismissed || !['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.updateStatus.status)) {
    notice.classList.add('hidden');
    return;
  }
  const status = state.updateStatus.status;
  const version = state.updateStatus.latestVersion ? ` · ${state.updateStatus.latestVersion}` : '';
  const action = $('#updateAction');
  const progress = $('#updateProgressTrack');
  $('#updateTitle').textContent = status === 'downloading' ? 'Téléchargement de la mise à jour' : status === 'downloaded' ? 'Mise à jour prête' : status === 'installing' ? 'Installation en cours' : `Mise à jour disponible${version}${IS_BETA ? ' bêta' : ''}`;
  progress.classList.toggle('hidden', status !== 'downloading' || !Number.isFinite(state.updateStatus.progress));
  if (status === 'downloading') {
    const percent = Number.isFinite(state.updateStatus.progress) ? state.updateStatus.progress : null;
    $('#updateMessage').textContent = percent === null ? 'Téléchargement en cours…' : `Téléchargement en cours… ${percent} %`;
    if (percent !== null) $('#updateProgressBar').style.width = `${percent}%`;
    action.textContent = 'Téléchargement…';
    action.disabled = true;
  } else if (status === 'downloaded') {
    const echec = state.updateStatus.lastInstallFailed;
    $('#updateMessage').textContent = state.isStreaming
      ? 'Le fichier est vérifié. Arrête ton direct pour pouvoir l’installer sans interruption.'
      : echec
        ? 'La dernière installation n’a pas abouti. Réessaie, ou ouvre le dossier et lance le fichier à la main.'
        : 'Le fichier est vérifié. Installe maintenant et Camton Live redémarrera après la mise à jour.';
    action.textContent = state.isStreaming ? 'Arrête le direct pour installer' : 'Installer et redémarrer';
    action.disabled = state.isStreaming;
  } else if (status === 'installing') {
    $('#updateMessage').textContent = 'Camton Live va se fermer puis se rouvrir avec la nouvelle version.';
    action.textContent = 'Fermeture…';
    action.disabled = true;
  } else if (status === 'error') {
    $('#updateMessage').textContent = state.updateStatus.errorMessage || 'Le téléchargement a échoué. Réessaie quand ta connexion sera rétablie.';
    action.textContent = 'Réessayer';
    action.disabled = false;
  } else {
    const notes = state.updateStatus.releaseNotes?.trim();
    $('#updateMessage').textContent = notes || 'Une nouvelle version est prête à être téléchargée.';
    action.textContent = 'Télécharger la mise à jour';
    action.disabled = false;
  }
  $('#updateNotes').classList.toggle('hidden', !state.updateStatus.releaseNotes?.trim());
  $('#updateReveal').classList.toggle('hidden', !(status === 'downloaded' || state.updateStatus.lastInstallFailed));
  $('#updateDismiss').classList.toggle('hidden', status === 'downloading' || status === 'installing');
  notice.classList.remove('hidden');
}

async function handleUpdateAction() {
  const status = state.updateStatus.status;
  try {
    if (status === 'downloaded') {
      await desktop.installUpdate();
    } else if (status === 'available' || status === 'error') {
      await desktop.downloadUpdate();
    }
  } catch (error) {
    state.updateStatus = { ...state.updateStatus, status: 'error', errorMessage: error?.message || 'Impossible de lancer la mise à jour.' };
    renderUpdateNotice();
  }
}

function showModal({ title, eyebrow = 'À SAVOIR', body, items = [], sections = [], mark = 'i', action = 'J’ai compris' }) {
  if (state.modalCleanup) {
    state.modalCleanup();
    state.modalCleanup = null;
  }
  $('#modalTitle').textContent = title;
  $('#modalEyebrow').textContent = eyebrow;
  $('#modalMark').textContent = mark;
  $('#modalOk').textContent = action;
  $('#modalOk').classList.remove('hidden');
  const copy = $('#modalCopy');
  copy.replaceChildren();
  if (body) {
    const intro = document.createElement('p');
    intro.textContent = body;
    copy.append(intro);
  }
  for (const section of sections) {
    const heading = document.createElement('h4');
    heading.className = 'modal-section-title';
    heading.textContent = section.title;
    copy.append(heading);
    if (section.text) {
      const paragraph = document.createElement('p');
      paragraph.textContent = section.text;
      copy.append(paragraph);
    }
    if (section.items?.length) {
      const list = document.createElement('ul');
      for (const item of section.items) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      copy.append(list);
    }
  }
  if (items.length) {
    const list = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      list.append(li);
    }
    copy.append(list);
  }
  $('#modalBackdrop').classList.add('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
  $('#modalClose').focus();
}

function closeModal() {
  if (state.modalCleanup) {
    state.modalCleanup();
    state.modalCleanup = null;
  }
  $('#modalBackdrop').classList.remove('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'true');
}

function showDesktopSourcePicker(sources) {
  $('#modalTitle').textContent = 'Choisis ton écran ou ta fenêtre';
  $('#modalEyebrow').textContent = 'SOURCE PC';
  $('#modalMark').textContent = '▣';
  $('#modalOk').classList.add('hidden');
  const copy = $('#modalCopy');
  copy.replaceChildren();
  const intro = document.createElement('p');
  intro.textContent = 'Sélectionne uniquement la fenêtre ou l’écran que tu veux afficher dans ton aperçu.';
  copy.append(intro);
  const grid = document.createElement('div');
  grid.className = 'source-picker-grid';
  sources.forEach((source) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-choice-card';
    const thumbnail = document.createElement('img');
    thumbnail.alt = '';
    thumbnail.src = source.thumbnail || '';
    thumbnail.classList.toggle('missing-thumbnail', !source.thumbnail);
    const name = document.createElement('span');
    name.className = 'source-choice-name';
    name.textContent = source.name;
    const kind = document.createElement('small');
    kind.textContent = source.id.startsWith('screen:') ? 'ÉCRAN' : 'FENÊTRE';
    button.append(thumbnail, name, kind);
    button.addEventListener('click', () => {
      closeModal();
      startDesktopCapture(source);
    });
    grid.append(button);
  });
  copy.append(grid);
  $('#modalBackdrop').classList.add('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
  grid.querySelector('button')?.focus();
}

function setSourceStatus(message, active = false) {
  $('#sourceStatus').textContent = message;
  $('#sourceDot').classList.toggle('active', active);
  $('#sourceDot').classList.toggle('muted', !active);
  $('#sourceSectionStatus').innerHTML = active
    ? '<span class="status-dot ready"></span> Source active'
    : '<span class="status-dot muted"></span> À configurer';
}

function stopTracks(stream) {
  if (stream) stream.getTracks().forEach((track) => track.stop());
}

function stopSource({ stopMic = true, stopScene = true } = {}) {
  if (state.recording) stopRecordingSession();
  if (stopScene) {
    if (state.overlayStream) stopOverlayCamera();
    if (state.compositor) {
      state.compositor.dispose();
      state.compositor = null;
      state.sceneEnabled = false;
    }
  }
  stopTracks(state.sourceStream);
  stopTracks(state.auxAudioStream);
  state.sourceStream = null;
  state.auxAudioStream = null;
  $('#previewVideo').srcObject = null;
  $('#previewFrame').classList.remove('has-video');
  $('#previewOverlay').classList.remove('visible');
  $('#previewPlaceholder').classList.remove('hidden');
  $('#previewTag').classList.remove('active');
  $('#previewTag').innerHTML = '<i></i> APERÇU INACTIF';
  $('#resolutionLabel').textContent = '— × — · — FPS';
  audioDesk.setSourceStream(null);
  setSourceStatus('Aucune source sélectionnée', false);
  if (stopMic) audioDesk.releaseCaptures();
}

function showMediaError(error, noun = 'la source vidéo') {
  let explanation = `L’application n’a pas pu accéder à ${noun}. Vérifie les autorisations Windows et que l’appareil n’est pas déjà utilisé.`;
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    explanation = 'La capture a été refusée ou interrompue. Choisis de nouveau l’écran ou la fenêtre dans Camton Live. Si le problème persiste, ferme les autres applications de capture et vérifie les paramètres de confidentialité de Windows.';
  } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    explanation = 'Aucun appareil compatible n’a été trouvé. Branche la carte de capture ou le micro, puis réessaie.';
  } else if (error?.name === 'NotReadableError') {
    explanation = 'L’appareil semble déjà utilisé par une autre application. Ferme-la puis réessaie.';
  }
  showModal({ title: `Impossible d’accéder à ${noun}`, eyebrow: 'AUTORISATION APPAREIL', body: explanation, mark: '!', action: 'Compris' });
}

async function startPreview(stream, label) {
  if (state.isStreaming) await stopLive();
  stopSource({ stopScene: false });
  state.sourceStream = stream;
  const video = $('#previewVideo');
  video.srcObject = stream;
  if (state.sceneEnabled) {
    const compositor = ensureCompositor();
    compositor.setMain(stream);
    compositor.setOverlay(state.overlayStream, { corner: state.overlayCorner, scale: state.overlayScale });
    applySceneStream();
  }
  $('#previewPlaceholder').classList.add('hidden');
  $('#previewFrame').classList.add('has-video');
  $('#previewOverlay').classList.add('visible');
  $('#previewSourceName').textContent = label.toUpperCase();
  $('#previewTag').classList.add('active');
  $('#previewTag').innerHTML = '<i></i> APERÇU ACTIF';
  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings?.() || {};
  const width = settings.width || 0;
  const height = settings.height || 0;
  const fps = settings.frameRate ? Math.round(settings.frameRate) : 30;
  $('#resolutionLabel').textContent = width && height ? `${width} × ${height} · ${fps} FPS` : `Aperçu local · ${fps} FPS`;
  setSourceStatus(`${label} — aperçu en cours`, true);
  const sourceAudio = await audioDesk.setSourceStream(stream);
  videoTrack?.addEventListener('ended', () => {
    if (state.sourceStream !== stream) return;
    if (state.isStreaming) {
      showToast('Le partage de la source s’est arrêté; le direct est fermé.', 'warning');
      stopLive({ fromFailure: true });
      return;
    }
    stopSource();
    showToast('Le partage de la source a été arrêté.', 'warning');
  }, { once: true });
  $('#readinessText').textContent = 'Aperçu local prêt. Configure une destination et vérifie ton micro pour diffuser.';
  $('#navSourceCheck').textContent = '✓';
  $('#navSourceCheck').classList.add('done');
  if (stream.getAudioTracks().length) {
    showToast(sourceAudio
      ? 'Aperçu local activé avec le son système. Rien n’est encore envoyé aux plateformes.'
      : 'Aperçu actif, mais le son système n’a pas pu être ajouté au mixage. Le micro fonctionne quand même.',
      sourceAudio ? 'info' : 'warning');
  } else {
    showToast('Aperçu local activé sans son de la source. Rien n’est encore envoyé aux plateformes.', 'warning');
  }
  await video.play().catch(() => {});
}

async function loadDevices({ requestPermission = false } = {}) {
  const captureSelect = $('#captureCardSelect');
  if (!navigator.mediaDevices?.enumerateDevices) {
    showToast('La détection nécessite une version récente de Windows et de l’application.', 'warning');
    return;
  }
  if (requestPermission) {
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
      stopTracks(permissionStream);
    } catch {
      // Les noms restent parfois masqués tant que l’autorisation n’est pas accordée.
    }
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter((device) => device.kind === 'videoinput');
    captureSelect.replaceChildren();
    if (!videos.length) captureSelect.add(new Option('Aucun appareil vidéo détecté', ''));
    else {
      captureSelect.add(new Option('Choisir un appareil vidéo…', ''));
      videos.forEach((device, index) => captureSelect.add(new Option(device.label || `Caméra / carte de capture ${index + 1}`, device.deviceId)));
    }
    $('#captureHelp').textContent = videos.length
      ? `${videos.length} appareil${videos.length > 1 ? 's' : ''} vidéo détecté${videos.length > 1 ? 's' : ''}. Choisis ta carte dans la liste.`
      : 'Aucune caméra ou carte listée. Branche-la en USB, vérifie le HDMI IN, puis scanne à nouveau.';
    if (requestPermission) showToast(videos.length ? 'Liste des sources actualisée.' : 'Aucun appareil vidéo détecté. Vérifie le branchement USB.', videos.length ? 'success' : 'warning');
  } catch {
    showToast('Impossible de lire la liste des appareils. Vérifie les autorisations Windows.', 'warning');
  }
}

async function startCaptureCard() {
  if (!desktop?.isDesktopApp) {
    showModal({ title: 'Utilise Camton Live pour Windows', body: 'La capture USB est désactivée dans l’aperçu du navigateur. Ouvre l’application portable Windows pour accéder aux appareils.', mark: '!' });
    return;
  }
  const deviceId = $('#captureCardSelect').value;
  if (!deviceId) {
    await loadDevices({ requestPermission: true });
    if (!$('#captureCardSelect').value) {
      if ($('#captureCardSelect').options.length > 1) showToast('Sélectionne ta carte USB dans la liste, puis réessaie.', 'warning');
      else showModal({ title: 'Branche ta carte de capture', eyebrow: 'SOURCE XBOX', body: 'Relie la sortie HDMI de ta Xbox à l’entrée HDMI IN de la carte, puis branche la carte en USB sur ton PC. Un câble HDMI seul ne suffit généralement pas.', items: ['Vérifie que la carte est alimentée et reconnue par Windows.', 'Elle peut apparaître comme une caméra USB.', 'Tu peux utiliser l’aperçu local avant d’envoyer quoi que ce soit.'], mark: 'X' });
      return;
    }
  }
  const selectedDevice = $('#captureCardSelect').value || deviceId;
  const deviceLabel = $('#captureCardSelect').selectedOptions?.[0]?.textContent || 'Carte de capture';
  try {
    const { stream, audioLabel } = await openCaptureCard(selectedDevice);
    const [videoTrack] = stream.getVideoTracks();
    const settings = videoTrack?.getSettings?.() || {};
    const hasAudio = stream.getAudioTracks().length > 0;
    if (!settings.width || !settings.height) {
      showToast('La carte est ouverte mais n’envoie aucune image. Vérifie le câble HDMI, que la Xbox est allumée, et qu’aucune autre application n’utilise la carte.', 'warning');
    } else if (!hasAudio) {
      const inputs = await listAudioInputLabels();
      showToast(`Image reçue, mais aucune entrée audio de la carte n’a pu être ouverte. Entrées vues : ${inputs.length ? inputs.join(', ') : 'aucune'}.`, 'warning');
    }
    const size = settings.width && settings.height ? ` · ${settings.width}×${settings.height}` : '';
    await startPreview(stream, `${deviceLabel}${size}${hasAudio ? ` · son : ${audioLabel}` : ''}`);
  } catch (error) {
    showMediaError(error, 'la carte de capture');
  }
}

// Une carte de capture expose souvent son audio sous un autre appareil que la
// vidéo. Windows les rattache par groupId : c'est le son de la Xbox.
async function listAudioInputLabels() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput')
      .map((device) => device.label || 'entrée sans nom');
  } catch {
    return [];
  }
}

async function findCaptureAudioDevice(videoDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const video = devices.find((device) => device.kind === 'videoinput' && device.deviceId === videoDeviceId);
    const audios = devices.filter((device) => device.kind === 'audioinput');
    const paired = video?.groupId
      ? audios.find((device) => device.groupId && device.groupId === video.groupId)
      : null;
    if (paired) return paired;
    const videoWords = String(video?.label || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    return audios.find((device) => {
      const label = String(device.label || '').toLowerCase();
      if (/hdmi|digital audio|capture|carte|game|usb|line in|aux|video/.test(label)) return true;
      return videoWords.some((word) => label.includes(word));
    }) || null;
  } catch {
    return null;
  }
}

// Certaines cartes refusent le format demandé (1080p60 en USB 2, YUY2 saturé).
// On essaie du plus fidèle au plus modeste, avec puis sans le son de la carte.
async function openCaptureCard(deviceId) {
  const audioDevice = await findCaptureAudioDevice(deviceId);
  const audio = audioDevice ? { deviceId: { exact: audioDevice.deviceId } } : null;
  const audioLabel = audioDevice?.label || '';
  const videoBase = { deviceId: { exact: deviceId } };
  const videoHd = { ...videoBase, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

  // Le son passe en premier : la vidéo seule réussit toujours et masquerait l'audio.
  const attempts = audio
    ? [{ video: videoHd, audio }, { video: videoBase, audio }]
    : [{ video: videoHd, audio: true }, { video: videoBase, audio: true }];
  attempts.push({ video: videoHd }, { video: videoBase });

  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (stream.getAudioTracks().length) return { stream, audioLabel };
    } catch { /* combinaison refusée par la carte, on essaie la suivante */ }
  }

  // Dernier recours : la carte refuse l'audio dans la même demande, on l'ouvre
  // séparément puis on réunit les deux pistes.
  const videoStream = await navigator.mediaDevices.getUserMedia({ video: videoBase });
  if (!audio) return { stream: videoStream, audioLabel: '' };
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio });
    return { stream: new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]), audioLabel };
  } catch {
    return { stream: videoStream, audioLabel: '' };
  }
}

function toggleSourceTab(tab) {
  state.sourceTab = tab;
  $$('.source-tab').forEach((button) => {
    const active = button.dataset.sourceTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#pcSourceBody').classList.toggle('hidden', tab !== 'pc');
  $('#xboxSourceBody').classList.toggle('hidden', tab !== 'xbox');
}

function updateCredentialStatus(status) {
  state.credentialStatus = status || { available: false, twitch: false, youtube: false, tiktok: false, relay: false };
  for (const platform of PLATFORM_IDS) {
    const badge = $(`#${platform}Badge`);
    const configured = Boolean(state.credentialStatus[platform]);
    const liveStatus = state.streamStatuses[platform];
    badge.className = 'connection-badge';
    const text = liveStatus?.status === 'encoding'
      ? 'Encodage actif'
      : liveStatus?.status === 'connecting'
        ? 'Connexion…'
        : liveStatus?.status === 'error'
          ? 'Erreur'
          : configured ? 'Clé configurée' : 'À configurer';
    if (liveStatus?.status === 'encoding') badge.classList.add('stream-sending');
    else if (liveStatus?.status === 'error') badge.classList.add('stream-error');
    else if (configured) badge.classList.add('configured');
    badge.replaceChildren();
    const dot = document.createElement('i');
    const label = document.createElement('span');
    label.textContent = text;
    badge.append(dot, label);
    const input = $(`[data-platform="${platform}"]`);
    input.disabled = !state.credentialStatus.available || !configured;
    if (!configured) input.checked = false;
    renderDestinationStats(platform);
  }
  const configuredCount = PLATFORM_IDS.filter((id) => state.credentialStatus[id]).length;
  $('#platformSectionStatus').innerHTML = state.credentialStatus.available
    ? configuredCount
      ? `<span class="status-dot ready"></span> ${configuredCount} destination${configuredCount > 1 ? 's' : ''} configurée${configuredCount > 1 ? 's' : ''}`
      : '<span class="status-dot muted"></span> Aucune clé configurée'
    : '<span class="status-dot warning"></span> Application Windows requise';
  updatePlatformSelection({ persist: false });
}

function updatePlatformSelection({ persist = true } = {}) {
  const selected = [];
  $$('[data-platform]').forEach((input) => {
    const card = input.closest('.platform-card');
    card.classList.toggle('selected', input.checked);
    if (input.checked && PLATFORM_IDS.includes(input.dataset.platform)) selected.push(input.dataset.platform);
  });
  state.selectedPlatforms = new Set(selected);
  if (persist) localStorage.setItem('lumacast-platforms', JSON.stringify(selected));
  $('#navPlatformCheck').textContent = String(selected.length);
  const configuredCount = PLATFORM_IDS.filter((id) => state.credentialStatus[id]).length;
  $('#readinessText').textContent = selected.length
    ? `${selected.length} destination${selected.length > 1 ? 's' : ''} sélectionnée${selected.length > 1 ? 's' : ''}. Vérifie la source, le microphone et le débit montant avant l’envoi.`
    : configuredCount
      ? 'Choisis les destinations configurées à utiliser pour ce direct.'
      : 'Configure d’abord une destination : Twitch, YouTube, TikTok ou un relais.';
  updateBitrateNotice();
}

function updateBitrateNotice() {
  const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
  const selectedCount = state.selectedPlatforms.size;
  const totalMbps = ((profile.bitrate + 160) * selectedCount / 1000).toFixed(1);
  $('#bitrateNotice').textContent = selectedCount > 2
    ? `Estimation : environ ${totalMbps} Mb/s sortants et ${selectedCount} encodages simultanés. Au-delà de deux destinations, un relais coûte moins de bande montante.`
    : selectedCount > 1
      ? `Estimation multistream : environ ${totalMbps} Mb/s sortants et plusieurs encodages simultanés. Prévois une marge réseau.`
      : selectedCount === 1
      ? `Débit vidéo estimé : ${profile.bitrate} kb/s, plus l’audio. La connexion doit garder une marge.`
      : 'Sélectionne une ou plusieurs destinations pour estimer le débit sortant.';
}

async function runSpeedTest() {
  const button = $('#speedTestBtn');
  const output = $('#speedTestResult');
  const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
  if (!desktop?.isDesktopApp) {
    output.dataset.level = 'error';
    output.textContent = 'La mesure passe par l’application Windows : l’aperçu web ne peut pas envoyer de données.';
    return;
  }
  button.disabled = true;
  output.dataset.level = '';
  output.textContent = 'Mesure en cours, quelques secondes…';
  try {
    const result = await desktop.measureUpload();
    const verdict = describeMeasurement({ mbps: result.mbps, profileKbps: profile.bitrate, label: profile.label });
    output.dataset.level = verdict.level;
    output.textContent = verdict.text;
  } catch (error) {
    output.dataset.level = 'error';
    output.textContent = error?.message || 'La mesure a échoué.';
  } finally {
    button.disabled = false;
  }
}

function selectQuality(value) {
  if (!LIVE_PROFILES[value]) value = 'balanced';
  state.quality = value;
  localStorage.setItem('lumacast-quality', value);
  $$('.quality-option').forEach((option) => option.classList.toggle('selected', $('input', option).checked));
  updateBitrateNotice();
}

function addFormField(form, labelText, { type = 'text', placeholder = '', autocomplete = 'off', inputMode = 'text' } = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'credential-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  input.inputMode = inputMode;
  input.required = true;
  input.maxLength = 512;
  wrapper.append(label, input);
  form.append(wrapper);
  return input;
}

async function openCredentialModal(platform) {
  const details = PLATFORM_DETAILS[platform];
  if (!details) {
    showModal({ title: 'Destination inconnue', body: 'Cette destination n’existe plus dans cette version de Camton Live.', mark: '!' });
    return;
  }
  if (!desktop?.isDesktopApp || !state.credentialStatus.available) {
    showModal({ title: 'Configuration désactivée ici', eyebrow: 'APPLICATION WINDOWS REQUISE', body: 'Ne saisis aucune clé dans cet aperçu Web. Les clés ne sont enregistrées que par l’application Windows, chiffrées avec le stockage sécurisé du système.', items: [details.instruction], mark: '!' });
    return;
  }
  if (state.credentialStatus.damaged) {
    const confirmed = window.confirm('Le fichier chiffré des destinations est illisible. Le réinitialiser supprimera toutes les clés enregistrées sur cet appareil. Continuer ?');
    if (!confirmed) return;
    try {
      const status = await desktop.resetCredentials();
      updateCredentialStatus(status);
      state.selectedPlatforms.clear();
      updatePlatformSelection();
      showToast('Configuration locale réinitialisée. Les clés peuvent être saisies à nouveau.');
    } catch (error) {
      showModal({ title: 'Réinitialisation impossible', body: error?.message || 'Le fichier chiffré n’a pas pu être supprimé.', mark: '!' });
      return;
    }
  }

  $('#modalTitle').textContent = details.title;
  $('#modalEyebrow').textContent = 'CLÉ CHIFFRÉE SUR CET APPAREIL';
  const platformMarks = { twitch: '▰', youtube: '▶', tiktok: '♪', relay: '⇄' };
  $('#modalMark').textContent = platformMarks[platform] || '▶';
  $('#modalOk').classList.add('hidden');
  const copy = $('#modalCopy');
  copy.replaceChildren();
  const intro = document.createElement('p');
  intro.textContent = details.instruction;
  copy.append(intro);
  const warning = document.createElement('p');
  warning.className = 'credential-warning';
  warning.textContent = 'Camton Live chiffre la clé au repos et ne demande pas ton mot de passe. Pendant un direct, l’adresse avec la clé passe à FFmpeg et peut être visible aux outils locaux d’inspection des processus. Une clé déjà enregistrée n’est jamais affichée dans l’application.';
  copy.append(warning);

  const form = document.createElement('form');
  form.className = 'credential-form';
  form.autocomplete = 'off';
  let endpointInput = null;
  if (platform !== 'twitch') {
    const endpointField = platform === 'youtube'
      ? { label: 'Adresse du serveur d’ingestion YouTube', placeholder: 'rtmps://a.rtmps.youtube.com:443/live2' }
      : platform === 'relay'
        ? { label: 'Adresse du serveur du relais', placeholder: 'rtmps://live.restream.io:443/live' }
        : { label: 'Adresse du serveur TikTok', placeholder: 'rtmps://…:443/app' };
    endpointInput = addFormField(form, endpointField.label, {
      type: 'url', placeholder: endpointField.placeholder, autocomplete: 'url', inputMode: 'url',
    });
  }
  const keyInput = addFormField(form, `Clé de diffusion ${details.name}`, {
    type: 'password', placeholder: 'Coller la clé fournie par la plateforme', autocomplete: 'new-password',
  });
  const formMessage = document.createElement('p');
  formMessage.className = 'credential-message';
  formMessage.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'credential-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'button button-primary';
  saveButton.textContent = state.credentialStatus[platform] ? 'Mettre à jour' : 'Enregistrer';
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'button button-secondary';
  clearButton.textContent = 'Effacer la clé';
  clearButton.disabled = !state.credentialStatus[platform];
  actions.append(saveButton, clearButton);
  form.append(formMessage, actions);
  copy.append(form);

  const wipe = () => {
    keyInput.value = '';
    if (endpointInput) endpointInput.value = '';
  };
  state.modalCleanup = wipe;
  clearButton.addEventListener('click', async () => {
    if (!state.credentialStatus[platform]) return;
    if (!window.confirm(`Effacer les paramètres ${details.name} chiffrés sur cet appareil ?`)) return;
    clearButton.disabled = true;
    try {
      const status = await desktop.clearCredentials(platform);
      updateCredentialStatus(status);
      state.selectedPlatforms.delete(platform);
      updatePlatformSelection();
      showToast(`Configuration ${details.name} effacée.`);
      closeModal();
    } catch (error) {
      clearButton.disabled = false;
      formMessage.textContent = error?.message || 'Impossible d’effacer la configuration locale.';
      formMessage.classList.add('error');
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    clearButton.disabled = true;
    formMessage.textContent = 'Chiffrement et sauvegarde en cours…';
    formMessage.classList.remove('error');
    try {
      const values = platform === 'twitch'
        ? { key: keyInput.value.trim() }
        : { endpoint: endpointInput.value.trim(), key: keyInput.value.trim() };
      const status = await desktop.saveCredentials(platform, values);
      wipe();
      updateCredentialStatus(status);
      showToast(`Configuration ${details.name} enregistrée sur cet appareil.`);
      closeModal();
    } catch (error) {
      formMessage.textContent = error?.message || 'Impossible d’enregistrer la clé chiffrée.';
      formMessage.classList.add('error');
      saveButton.disabled = false;
      clearButton.disabled = !state.credentialStatus[platform];
    }
  });
  $('#modalBackdrop').classList.add('open');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
  keyInput.focus();
}

function handlePlatformToggle(event) {
  const input = event.currentTarget;
  if (state.isStreaming) {
    input.checked = state.selectedPlatforms.has(input.dataset.platform);
    showToast('Arrête le direct avant de modifier les destinations.', 'warning');
    return;
  }
  if (input.checked && !state.credentialStatus[input.dataset.platform]) {
    input.checked = false;
    updatePlatformSelection();
    openCredentialModal(input.dataset.platform);
    return;
  }
  updatePlatformSelection();
}

function formatStats(stats) {
  const mbps = (stats.bitrateKbps / 1000).toFixed(1).replace('.', ',');
  const dropped = stats.droppedFrames
    ? `${stats.droppedFrames} image${stats.droppedFrames > 1 ? 's' : ''} perdue${stats.droppedFrames > 1 ? 's' : ''}`
    : 'aucune image perdue';
  return `${mbps} Mb/s · ${stats.fps} i/s · ${dropped}`;
}

function renderDestinationStats(platform) {
  const element = $(`#${platform}Stats`);
  if (!element) return;
  const entry = state.streamStatuses[platform];
  const visible = Boolean(entry?.stats) && entry.status === 'encoding';
  element.textContent = visible ? formatStats(entry.stats) : '';
  element.classList.toggle('visible', visible);
}

function renderDestinationStatus(update) {
  if (!PLATFORM_IDS.includes(update.platform)) return;
  if (update.type === 'stats') {
    const previous = state.streamStatuses[update.platform] || {};
    state.streamStatuses[update.platform] = { ...previous, stats: update };
    renderDestinationStats(update.platform);
    return;
  }
  state.streamStatuses[update.platform] = update;
  updateCredentialStatus(state.credentialStatus);
  if (update.status === 'error') showToast(`${PLATFORM_DETAILS[update.platform].name} : ${update.message}`, 'warning');
  const statuses = [...state.selectedPlatforms].map((platform) => state.streamStatuses[platform]?.status);
  if (state.isStreaming && statuses.length && statuses.every((status) => status === 'error')) {
    stopLive({ fromFailure: true });
  }
  updateOverallStreamStatus(update);
}

function updateOverallStreamStatus(update = null) {
  if (!state.isStreaming) return;
  const statuses = [...state.selectedPlatforms].map((platform) => state.streamStatuses[platform]?.status);
  const encoding = statuses.filter((status) => status === 'encoding').length;
  const connecting = statuses.filter((status) => status === 'connecting').length;
  const stopped = statuses.length > 0 && statuses.every((status) => status === 'stopped');
  $('#streamDot').classList.toggle('active', encoding > 0);
  $('#streamDot').classList.toggle('muted', encoding === 0);
  if (encoding) {
    $('#streamStatus').textContent = `${encoding} sortie${encoding > 1 ? 's' : ''} en cours d’encodage local · réception à vérifier dans la plateforme`;
    $('#sessionTime').textContent = 'Encodage actif';
  } else if (connecting) {
    $('#streamStatus').textContent = 'Connexion aux points d’ingestion…';
  } else if (stopped) {
    $('#streamStatus').textContent = 'Arrêt des sorties…';
  } else if (update?.status === 'error') {
    $('#streamStatus').textContent = 'Une sortie a échoué; les autres restent indépendantes.';
  } else {
    $('#streamStatus').textContent = 'Connexion aux points d’ingestion…';
  }
}

function startSessionTimer() {
  clearInterval(state.timerInterval);
  state.demoStartedAt = Date.now();
  const update = () => {
    const seconds = Math.floor((Date.now() - state.demoStartedAt) / 1000);
    $('#demoTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  update();
  state.timerInterval = setInterval(update, 1000);
}

function startDemo() {
  if (state.isStreaming) {
    showModal({ title: 'Arrête le direct avant la démo', body: 'La démo locale est séparée des sorties réseau. Arrête d’abord le flux réel pour ne pas mélanger les deux états.', mark: '!' });
    return;
  }
  if (state.demoRunning) {
    state.demoRunning = false;
    clearInterval(state.timerInterval);
    $('#demoBtn').innerHTML = '<span>▷</span> Essayer la démo locale';
    $('#streamStatus').textContent = 'Démo arrêtée · aucun direct envoyé';
    $('#sessionTime').textContent = 'Pas démarrée';
    $('#streamDot').classList.remove('active');
    $('#streamDot').classList.add('muted');
    $('#demoTimer').classList.add('hidden');
    showToast('Démo locale arrêtée. Aucune sortie réseau n’a été utilisée.');
    return;
  }
  state.demoRunning = true;
  $('#demoBtn').innerHTML = '<span>■</span> Arrêter la démo';
  $('#streamStatus').textContent = 'DÉMO LOCALE · aucun flux envoyé';
  $('#sessionTime').textContent = 'Démo locale';
  $('#streamDot').classList.add('active');
  $('#streamDot').classList.remove('muted');
  $('#demoTimer').classList.remove('hidden');
  startSessionTimer();
  showModal({ title: 'Démo locale démarrée', eyebrow: 'RIEN N’EST DIFFUSÉ', body: 'Le chronomètre est animé localement. Aucune vidéo, aucune piste audio et aucune clé ne sont envoyées aux plateformes.', items: ['Les badges des plateformes restent à leur état réel.', 'Le compteur n’est pas un statut de direct.', 'Arrête la démo avec le même bouton.'], mark: '▶' });
}

function showLiveUnavailable() {
  showModal({ title: 'Ouvre l’application Camton Live Windows', eyebrow: 'MOTEUR DE BUREAU REQUIS', body: 'La page Web sert uniquement d’aperçu. La capture, le chiffrement local des clés et l’encodeur RTMP fonctionnent dans l’application portable Windows x64.', items: ['Ne saisis jamais une clé dans cet aperçu Web.', 'Télécharge et lance le ZIP portable Camton Live sur Windows.', 'Seuls Twitch et YouTube sont pris en charge dans cette bêta.'], mark: '!' });
}

async function createBroadcastStream() {
  if (!sceneVideoTracks().length) throw new Error('Aucune source vidéo active.');
  if (!(await audioDesk.ensurePrimaryMic())) throw new Error('Choisis un microphone pour continuer.');
  const mixed = await audioDesk.getOutputStream();
  if (!mixed.getAudioTracks().length) throw new Error('Le mixage audio n’a produit aucune piste.');
  state.mixedStream = new MediaStream([...sceneVideoTracks(), ...mixed.getAudioTracks()]);
  return state.mixedStream;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function formatClock(ms = 0) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function recordingVideoTracks() {
  return sceneVideoTracks();
}

function renderRecordingUi() {
  const button = $('#recBtn');
  if (!button) return;
  button.classList.toggle('is-recording', state.recording);
  button.innerHTML = state.recording
    ? '<span aria-hidden="true">■</span> Arrêter le REC'
    : '<span aria-hidden="true">●</span> Enregistrer';
  const line = $('#recLine');
  const status = $('#recStatus');
  const reveal = $('#recRevealBtn');
  const convert = $('#recConvertBtn');
  if (state.recording) {
    status.textContent = `Enregistrement · ${formatClock(Date.now() - state.recordStartedAt)} · ${formatBytes(state.recordBytes)}`;
    line.classList.remove('hidden');
    reveal.classList.add('hidden');
    convert.classList.add('hidden');
    return;
  }
  if (state.lastRecording) {
    const saved = state.lastRecording;
    status.textContent = `Dernier enregistrement : ${saved.name} · ${formatBytes(saved.bytes)} · ${formatClock(saved.durationMs)}`;
    line.classList.remove('hidden');
    reveal.classList.remove('hidden');
    convert.classList.remove('hidden');
    convert.disabled = state.converting;
    convert.textContent = state.converting ? `Conversion… ${state.convertPercent || 0} %` : 'Convertir en MP4';
    return;
  }
  line.classList.add('hidden');
}

async function startRecordingSession() {
  if (!desktop?.isDesktopApp) {
    showLiveUnavailable();
    return;
  }
  if (state.recording) return;
  if (!recordingVideoTracks().length) {
    showToast('Active une source vidéo avant d’enregistrer.', 'warning');
    scrollToSection('source');
    return;
  }
  const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
  const button = $('#recBtn');
  button.disabled = true;
  try {
    const mixed = await audioDesk.getOutputStream();
    const stream = new MediaStream([...recordingVideoTracks(), ...mixed.getAudioTracks()]);
    const info = await desktop.startRecording();
    const mimeType = recorderMimeType();
    const options = {
      videoBitsPerSecond: Math.round(profile.bitrate * 1250),
      audioBitsPerSecond: 160000,
    };
    const recorder = mimeType
      ? new MediaRecorder(stream, { ...options, mimeType })
      : new MediaRecorder(stream, options);
    state.recordRecorder = recorder;
    state.recordQueue = Promise.resolve();
    state.recordBytes = 0;
    state.recordStartedAt = Date.now();
    state.lastRecording = null;
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data?.size) return;
      const size = event.data.size;
      state.recordQueue = state.recordQueue.then(async () => {
        const bytes = await event.data.arrayBuffer();
        const result = await desktop.pushRecordingChunk(bytes);
        if (typeof result?.bytes === 'number') state.recordBytes = result.bytes;
      }).catch((error) => {
        showToast(error?.message || 'L’enregistrement n’a pas pu écrire sur le disque.', 'warning');
        stopRecordingSession({ fromFailure: true });
      });
    });
    recorder.addEventListener('error', () => {
      if (state.recording) stopRecordingSession({ fromFailure: true });
    });
    recorder.start(1000);
    audioDesk.fadeIn?.(500);
    state.recording = true;
    state.recordingTimer = setInterval(renderRecordingUi, 500);
    renderRecordingUi();
    showToast(`Enregistrement démarré : ${info.name}`);
  } catch (error) {
    showToast(error?.message || 'L’enregistrement n’a pas pu démarrer.', 'warning');
  } finally {
    button.disabled = false;
  }
}

async function stopRecordingSession({ fromFailure = false } = {}) {
  if (!state.recording && !state.recordRecorder) return;
  const recorder = state.recordRecorder;
  state.recording = false;
  if (state.recordingTimer) clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  try {
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        recorder.addEventListener('stop', resolve, { once: true });
        recorder.stop();
      });
    }
    await state.recordQueue.catch(() => {});
    const info = await desktop.stopRecording();
    if (info?.name) {
      state.lastRecording = info;
      showToast(fromFailure
        ? `Enregistrement interrompu : ${info.name} (${formatBytes(info.bytes)})`
        : `Enregistrement terminé : ${info.name} (${formatBytes(info.bytes)})`);
    }
  } catch (error) {
    showToast(error?.message || 'La fin de l’enregistrement a échoué.', 'warning');
  } finally {
    state.recordRecorder = null;
    renderRecordingUi();
  }
}

function toggleRecording() {
  return state.recording ? stopRecordingSession() : startRecordingSession();
}

async function convertLastRecording() {
  if (!state.lastRecording || state.converting) return;
  state.converting = true;
  state.convertPercent = 0;
  renderRecordingUi();
  try {
    const result = await desktop.convertRecording(state.lastRecording.path, state.lastRecording.durationMs);
    showToast(`Vidéo MP4 prête : ${result.name}`);
    await desktop.revealRecording(result.path);
  } catch (error) {
    showToast(error?.message || 'La conversion en MP4 a échoué. Le fichier WebM reste utilisable.', 'warning');
  } finally {
    state.converting = false;
    renderRecordingUi();
  }
}

function sceneVideoTracks() {
  if (state.sceneEnabled && state.compositor) {
    const tracks = state.compositor.stream.getVideoTracks().filter((track) => track.readyState === 'live');
    if (tracks.length) return tracks;
  }
  return (state.sourceStream?.getVideoTracks() || []).filter((track) => track.readyState === 'live');
}

function ensureCompositor() {
  const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
  const sizeMatches = state.compositor
    && state.compositor.canvas.width === profile.width
    && state.compositor.canvas.height === profile.height;
  const alive = state.compositor?.stream.getVideoTracks().some((track) => track.readyState === 'live');
  // Un flux canvas garde la résolution fixée à sa création : changer de qualité en
  // cours de route imposerait de tout reconstruire, ce qu'on évite pendant un direct.
  if (state.compositor && (!alive || (!sizeMatches && !state.isStreaming && !state.recording))) {
    state.compositor.dispose();
    state.compositor = null;
  }
  if (!state.compositor) {
    state.compositor = createCompositor({ width: profile.width, height: profile.height, fps: profile.fps });
    state.compositor.setMain(state.sourceStream);
    state.compositor.setOverlay(state.overlayStream, { corner: state.overlayCorner, scale: state.overlayScale });
    state.compositor.setOverlayEnabled(Boolean(state.overlayStream));
    state.compositor.start();
    if (state.sceneEnabled) applySceneStream();
  } else if (state.sourceStream) {
    state.compositor.setMain(state.sourceStream);
  }
  return state.compositor;
}

function applySceneStream() {
  const video = $('#previewVideo');
  if (!video) return;
  if (state.sceneEnabled && state.compositor) {
    video.srcObject = state.compositor.stream;
    const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
    $('#resolutionLabel').textContent = `Scène ${profile.width} × ${profile.height} · ${profile.fps} FPS`;
  } else if (state.sourceStream) {
    video.srcObject = state.sourceStream;
  }
  const badge = $('#sceneSectionStatus');
  if (badge) {
    badge.innerHTML = state.sceneEnabled
      ? '<span class="status-dot ready"></span> Caméra incrustée'
      : '<span class="status-dot muted"></span> Caméra inactive';
  }
  const button = $('#overlayCamBtn');
  if (button) {
    button.innerHTML = state.sceneEnabled
      ? '<span aria-hidden="true">▣</span> Retirer la caméra'
      : '<span aria-hidden="true">▣</span> Activer la caméra';
  }
  renderReadiness();
}

function transitionDuration() {
  return Number($('#sceneTransition')?.value || 0);
}

async function populateOverlayCameras() {
  const select = $('#overlayCameraSelect');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === 'videoinput');
  const current = select.value;
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Aucune caméra détectée';
    select.append(option);
    return;
  }
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || 'Caméra sans nom';
    select.append(option);
  }
  if (devices.some((device) => device.deviceId === current)) select.value = current;
}

async function startOverlayCamera() {
  const deviceId = $('#overlayCameraSelect')?.value;
  if (state.overlayStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    state.overlayStream = stream;
    state.sceneEnabled = true;
    const compositor = ensureCompositor();
    compositor.setOverlay(stream, { corner: state.overlayCorner, scale: state.overlayScale });
    compositor.setOverlayEnabled(true);
    await compositor.transition(transitionDuration());
    applySceneStream();
    showToast('Caméra incrustée sur la scène.');
  } catch (error) {
    showMediaError(error, 'la caméra');
  }
}

async function stopOverlayCamera() {
  if (!state.overlayStream) return;
  const stream = state.overlayStream;
  state.overlayStream = null;
  state.sceneEnabled = false;
  state.compositor?.setOverlayEnabled(false);
  await state.compositor?.transition(transitionDuration());
  stopTracks(stream);
  state.compositor?.setOverlay(null);
  applySceneStream();
}

async function toggleOverlayCamera() {
  return state.overlayStream ? stopOverlayCamera() : startOverlayCamera();
}

function renderReadiness() {
  const target = $('#readinessText');
  if (!target || state.isStreaming || state.isStarting) return;
  const source = recordingVideoTracks().length > 0;
  const sound = Boolean(state.audioStatus?.micReady || state.audioStatus?.active > 0);
  const destination = state.selectedPlatforms.size > 0
    && [...state.selectedPlatforms].every((platform) => state.credentialStatus[platform]);
  const mark = (ok) => (ok ? '✓' : '✗');
  const ready = source && sound && destination;
  const text = `${mark(source)} source · ${mark(sound)} son · ${mark(destination)} destination — ${ready ? 'prêt à diffuser' : 'complète ce qui manque'}`;
  if (target.textContent !== text) target.textContent = text;
}

async function countdownBeforeLive() {
  if (state.skipCountdown) return;
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    $('#streamStatus').textContent = `Direct dans ${remaining}…`;
    showToast(`Direct dans ${remaining}…`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function recorderMimeType() {
  const candidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function startLive() {
  if (!desktop?.isDesktopApp) {
    showLiveUnavailable();
    return;
  }
  if (state.isStarting || state.isStreaming) return;
  if (!state.credentialStatus.available) {
    showModal({ title: 'Stockage chiffré indisponible', body: 'Camton Live ne peut pas enregistrer les clés sans chiffrement système. Vérifie que tu utilises le paquet Windows x64.', mark: '!' });
    return;
  }
  if (!state.sourceStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
    showToast('Active l’aperçu de ton écran, d’une fenêtre ou de ta carte de capture avant de démarrer.', 'warning');
    scrollToSection('source');
    return;
  }
  if (!state.selectedPlatforms.size) {
    showModal({ title: 'Choisis une destination', eyebrow: 'ÉTAPE 3', body: 'Configure d’abord Twitch, YouTube ou TikTok, puis sélectionne cette destination.', mark: '!' });
    scrollToSection('platforms');
    return;
  }
  const platforms = [...state.selectedPlatforms];
  const missing = platforms.find((platform) => !state.credentialStatus[platform]);
  if (missing) {
    await openCredentialModal(missing);
    return;
  }
  const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
  const total = ((profile.bitrate + 160) * platforms.length / 1000).toFixed(1);
  if (platforms.length > 1 && !window.confirm(`Tu as sélectionné ${platforms.length} plateformes. Camton Live encodera un flux pour chacune. Débit montant approximatif : ${total} Mb/s, plus la marge réseau. Continuer ?`)) return;

  state.isStarting = true;
  $('#startLiveBtn').disabled = true;
  $('#startLiveBtn').textContent = 'Préparation du flux…';
  try {
    const mixed = await createBroadcastStream();
    const mimeType = recorderMimeType();
    const options = {
      videoBitsPerSecond: Math.round(profile.bitrate * 1250),
      audioBitsPerSecond: 160000,
    };
    const recorder = mimeType
      ? new MediaRecorder(mixed, { ...options, mimeType })
      : new MediaRecorder(mixed, options);
    state.mediaRecorder = recorder;
    state.streamStatuses = {};
    state.chunkQueue = Promise.resolve();
    state.queuedBytes = 0;
    state.stopRequested = false;
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data?.size) return;
      state.queuedBytes += event.data.size;
      if (state.queuedBytes > 12 * 1024 * 1024) {
        showToast('Le réseau ou l’encodeur ne suit pas. Le flux va être arrêté pour éviter une accumulation mémoire.', 'warning');
        stopLive({ fromFailure: true });
        return;
      }
      state.chunkQueue = state.chunkQueue.then(async () => {
        const bytes = await event.data.arrayBuffer();
        await desktop.pushChunk(bytes);
        state.queuedBytes = Math.max(0, state.queuedBytes - event.data.size);
      }).catch((error) => {
        state.queuedBytes = Math.max(0, state.queuedBytes - event.data.size);
        if (state.isStreaming && !state.stopRequested) {
          showToast(error?.message || 'Le segment média n’a pas pu être transmis à l’encodeur.', 'warning');
          stopLive({ fromFailure: true });
        }
      });
    });
    recorder.addEventListener('error', () => {
      if (state.isStreaming && !state.stopRequested) stopLive({ fromFailure: true });
    });

    await countdownBeforeLive();
    await desktop.startStream({ platforms, profileName: state.quality });
    audioDesk.fadeIn?.(800);
    recorder.start(1000);
    state.isStreaming = true;
    renderUpdateNotice();
    state.demoRunning = false;
    $('#demoBtn').innerHTML = '<span>▷</span> Essayer la démo locale';
    $('#startLiveBtn').innerHTML = 'Arrêter le direct <span>■</span>';
    $('#startLiveBtn').classList.add('stream-active-button');
    $('#sessionTime').textContent = 'Préparation du flux…';
    $('#demoTimer').classList.remove('hidden');
    startSessionTimer();
    updateOverallStreamStatus();
    $('#readinessText').textContent = `Profil ${profile.label} prévu · ${profile.width} × ${profile.height} · ${profile.fps} i/s · débit cible d’environ ${total} Mb/s sortants.`;
    showToast('Encodeur lancé. Vérifie la réception dans la plateforme avant de considérer le direct confirmé.');
  } catch (error) {
    await desktop.stopStream().catch(() => {});
    state.mediaRecorder = null;
    state.isStreaming = false;
    renderUpdateNotice();
    state.streamStatuses = {};
    audioDesk.releaseCaptures();
    state.mixedStream = null;
    const message = error?.message || 'Impossible de démarrer le moteur de diffusion.';
    if (/micro|permission|media|device/i.test(message)) showMediaError(error, 'ton microphone');
    else showModal({ title: 'Démarrage impossible', eyebrow: 'VÉRIFICATION', body: message, items: ['Vérifie qu’une source et un microphone sont actifs.', 'Vérifie que la clé a été enregistrée dans l’application Windows.', 'En multistream, essaie un profil de qualité inférieur.'], mark: '!' });
  } finally {
    state.isStarting = false;
    $('#startLiveBtn').disabled = false;
    if (!state.isStreaming) {
      $('#startLiveBtn').innerHTML = 'Démarrer un direct <span>→</span>';
      $('#startLiveBtn').classList.remove('stream-active-button');
    }
  }
}

async function stopLive({ fromFailure = false } = {}) {
  if (state.stopRequested) return;
  state.stopRequested = true;
  const recorder = state.mediaRecorder;
  if (state.isStreaming) await audioDesk.fadeOut?.(500);
  if (recorder && recorder.state !== 'inactive') {
    await new Promise((resolve) => {
      recorder.addEventListener('stop', resolve, { once: true });
      try { recorder.stop(); } catch { resolve(); }
    });
  }
  await state.chunkQueue.catch(() => {});
  if (desktop?.isDesktopApp) await desktop.stopStream().catch(() => {});
  state.isStreaming = false;
  renderUpdateNotice();
  state.mediaRecorder = null;
  state.mixedStream?.getTracks().forEach((track) => track.stop());
  state.mixedStream = null;
  audioDesk.releaseCaptures();
  clearInterval(state.timerInterval);
  $('#startLiveBtn').innerHTML = 'Démarrer un direct <span>→</span>';
  $('#startLiveBtn').classList.remove('stream-active-button');
  $('#sessionTime').textContent = 'Pas démarrée';
  $('#demoTimer').textContent = '00:00';
  $('#demoTimer').classList.add('hidden');
  $('#streamStatus').textContent = fromFailure ? 'Sorties arrêtées après une erreur' : 'Aucun direct en cours';
  $('#streamDot').classList.remove('active');
  $('#streamDot').classList.add('muted');
  state.streamStatuses = {};
  updateCredentialStatus(state.credentialStatus);
  stopSource();
  if (!fromFailure) showToast('Sorties arrêtées. Les pistes média et l’encodeur ont été libérés.');
  state.stopRequested = false;
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.nav === id));
}

function openGuide() {
  showModal({
    title: 'Où trouver quoi', eyebrow: 'GUIDE CAMTON LIVE', mark: '?', action: 'Compris',
    body: 'Trois étapes : préparer la source, régler le son, brancher les destinations. Chaque clé se copie depuis la plateforme, jamais depuis un message reçu.',
    sections: [
      {
        title: '1 · La source',
        items: [
          'PC : « Choisir mon écran / jeu » ouvre le sélecteur intégré. Une fenêtre suffit pour une application, un écran pour un jeu en plein écran.',
          'Console : branche une carte de capture HDMI en USB, puis choisis la carte dans la même liste.',
          'Le son d’un jeu ne suit pas une capture de fenêtre : choisis « Écran » si tu veux aussi le son système.',
        ],
      },
      {
        title: '2 · Le son',
        items: [
          'Le vu-mètre du micro doit bouger quand tu parles. S’il reste à zéro, choisis un autre micro dans la liste.',
          'La piste « Son de la source » prend le son système ; « Musique » accepte un fichier local.',
          'Un casque évite le larsen : le son des haut-parleurs revient dans le micro.',
        ],
      },
      {
        title: '3 · Twitch : où trouver la clé',
        items: [
          'Tableau de bord créateur → Paramètres → Diffusion → Clé de flux primaire → « Afficher », puis copie.',
          'La clé Twitch est permanente : elle ne change que si tu la réinitialises.',
          'Camton Live ne demande jamais ton mot de passe Twitch.',
        ],
      },
      {
        title: '4 · YouTube : où trouver l’adresse et la clé',
        items: [
          'YouTube Studio → Créer → Passer au direct → onglet « Gérer » → « Programmer un direct ».',
          'Dans « Paramètres du flux », choisis « Diffusion personnalisée » : c’est le mode qui donne une adresse de serveur et une clé.',
          'Copie l’adresse du serveur (elle commence par rtmps://) et la clé de diffusion.',
          'Camton Live ne crée pas l’événement YouTube et ne peut pas toujours le démarrer à ta place.',
        ],
      },
      {
        title: '5 · TikTok : où trouver l’adresse et la clé',
        items: [
          'Dans l’application TikTok, ouvre « Direct » puis l’option de diffusion par clé de flux. Le libellé dépend du compte et du pays.',
          'Copie l’adresse du serveur (elle commence par rtmps://) et la clé de flux, puis colle-les dans la carte TikTok.',
          'La clé est liée à un seul direct : recopie-la avant chaque session. Une clé expirée est refusée.',
          'Sans option « clé de flux », ton compte n’a pas l’accès : un service de relais (Restream, Streamlabs) peut faire l’intermédiaire.',
        ],
      },
      {
        title: '6 · Relais : diffuser par un intermédiaire',
        items: [
          'Un relais (Restream, Streamlabs, serveur RTMP personnel) reçoit un seul flux et le répartit vers TikTok, YouTube ou Twitch.',
          'Crée le direct dans le relais, ajoute tes plateformes, puis copie l’adresse du serveur et la clé dans la carte Relais.',
          'Un seul envoi au lieu de deux : c’est le moyen le plus simple de tenir TikTok et Twitch avec une connexion modeste.',
          'Le relais ne débloque pas un compte que la plateforme refuse : l’éligibilité au direct reste celle de TikTok.',
        ],
      },
      {
        title: '7 · Avant d’appuyer sur Démarrer',
        items: [
          'La liste de contrôle vérifie source, son et destination ; le compte à rebours de trois secondes laisse le temps de relire.',
          'Chaque destination sélectionnée consomme son propre débit : deux plateformes, deux fois le débit montant.',
          '« Encodage actif » signifie que l’encodeur tourne sur ce PC ; la réception se vérifie dans la plateforme.',
          'Windows peut avertir au téléchargement : l’installateur n’est pas encore signé. « Informations complémentaires » puis « Exécuter quand même ».',
        ],
      },
      {
        title: '8 · Vérifier le débit, signaler un problème',
        items: [
          '« Tester mon débit montant », sous les préréglages, envoie quelques mégaoctets à un service de mesure public et compare le résultat au préréglage choisi. Aucune clé, aucune image.',
          'Pendant le direct, chaque carte affiche le débit réel, les images par seconde et les images perdues : c’est la preuve que l’encodeur produit un flux stable.',
          'Un problème ? « Signaler un problème » écrit un rapport sur ton Bureau, clés masquées, et ouvre une issue GitHub préremplie. Rien ne part sans ton clic.',
        ],
      },
    ],
  });
}

function openBugReport() {
  const explanation = {
    title: 'Signaler un problème',
    eyebrow: 'RAPPORT LOCAL',
    mark: '!',
    action: 'Fermer',
    body: 'Décris ce qui ne va pas en quelques mots. Le rapport contient la version, ton système, l’encodeur et les dernières lignes de FFmpeg ; les clés de diffusion y sont masquées.',
    items: [
      'Le fichier est écrit sur ton Bureau : relis-le avant de l’envoyer.',
      'Le bouton GitHub ouvre une issue préremplie : joins-y le fichier.',
      'Rien ne part sans ton clic, et aucun serveur Camton Live ne reçoit le rapport.',
    ],
  };
  if (!desktop?.isDesktopApp) {
    showModal({ ...explanation, items: ['Cette fonction passe par l’application Windows : l’aperçu web n’a pas accès aux journaux de l’encodeur.'] });
    return;
  }
  showModal(explanation);
  const copy = $('#modalCopy');
  const form = document.createElement('form');
  form.className = 'credential-form';
  form.autocomplete = 'off';
  const field = document.createElement('label');
  field.className = 'credential-field';
  const fieldLabel = document.createElement('span');
  fieldLabel.textContent = 'Ce qui ne va pas';
  const area = document.createElement('textarea');
  area.rows = 4;
  area.maxLength = 2000;
  area.placeholder = 'La sortie Twitch s’arrête au bout de deux minutes…';
  field.append(fieldLabel, area);
  const message = document.createElement('p');
  message.className = 'credential-message';
  message.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'credential-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button button-primary';
  save.textContent = 'Créer le rapport et ouvrir GitHub';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button button-secondary';
  cancel.textContent = 'Annuler';
  cancel.addEventListener('click', closeModal);
  actions.append(save, cancel);
  $('#modalOk').classList.add('hidden');
  form.append(field, message, actions);
  copy.append(form);
  state.modalCleanup = () => { area.value = ''; };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    message.textContent = 'Écriture du rapport…';
    try {
      const { path } = await desktop.saveBugReport({ description: area.value });
      message.textContent = `Rapport écrit : ${path}. La page GitHub s’ouvre : joins-y ce fichier.`;
      await desktop.openBugIssue({ description: area.value });
      showToast('Rapport prêt sur le Bureau. Joins-le à l’issue GitHub.');
    } catch (error) {
      message.textContent = error?.message || 'Le rapport n’a pas pu être écrit.';
    } finally {
      save.disabled = false;
    }
  });
}

function openFaq() {
  showModal({
    title: 'Questions fréquentes', eyebrow: 'FAQ CAMTON LIVE', mark: '?', action: 'Fermer',
    body: 'Les réponses courtes aux questions les plus posées.',
    sections: [
      { title: 'Camton Live diffuse-t-il vraiment en direct ?', text: 'Oui : l’application encode sur ton PC et envoie le flux à la plateforme configurée. Elle ne peut pas garantir la réception, car c’est la plateforme qui accepte ou refuse le flux. Vérifie l’état du direct dans Twitch ou dans YouTube Studio.' },
      { title: 'Où trouver ma clé Twitch ?', text: 'Tableau de bord créateur → Paramètres → Diffusion → Clé de flux primaire, puis « Afficher » et copie.' },
      { title: 'Où trouver l’adresse et la clé YouTube ?', text: 'YouTube Studio → Créer → Passer au direct → Gérer → Programmer un direct, puis « Diffusion personnalisée » dans les paramètres du flux. L’adresse commence par rtmps:// et la clé fait une trentaine de caractères.' },
      { title: 'Et TikTok ?', text: 'La destination est disponible depuis le 2 décembre 2026. Il faut l’adresse du serveur et la clé de flux fournies par l’application TikTok, et cette clé change à chaque direct. L’accès au direct dépend de ton compte et de ton pays : sans l’option de clé de flux, un service de relais reste la solution.' },
      { title: 'TikTok ne me donne pas de clé, un relais aide-t-il ?', text: 'Oui pour le cas de la clé : le relais fournit sa propre adresse et sa propre clé, et c’est lui qui pousse vers TikTok. Non pour l’éligibilité : si TikTok refuse le direct à ton compte, le relais échouera aussi. Dans les deux cas, la carte Relais accepte aussi un serveur RTMP personnel.' },
      { title: 'Comment savoir si mon direct part vraiment ?', text: 'Chaque carte de destination affiche, pendant le direct, le débit réellement encodé, les images par seconde et les images perdues. C’est une mesure locale : elle prouve que l’encodeur produit un flux stable, pas que la plateforme l’accepte. La réception se vérifie dans l’outil de la plateforme.' },
      { title: 'Comment signaler un bug ?', text: 'Le lien « Signaler un problème » de la barre latérale écrit un rapport sur ton Bureau et ouvre une issue GitHub préremplie. Le rapport contient la version, ton système, l’encodeur et les dernières lignes de FFmpeg ; les clés y sont masquées. Rien ne part sans ton clic.' },
      { title: 'Mes clés partent-elles sur un serveur ?', text: 'Non. Elles sont chiffrées sur ton PC avec le stockage sécurisé de Windows et ne sont jamais réaffichées. Pendant un direct, l’adresse complète est passée à FFmpeg : elle peut donc apparaître dans un outil local d’inspection des processus.' },
      { title: 'Puis-je diffuser sur plusieurs plateformes en même temps ?', text: 'Oui. Camton Live lance un encodage par destination. Deux plateformes, c’est deux fois le débit montant : vérifie ta connexion avant de cocher la deuxième.' },
      { title: 'Quel réglage de qualité choisir ?', text: 'Fluide pour une connexion modeste (720p, 3 Mb/s), Équilibré par défaut (720p, 4,5 Mb/s), Très net pour un PC solide et une bonne fibre (1080p, 6 Mb/s). Le débit annoncé est par destination.' },
      { title: 'Pourquoi Windows affiche-t-il un avertissement ?', text: 'L’installateur n’est pas encore signé. « Informations complémentaires » puis « Exécuter quand même ».' },
      { title: 'Pourquoi l’application indique « Bêta » ?', text: 'Camton Live reste en bêta jusqu’à la version 1.0.0. Tes réglages sont conservés d’une version à l’autre, mais les destinations peuvent encore évoluer.' },
      { title: 'Comment revenir à une version précédente ?', text: 'Les installateurs sont sur la page des versions GitHub. Une version plus ancienne s’installe par-dessus ; les clés enregistrées restent en place.' },
    ],
  });
}

// Windows ne fournit le son système (loopback) que pour la capture d'un écran,
// pas d'une fenêtre : on ouvre alors une capture d'écran supplémentaire dont on
// ne garde que l'audio, pour alimenter la piste « Son de la source ».
async function captureLoopbackAudio() {
  if (!desktop?.isDesktopApp) return null;
  const sources = await desktop.listCaptureSources();
  const screen = sources.find((item) => String(item.id).startsWith('screen:'));
  if (!screen) return null;
  await desktop.selectCaptureSource(screen.id);
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 5, max: 10 } },
    audio: true,
  });
  if (!stream.getAudioTracks().length) {
    stopTracks(stream);
    return null;
  }
  return stream;
}

async function startDesktopCapture(source) {
  try {
    let stream;
    const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
    const capture = async (audio) => {
      await desktop.selectCaptureSource(source.id);
      return navigator.mediaDevices.getDisplayMedia({ ...captureConstraints(profile.fps), audio });
    };
    try {
      stream = await capture(true);
    } catch (error) {
      if (['NotAllowedError', 'PermissionDeniedError', 'AbortError'].includes(error?.name)) throw error;
      stream = await capture(false);
    }
    let auxAudioStream = null;
    if (!stream.getAudioTracks().length) {
      auxAudioStream = await captureLoopbackAudio().catch(() => null);
      if (auxAudioStream) {
        stream = new MediaStream([...stream.getVideoTracks(), ...auxAudioStream.getAudioTracks()]);
      }
    }
    await startPreview(stream, source.name || 'Écran / fenêtre PC');
    // startPreview commence par stopSource(), qui libère state.auxAudioStream :
    // publier la capture avant l'appel la coupait immédiatement.
    state.auxAudioStream = auxAudioStream;
    if (!auxAudioStream && !stream.getAudioTracks().length) {
      showToast('Aucun son système capté. Pour le son d’un jeu ou d’une vidéo, choisis « Écran » dans la liste des sources.', 'warning');
    }
  } catch (error) {
    showMediaError(error, 'l’écran ou la fenêtre');
  }
}

async function refreshCredentialStatus() {
  if (!desktop?.isDesktopApp) {
    updateCredentialStatus({ available: false, twitch: false, youtube: false, tiktok: false, relay: false });
    return;
  }
  try {
    updateCredentialStatus(await desktop.getCredentialStatus());
  } catch {
    updateCredentialStatus({ available: false, twitch: false, youtube: false, tiktok: false, relay: false });
  }
}

function init() {
  renderAppVersion();
  if (state.selectedPlatforms.size) {
    $$('[data-platform]').forEach((input) => { input.checked = state.selectedPlatforms.has(input.dataset.platform); });
  }
  const qualityInput = $(`input[name="quality"][value="${state.quality}"]`);
  if (qualityInput) qualityInput.checked = true;
  selectQuality(state.quality);
  state.removeStreamListener = desktop?.onStreamStatus?.(renderDestinationStatus) || null;
  renderReadiness();
  state.readinessTimer = setInterval(renderReadiness, 1000);
  state.removeUpdateListener = desktop?.onUpdateState?.(renderUpdateNotice) || null;
  state.removeRecordingListener = desktop?.onRecordingState?.((payload) => {
    if (payload?.status === 'converting') {
      state.convertPercent = payload.percent || 0;
      renderRecordingUi();
    }
  }) || null;
  desktop?.getUpdateState?.().then(renderUpdateNotice).catch(() => {});

  $('#updateAction').addEventListener('click', handleUpdateAction);
  $('#updateReveal').addEventListener('click', async () => {
    try {
      await desktop?.revealUpdateFile?.();
    } catch (error) {
      state.updateStatus = { ...state.updateStatus, status: 'error', errorMessage: error?.message || 'Le fichier de mise à jour est introuvable. Retélécharge-le.' };
      renderUpdateNotice();
    }
  });
  $('#updateDismiss').addEventListener('click', () => {
    state.updateDismissed = true;
    renderUpdateNotice();
  });

  $$('.source-tab').forEach((button) => button.addEventListener('click', () => toggleSourceTab(button.dataset.sourceTab)));
  $('#capturePcBtn').addEventListener('click', async () => {
    if (desktop?.isDesktopApp) {
      try {
        const sources = await desktop.listCaptureSources();
        if (!sources.length) {
          showModal({ title: 'Aucune source disponible', body: 'Vérifie les autorisations de partage d’écran de Windows, puis réessaie.', mark: '!' });
          return;
        }
        showDesktopSourcePicker(sources);
      } catch {
        showModal({ title: 'Impossible de lire les écrans', body: 'Ferme puis rouvre Camton Live. Si le problème persiste, vérifie les autorisations de partage d’écran de Windows.', mark: '!' });
      }
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showModal({ title: 'Partage d’écran non disponible', body: 'Ouvre Camton Live sur Windows pour capturer un écran ou une fenêtre.', mark: '!' });
      return;
    }
    try {
      const profile = LIVE_PROFILES[state.quality] || LIVE_PROFILES.balanced;
      const stream = await navigator.mediaDevices.getDisplayMedia(captureConstraints(profile.fps));
      await startPreview(stream, 'Écran / fenêtre PC');
    } catch (error) {
      if (error?.name !== 'AbortError') showMediaError(error, 'l’écran ou la fenêtre');
      else showToast('Partage annulé.', 'warning');
    }
  });
  $('#scanBtn').addEventListener('click', () => loadDevices({ requestPermission: true }));
  $('#connectCardBtn').addEventListener('click', startCaptureCard);
  $('#stopPreviewBtn').addEventListener('click', async () => {
    if (state.isStreaming) await stopLive();
    else stopSource();
    showToast('Aperçu arrêté. Les pistes sélectionnées ont été libérées.');
  });
  const closeAddTrackMenu = () => {
    $('#addTrackMenu').classList.add('hidden');
    $('#addTrackBtn').setAttribute('aria-expanded', 'false');
  };
  $('#addTrackBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    const open = $('#addTrackMenu').classList.toggle('hidden') === false;
    $('#addTrackBtn').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.add-track')) closeAddTrackMenu();
  });
  $$('[data-add-track]').forEach((button) => button.addEventListener('click', () => {
    closeAddTrackMenu();
    if (button.dataset.addTrack === 'music') $('#musicFile').click();
    else audioDesk.addTrack(button.dataset.addTrack);
  }));
  $('#musicFile').addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    const track = await audioDesk.addTrack('music');
    await audioDesk.loadMusicFile(track, file);
  });
  $$('[data-platform]').forEach((input) => input.addEventListener('change', handlePlatformToggle));
  $$('[data-platform-info]').forEach((button) => button.addEventListener('click', () => openCredentialModal(button.dataset.platformInfo)));
  $$('input[name="quality"]').forEach((input) => input.addEventListener('change', () => {
    if (state.isStreaming) {
      $$('input[name="quality"]').forEach((option) => { option.checked = option.value === state.quality; });
      showToast('Arrête le direct avant de changer la qualité d’encodage.', 'warning');
      return;
    }
    selectQuality(input.value);
  }));
  $('#demoBtn').addEventListener('click', startDemo);
  $('#startLiveBtn').addEventListener('click', () => state.isStreaming ? stopLive() : startLive());
  $('#recBtn').addEventListener('click', () => toggleRecording());
  $('#overlayCamBtn').addEventListener('click', () => toggleOverlayCamera());
  $('#overlayCameraSelect').addEventListener('focus', () => { populateOverlayCameras().catch(() => {}); });
  $('#overlayCameraSelect').addEventListener('change', async () => {
    if (!state.overlayStream) return;
    await stopOverlayCamera();
    await startOverlayCamera();
  });
  $('#overlayScale').addEventListener('input', (event) => {
    state.overlayScale = Number(event.target.value) / 100;
    state.compositor?.setOverlay(state.overlayStream, { corner: state.overlayCorner, scale: state.overlayScale });
  });
  $$('.corner-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.overlayCorner = button.dataset.corner;
      $$('.corner-btn').forEach((other) => other.classList.toggle('is-active', other === button));
      state.compositor?.setOverlay(state.overlayStream, { corner: state.overlayCorner, scale: state.overlayScale });
    });
  });
  populateOverlayCameras().catch(() => {});
  $('#recRevealBtn').addEventListener('click', async () => {
    if (!state.lastRecording) return;
    try {
      await desktop.revealRecording(state.lastRecording.path);
    } catch (error) {
      showToast(error?.message || 'Impossible d’ouvrir le dossier des enregistrements.', 'warning');
    }
  });
  $('#recConvertBtn').addEventListener('click', () => convertLastRecording());
  $('#helpBtn').addEventListener('click', openGuide);
  $('#faqBtn').addEventListener('click', openFaq);
  $('#helpTopBtn').addEventListener('click', openGuide);
  $('#speedTestBtn').addEventListener('click', runSpeedTest);
  $('#reportBugBtn').addEventListener('click', openBugReport);
  $('#dismissBanner').addEventListener('click', () => $('#demoBanner').remove());
  $('#privacyBtn').addEventListener('click', () => showModal({
    title: 'Ta vidéo reste chez toi avant l’envoi', eyebrow: 'CONFIDENTIALITÉ',
    body: 'L’aperçu et le mixage sont locaux. Pendant un direct, l’application transmet le flux uniquement aux destinations que tu as choisies. Les clés sont chiffrées par le stockage sécurisé de Windows.',
    items: ['Aucun mot de passe ou cookie de plateforme n’est demandé.', 'Les clés ne vont pas dans localStorage, sur un serveur Camton Live ou dans les journaux.', 'Tu peux supprimer les clés dans la configuration de chaque destination.', 'Arrêter le direct termine les sorties et libère les pistes média.'], mark: '✓',
  }));
  $('#updateNotes').addEventListener('click', () => {
    showWhatsNew({
      version: state.updateStatus.latestVersion || releaseNotes.version,
      notes: state.updateStatus.releaseNotes,
      eyebrow: 'MISE À JOUR DISPONIBLE',
    });
  });
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', (event) => { if (event.target === $('#modalBackdrop')) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  $$('[data-nav], [data-step]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    scrollToSection(link.getAttribute('href').slice(1));
  }));
  if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => loadDevices());
  loadDevices();
  refreshCredentialStatus();
  setTimeout(() => {
    if ($('#modalBackdrop')?.classList.contains('open')) return;
    announceWhatsNew();
  }, 900);
}

init();
