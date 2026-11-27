export const TRACK_KINDS = {
  mic: { label: 'Micro principal', hint: 'Ta voix, toujours présente dans le direct', volume: 1, icon: '♩', removable: false },
  mic2: { label: 'Second micro', hint: 'Invité, casque ou micro d’appoint', volume: 1, icon: '♫', removable: true },
  source: { label: 'Son de la source', hint: 'Jeu, écran ou carte de capture', volume: 0.7, icon: '▣', removable: false },
  music: { label: 'Musique', hint: 'Fichier audio local', volume: 0.6, icon: '♪', removable: true },
};

// 48 kHz comme le son système et l'encodeur AAC : plus de rééchantillonnage dans la
// chaîne. « playback » donne un tampon large, donc moins de coupures quand le
// rendu vidéo occupe la machine.
export const AUDIO_CONTEXT_OPTIONS = Object.freeze({ sampleRate: 48000, latencyHint: 'playback' });

export function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

/**
 * Gain réel de chaque piste. Le solo coupe les autres pistes; une piste muette
 * reste muette même si elle est en solo.
 */
// Certaines cartes son refusent le taux imposé : sans repli, la table entière
// resterait muette alors que tout paraît branché.
export function openAudioContext(AudioContextCtor, options = AUDIO_CONTEXT_OPTIONS) {
  if (!AudioContextCtor) throw new Error('AudioContext indisponible.');
  try {
    return new AudioContextCtor(options);
  } catch {
    return new AudioContextCtor();
  }
}

export function resolveTrackGains(tracks) {
  const hasSolo = tracks.some((track) => track.solo);
  const gains = new Map();
  for (const track of tracks) {
    const silent = track.muted || (hasSolo && !track.solo);
    gains.set(track.id, silent ? 0 : clampVolume(track.volume));
  }
  return gains;
}

export function levelPercent(rms) {
  const value = Number.isFinite(rms) ? rms : 0;
  if (value <= 0) return 0;
  return Math.min(100, Math.max(3, Math.round(value * 360)));
}

export class AudioMixer {
  constructor({ createContext, createStream } = {}) {
    this.createContext = createContext
      || (() => openAudioContext(window.AudioContext || window.webkitAudioContext));
    this.createStream = createStream || ((tracks) => new MediaStream(tracks));
    this.context = null;
    this.master = null;
    this.limiter = null;
    this.masterAnalyser = null;
    this.destination = null;
    this.tracks = new Map();
    this.elementSources = new WeakMap();
    this.masterVolume = 1;
    this.masterMuted = false;
  }

