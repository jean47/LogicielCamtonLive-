import { AudioMixer, TRACK_KINDS, clampVolume, levelPercent } from './audio-mixer.js';

const STORAGE_KEY = 'camton-mixer';
const MIC_KINDS = new Set(['mic', 'mic2']);

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sans stockage, les réglages restent valables pour la session en cours.
  }
}

// Ce que la capture contient vraiment : sans cette information, une piste muette
// ressemble à un réglage oublié alors que le flux n'a tout simplement pas de son.
export function describeSourceCapture(stream, track = null) {
  if (!stream) return null;
  const audio = stream.getAudioTracks?.() || [];
  if (!audio.some((item) => item.readyState === 'live')) return { label: 'Capture sans son système', warning: true };
  if (track?.muted) return { label: 'Son système capté, piste coupée (M)', warning: true };
  if (track && track.volume <= 0) return { label: 'Son système capté, volume à 0 %', warning: true };
  return { label: 'Son système capté', warning: false };
}

function trackMarkup(track, config, devices, removable, anySolo, hint) {
  const device = devices.find((item) => item.deviceId === track.deviceId);
  const subtitle = MIC_KINDS.has(track.kind)
    ? `<select class="track-device" data-role="device" aria-label="Microphone de ${config.label}">
         <option value="">Micro par défaut</option>
         ${devices.map((item, index) => `<option value="${item.deviceId}"${item.deviceId === track.deviceId ? ' selected' : ''}>${item.label || `Microphone ${index + 1}`}</option>`).join('')}
       </select>`
    : `<small${hint?.warning ? ' class="track-hint track-hint--warning"' : ' class="track-hint"'}>${hint?.label || track.file?.name || config.hint}</small>`;
  const deviceLabel = device?.label || '';
  return `
    <li class="track${track.active ? '' : ' inactive'}${track.muted ? ' muted' : ''}${track.solo ? ' solo' : ''}${anySolo && !track.solo ? ' dimmed' : ''}" data-track-id="${track.id}" data-kind="${track.kind}">
      <button class="track-power" data-action="power" type="button" aria-pressed="${track.active}" title="${track.active ? 'Couper' : 'Activer'} ${config.label}" aria-label="${track.active ? 'Couper' : 'Activer'} ${config.label}"><span aria-hidden="true">${track.active ? '■' : '▷'}</span></button>
      <span class="track-glyph" aria-hidden="true">${config.icon}</span>
      <div class="track-id">
        <strong>${config.label}</strong>
        ${subtitle}
        ${deviceLabel ? `<span class="track-device-name">${deviceLabel}</span>` : ''}
      </div>
      <div class="track-signal">
        <span class="meter" aria-hidden="true"><span class="meter-fill"></span></span>
      </div>
      <input class="track-volume" data-role="volume" type="range" min="0" max="100" step="1" value="${Math.round(track.volume * 100)}" aria-label="Volume de ${config.label}">
      <output class="track-value">${Math.round(track.volume * 100)}%</output>
      <button class="mixer-btn" data-action="mute" type="button" aria-pressed="${track.muted}" title="Couper le son de ${config.label}">M</button>
      <button class="mixer-btn" data-action="solo" type="button" aria-pressed="${track.solo}" title="Écouter seulement ${config.label}">S</button>
      ${removable ? `<button class="mixer-btn mixer-btn--remove" data-action="remove" type="button" title="Retirer ${config.label}" aria-label="Retirer ${config.label}">×</button>` : '<span class="mixer-btn mixer-btn--ghost" aria-hidden="true"></span>'}
    </li>`;
}