  async ensureContext() {
    if (!this.context) {
      this.context = this.createContext();
      this.master = this.context.createGain();
      this.masterAnalyser = this.context.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.destination = this.context.createMediaStreamDestination();
      this.limiter = this.context.createDynamicsCompressor();
      // Plusieurs pistes à plein volume dépassent 0 dB : sans limiteur, l'écrêtage
      // s'entend comme un grésillement sur la plateforme.
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.master.connect(this.limiter);
      this.limiter.connect(this.masterAnalyser);
      this.limiter.connect(this.destination);
      this.applyMaster();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  createTrack({ id, kind, volume, muted = false, solo = false }) {
    if (this.tracks.has(id)) return this.tracks.get(id);
    const config = TRACK_KINDS[kind] || {};
    const track = {
      id,
      kind,
      label: config.label || kind,
      volume: clampVolume(volume ?? config.volume ?? 1),
      muted: Boolean(muted),
      solo: Boolean(solo),
      inputNode: null,
      gainNode: null,
      analyser: null,
      source: null,
    };
    this.tracks.set(id, track);
    return track;
  }

  async attachStream(id, stream) {
    const track = this.tracks.get(id);
    const audioTrack = stream?.getAudioTracks?.()[0];
    if (!track || !audioTrack) return false;
    const context = await this.ensureContext();
    this.detach(id);
    const source = context.createMediaStreamSource(this.createStream([audioTrack]));
    return this.wireSource(track, source);
  }

  async attachElement(id, element) {
    const track = this.tracks.get(id);
    if (!track || !element) return false;
    const context = await this.ensureContext();
    this.detach(id);
    // createMediaElementSource n'accepte qu'un nœud par élément : le recréer après une
    // coupure lève InvalidStateError et la piste ne peut plus jamais être réactivée.
    let source = this.elementSources.get(element);
    if (!source) {
      source = context.createMediaElementSource(element);
      this.elementSources.set(element, source);
    }
    return this.wireSource(track, source);
  }

  wireSource(track, source) {
    const context = this.context;
    const gainNode = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(this.master);
    track.source = source;
    track.inputNode = source;
    track.gainNode = gainNode;
    track.analyser = analyser;
    this.applyGains();
    return true;
  }

  detach(id) {
    const track = this.tracks.get(id);
    if (!track?.inputNode) return;
    try {
      track.inputNode.disconnect();
      track.gainNode?.disconnect();
      track.analyser?.disconnect();
    } catch {
      // Un nœud déjà déconnecté n’a rien à libérer.
    }
    track.source = null;
    track.inputNode = null;
    track.gainNode = null;
    track.analyser = null;
  }

  removeTrack(id) {
    this.detach(id);
    this.tracks.delete(id);
  }

  setVolume(id, volume) {
    const track = this.tracks.get(id);
    if (!track) return;
    track.volume = clampVolume(volume);
    this.applyGains();
  }

  setMuted(id, muted) {
    const track = this.tracks.get(id);
    if (!track) return;
    track.muted = Boolean(muted);
    this.applyGains();
  }

  setSolo(id, solo) {
    const track = this.tracks.get(id);
    if (!track) return;
    track.solo = Boolean(solo);
    this.applyGains();
  }

  applyGains() {
    const gains = resolveTrackGains([...this.tracks.values()]);
    for (const [id, gain] of gains) {
      const track = this.tracks.get(id);
      if (track?.gainNode) track.gainNode.gain.value = gain;
    }
  }

  setMasterVolume(volume) {
    this.masterVolume = clampVolume(volume);
    this.applyMaster();
  }

  setMasterMuted(muted) {
    this.masterMuted = Boolean(muted);
    this.applyMaster();
  }

  applyMaster() {
    if (this.master) this.master.gain.value = this.masterMuted ? 0 : this.masterVolume;
  }

  // Fondu appliqué au gain principal : il touche le direct ET l'enregistrement,
  // puisque les deux lisent la même destination.
  fadeIn(durationMs = 800) {
    if (!this.context || !this.master || this.masterMuted) return;
    const now = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0.0001, now);
    gain.linearRampToValueAtTime(this.masterVolume, now + durationMs / 1000);
  }

  async fadeOut(durationMs = 600) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, 0.0001), now);
    gain.linearRampToValueAtTime(0.0001, now + durationMs / 1000);
    await new Promise((resolve) => setTimeout(resolve, durationMs + 50));
    this.applyMaster();
  }

  isAttached(id) {
    return Boolean(this.tracks.get(id)?.inputNode);
  }

  readLevels() {
    const levels = new Map();
    for (const track of this.tracks.values()) {
      levels.set(track.id, track.analyser ? this.sampleAnalyser(track.analyser) : 0);
    }
    return { tracks: levels, master: this.masterAnalyser ? this.sampleAnalyser(this.masterAnalyser) : 0 };
  }

  sampleAnalyser(analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / data.length);
  }

  getOutputStream() {
    const tracks = this.destination?.stream?.getAudioTracks?.() || [];
    return this.createStream(tracks);
  }

  async dispose() {
    for (const id of [...this.tracks.keys()]) this.detach(id);
    this.tracks.clear();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.masterAnalyser = null;
    this.destination = null;
    if (context?.close) await context.close().catch(() => {});
  }
}