export function createAudioDesk({ listElement, master, onStatus, onError, onToast, onRequestSource, onCaptureDesktopAudio } = {}) {
  const mixer = new AudioMixer();
  const settings = readSettings();
  const tracks = new Map();
  const masterVolumeInput = master?.volume;
  const masterMuteButton = master?.mute;
  const masterMeter = master?.meter;

  let devices = [];
  let animationFrame = null;
  let sourceStream = null;

  function status() {
    const active = [...tracks.values()].filter((track) => track.active);
    const micReady = [...tracks.values()].some((track) => MIC_KINDS.has(track.kind) && track.active);
    onStatus?.({ active: active.length, micReady, count: tracks.size });
  }

  function createTrack(kind, { id = kind, deviceId = '', file = null } = {}) {
    if (tracks.has(id)) return tracks.get(id);
    const config = TRACK_KINDS[kind];
    const saved = settings[kind] || {};
    const track = {
      id,
      kind,
      deviceId,
      file,
      stream: null,
      element: null,
      objectUrl: '',
      active: false,
      volume: clampVolume(saved.volume ?? config.volume),
      muted: Boolean(saved.muted),
      solo: Boolean(saved.solo),
    };
    tracks.set(id, track);
    mixer.createTrack({ id, kind, volume: track.volume, muted: track.muted, solo: track.solo });
    return track;
  }

  function persist(track) {
    settings[track.kind] = { volume: track.volume, muted: track.muted, solo: track.solo };
    writeSettings(settings);
  }

  function render() {
    if (!listElement) return;
    const anySolo = [...tracks.values()].some((track) => track.solo);
    const sourceHint = describeSourceCapture(sourceStream, tracks.get('source'));
    listElement.innerHTML = [...tracks.values()]
      .map((track) => trackMarkup(
        track,
        TRACK_KINDS[track.kind],
        devices,
        TRACK_KINDS[track.kind].removable,
        anySolo,
        track.kind === 'source' ? sourceHint : null,
      ))
      .join('');
    status();
  }

  function paintMeters() {
    animationFrame = requestAnimationFrame(paintMeters);
    const levels = mixer.readLevels();
    if (masterMeter) masterMeter.style.width = `${levelPercent(levels.master)}%`;
    for (const [id, level] of levels.tracks) {
      const row = listElement?.querySelector(`[data-track-id="${id}"]`);
      const fill = row?.querySelector('.meter-fill');
      if (fill) fill.style.width = `${levelPercent(level)}%`;
      row?.querySelector('.track-power')?.classList.toggle('is-live', level > 0.01);
    }
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      devices = all.filter((device) => device.kind === 'audioinput');
    } catch {
      devices = [];
    }
    render();
  }

  async function startMic(track) {
    const constraints = track.deviceId ? { audio: { deviceId: { exact: track.deviceId } } } : { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    track.stream = stream;
    track.active = await mixer.attachStream(track.id, stream);
    const [audioTrack] = stream.getAudioTracks();
    audioTrack?.addEventListener('ended', () => {
      if (track.stream !== stream) return;
      stopCapture(track);
      onToast?.('Le micro a été débranché.', 'warning');
    }, { once: true });
    if (!devices.length) await refreshDevices();
    return track.active;
  }

  async function startMusic(track) {
    if (!track.file) return false;
    if (!track.element) {
      const element = new Audio();
      element.loop = true;
      element.preload = 'auto';
      track.objectUrl = URL.createObjectURL(track.file);
      element.src = track.objectUrl;
      track.element = element;
    }
    await mixer.attachElement(track.id, track.element);
    await track.element.play().catch(() => onToast?.('Lecture de la musique impossible.', 'warning'));
    track.active = true;
    return true;
  }

  // Sortie du PC : capture indépendante de la source vidéo, allumée et coupée à la
  // main. Elle prend la sortie audio par défaut de Windows, comme la « Desktop
  // Audio » d'OBS, sans dépendre de ce que l'aperçu montre.
  async function startDesktopAudio(track) {
    if (!onCaptureDesktopAudio) {
      onToast?.('La capture de la sortie du PC est disponible dans l’application de bureau.', 'warning');
      return false;
    }
    const stream = await onCaptureDesktopAudio().catch(() => null);
    if (!stream || !stream.getAudioTracks().length) {
      onToast?.('Aucune sortie audio du PC n’a pu être captée. Vérifie la sortie par défaut de Windows.', 'warning');
      return false;
    }
    track.stream = stream;
    track.active = await mixer.attachStream(track.id, stream).catch(() => false);
    if (!track.active) {
      stopCapture(track);
      return false;
    }
    const [audio] = stream.getAudioTracks();
    audio?.addEventListener('ended', () => {
      if (track.stream !== stream) return;
      stopCapture(track);
      onToast?.('La sortie du PC s’est interrompue.', 'warning');
      render();
    }, { once: true });
    return true;
  }

  function stopCapture(track) {
    if (track.element) {
      track.element.pause();
      track.element.currentTime = 0;
    }
    // Le flux de la source porte aussi la vidéo de l'aperçu : l'arrêter ici le couperait.
    if (track.stream && track.kind !== 'source') {
      track.stream.getTracks().forEach((item) => item.stop());
      track.stream = null;
    }
    mixer.detach(track.id);
    track.active = false;
  }

  async function togglePower(track) {
    if (track.active) {
      if (track.kind === 'source') {
        mixer.detach(track.id);
        track.active = false;
        render();
        return;
      }
      stopCapture(track);
      render();
      return;
    }
    try {
      if (track.kind === 'source') {
        const stream = sourceStream;
        const live = stream?.getAudioTracks().some((item) => item.readyState === 'live');
        if (!live) {
          onToast?.('Le son de la source vient de la capture : choisis de nouveau ton écran ou ta fenêtre.', 'warning');
          onRequestSource?.();
          render();
          return;
        }
        track.active = await mixer.attachStream(track.id, stream).catch(() => false);
        if (!track.active) {
          onToast?.('Le son de la source n’a pas pu être rétabli : choisis de nouveau ton écran ou ta fenêtre.', 'warning');
          onRequestSource?.();
        }
        render();
        return;
      }
      if (track.kind === 'desktop') await startDesktopAudio(track);
      else if (track.kind === 'music') await startMusic(track);
      else await startMic(track);
      render();
    } catch (error) {
      track.active = false;
      onError?.(error, MIC_KINDS.has(track.kind) ? 'ton micro' : 'ce fichier audio');
      render();
    }
  }

  if (listElement) {
    listElement.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const row = button.closest('[data-track-id]');
      const track = tracks.get(row.dataset.trackId);
      if (!track) return;
      if (button.dataset.action === 'power') return void togglePower(track);
      if (button.dataset.action === 'mute') {
        track.muted = !track.muted;
        mixer.setMuted(track.id, track.muted);
      }
      if (button.dataset.action === 'solo') {
        track.solo = !track.solo;
        mixer.setSolo(track.id, track.solo);
      }
      if (button.dataset.action === 'remove') {
        stopCapture(track);
        if (track.objectUrl) URL.revokeObjectURL(track.objectUrl);
        mixer.removeTrack(track.id);
        tracks.delete(track.id);
      }
      persist(track);
      render();
    });

    listElement.addEventListener('input', (event) => {
      if (event.target.dataset.role !== 'volume') return;
      const track = tracks.get(event.target.closest('[data-track-id]').dataset.trackId);
      if (!track) return;
      track.volume = clampVolume(Number(event.target.value) / 100);
      mixer.setVolume(track.id, track.volume);
      const row = event.target.closest('[data-track-id]');
      const output = row.querySelector('.track-value');
      if (output) output.textContent = `${event.target.value}%`;
      persist(track);
    });

    listElement.addEventListener('change', (event) => {
      if (event.target.dataset.role !== 'device') return;
      const track = tracks.get(event.target.closest('[data-track-id]').dataset.trackId);
      if (!track) return;
      track.deviceId = event.target.value;
      if (track.active) {
        stopCapture(track);
        startMic(track)
          .catch((error) => onError?.(error, 'ton micro'))
          .finally(render);
      }
    });
  }

  if (masterVolumeInput) {
    const savedMaster = clampVolume(settings.master?.volume ?? 1);
    mixer.setMasterVolume(savedMaster);
    masterVolumeInput.value = String(Math.round(savedMaster * 100));
    masterVolumeInput.addEventListener('input', () => {
      const value = clampVolume(Number(masterVolumeInput.value) / 100);
      mixer.setMasterVolume(value);
      settings.master = { ...(settings.master || {}), volume: value };
      writeSettings(settings);
    });
  }

  if (masterMuteButton) {
    let masterMuted = Boolean(settings.master?.muted);
    mixer.setMasterMuted(masterMuted);
    masterMuteButton.setAttribute('aria-pressed', String(masterMuted));
    masterMuteButton.classList.toggle('active', masterMuted);
    masterMuteButton.addEventListener('click', () => {
      masterMuted = !masterMuted;
      mixer.setMasterMuted(masterMuted);
      masterMuteButton.setAttribute('aria-pressed', String(masterMuted));
      masterMuteButton.classList.toggle('active', masterMuted);
      settings.master = { ...(settings.master || {}), muted: masterMuted };
      writeSettings(settings);
    });
  }

  createTrack('source');
  createTrack('desktop');
  createTrack('mic');
  render();
  refreshDevices();
  paintMeters();

  return {
    async addTrack(kind) {
      if (kind === 'mic2') {
        const existing = [...tracks.values()].find((track) => track.kind === 'mic2');
        if (existing && existing.active) return existing;
        const track = existing || createTrack('mic2');
        await refreshDevices();
        try {
          await startMic(track);
        } catch (error) {
          onError?.(error, 'le second micro');
        }
        render();
        return track;
      }
      if (kind === 'music') {
        const track = createTrack('music', { id: `music-${Date.now()}` });
        render();
        return track;
      }
      return tracks.get('source');
    },
    async loadMusicFile(track, file) {
      track.file = file;
      if (track.objectUrl) URL.revokeObjectURL(track.objectUrl);
      track.objectUrl = '';
      track.element = null;
      try {
        await startMusic(track);
        onToast?.(`Musique ajoutée : ${file.name}`);
      } catch (error) {
        onError?.(error, 'ce fichier audio');
      }
      render();
    },
    async setSourceStream(stream) {
      sourceStream = stream || null;
      const track = tracks.get('source');
      if (!track) return false;
      if (!stream || !stream.getAudioTracks().length) {
        track.stream = null;
        stopCapture(track);
        render();
        return false;
      }
      track.stream = stream;
      const attached = await mixer.attachStream(track.id, stream).catch(() => false);
      track.active = attached;
      render();
      return attached;
    },
    async ensurePrimaryMic() {
      const track = tracks.get('mic');
      if (!track) return false;
      if (track.active && track.stream?.getAudioTracks().some((item) => item.readyState === 'live')) return true;
      await startMic(track);
      render();
      return track.active;
    },
    hasPrimaryMic() {
      const track = tracks.get('mic');
      return Boolean(track?.active && track.stream?.getAudioTracks().some((item) => item.readyState === 'live'));
    },
    async getOutputStream() {
      await mixer.ensureContext();
      return mixer.getOutputStream();
    },
    releaseCaptures() {
      for (const track of tracks.values()) {
        // La sortie du PC ne dépend pas du direct : elle reste allumée tant que
        // l'utilisateur ne la coupe pas lui-même.
        if (track.kind === 'desktop') continue;
        stopCapture(track);
      }
      render();
    },
    destroy() {
      cancelAnimationFrame(animationFrame);
      for (const track of tracks.values()) stopCapture(track);
      render();
      mixer.dispose();
    },
  };
}
