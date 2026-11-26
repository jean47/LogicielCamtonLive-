const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROFILES = Object.freeze({
  smooth: { width: 1280, height: 720, fps: 30, bitrate: 3000 },
  balanced: { width: 1280, height: 720, fps: 60, bitrate: 4500 },
  sharp: { width: 1920, height: 1080, fps: 60, bitrate: 6000 },
});
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const STOP_TIMEOUT_MS = 3000;

const PROBE_TIMEOUT_MS = 8000;

// La build FFmpeg embarquée est LGPL : pas de libx264. On essaie donc les encodeurs
// matériels disponibles sur Windows, du plus efficace au plus universel. Chacun est
// validé par un encodage réel, car la simple présence dans `-encoders` ne garantit
// pas qu'il démarre (pilotes absents, Media Foundation incomplète, VM sans GPU).
const VIDEO_ENCODERS = Object.freeze([
  {
    name: 'h264_nvenc',
    label: 'NVIDIA NVENC',
    pixFmt: 'nv12',
    options: (profile) => ['-preset', 'p5', '-tune', 'll', '-rc', 'cbr',
      '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
      '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * 2), '-bf', '0'],
  },
  {
    name: 'h264_qsv',
    label: 'Intel Quick Sync',
    pixFmt: 'nv12',
    options: (profile) => ['-preset', 'veryfast',
      '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
      '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * 2)],
  },
  {
    name: 'h264_amf',
    label: 'AMD AMF',
    pixFmt: 'nv12',
    options: (profile) => ['-quality', 'speed', '-rc', 'cbr',
      '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
      '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * 2)],
  },
  {
    name: 'h264_mf',
    label: 'Windows Media Foundation',
    pixFmt: 'nv12',
    options: (profile) => ['-rate_control', 'cbr', '-scenario', 'live_streaming',
      '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
      '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * 2), '-bf', '0'],
  },
]);
const DEFAULT_ENCODER_NAME = 'h264_mf';

function encoderByName(name) {
  return VIDEO_ENCODERS.find((encoder) => encoder.name === name) || VIDEO_ENCODERS[VIDEO_ENCODERS.length - 1];
}

function runFfmpeg(executable, args, spawnProcess, { timeoutMs = PROBE_TIMEOUT_MS, collect = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnProcess(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, output: '' });
      return;
    }
    let output = '';
    const keep = (chunk) => { if (collect) output += chunk; };
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* déjà terminé */ }
      resolve({ ok: false, output });
    }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); resolve({ ok: false, output }); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output }); });
  });
}

async function readEncoderNames(executable, spawnProcess) {
  const { output } = await runFfmpeg(executable, ['-hide_banner', '-encoders'], spawnProcess, { collect: true });
  const names = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([VAS])\.{0,5}[A-Z.]{0,5}\s+(\S+)/.exec(line);
    if (match) names.add(match[2]);
  }
  return names;
}

function probeEncoder(executable, encoder, profile, spawnProcess) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-frames:v', '5',
    '-c:v', encoder.name, ...encoder.options(profile), '-pix_fmt', encoder.pixFmt,
    '-an', '-f', 'null', '-',
  ];
  return runFfmpeg(executable, args, spawnProcess).then((result) => result.ok);
}

function normalizeEndpoint(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

// YouTube accepte RTMPS sur 443 alors que RTMP 1935 est bloqué par beaucoup de
// box et de réseaux d'entreprise : les deux formes sont ramenées vers 443.
function normalizeYoutubeEndpoint(endpoint) {
  const base = normalizeEndpoint(endpoint);
  if (!base) return '';
  if (/^rtmps?:\/\/a\.rtmps?\.youtube\.com(:\d+)?\/live2(\/.*)?$/i.test(base)) {
    return 'rtmps://a.rtmps.youtube.com:443/live2';
  }
  return base.replace(/\/live2\/.+$/, '/live2');
}

function destinationFor(platform, credentials) {
  if (platform === 'twitch' && credentials?.twitch?.key) {
    return `rtmps://live.twitch.tv:443/app/${String(credentials.twitch.key).trim()}`;
  }
  if (platform === 'youtube') {
    const endpoint = normalizeYoutubeEndpoint(credentials?.youtube?.endpoint);
    const key = String(credentials?.youtube?.key || '').trim();
    if (endpoint && key) return `${endpoint}/${key}`;
  }
  if (platform === 'tiktok' || platform === 'relay') {
    const endpoint = normalizeEndpoint(credentials?.[platform]?.endpoint);
    const key = String(credentials?.[platform]?.key || '').trim();
    if (endpoint && key) return `${endpoint}/${key}`;
  }
  throw new Error('Les paramètres de diffusion de cette destination sont incomplets.');
}

function safeFailureMessage(text) {
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|publish.*denied|authentication|access denied/i.test(text)) {
    return 'La plateforme a refusé la clé ou la destination. Vérifie les paramètres dans Twitch, YouTube Studio, l’application TikTok ou ton relais.';
  }
  if (/resolve|connection|network|timed out|timeout|refused|handshake|tls|socket/i.test(text)) {
    return 'Connexion impossible. Vérifie Internet, le pare-feu et l’adresse d’ingestion.';
  }
  return 'L’encodeur a arrêté cette sortie. Vérifie la source et essaie un profil de qualité inférieur.';
}

function buildFfmpegArgs(profile, outputUrl, encoderName = DEFAULT_ENCODER_NAME) {
  const encoder = encoderByName(encoderName);
  const vf = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${profile.fps},format=nv12,fade=t=in:st=0:d=1`;
  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info', '-stats_period', '1', '-progress', 'pipe:1',
    '-fflags', '+genpts', '-thread_queue_size', '512', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf,
    '-c:v', encoder.name, ...encoder.options(profile), '-pix_fmt', encoder.pixFmt,
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-map_metadata', '-1', '-flvflags', 'no_duration_filesize',
    '-max_muxing_queue_size', '1024', '-f', 'flv', outputUrl,
  ];
}

async function writeDiagnostic(app, session) {
  try {
    const stamp = session.at.replace(/[:.]/g, '-');
    const target = path.join(app.getPath('desktop'), `Camton-Live-diagnostic-${stamp}.txt`);
    const lines = [
      'Rapport Camton Live',
      `Date : ${session.at}`,
      `Destination : ${session.platform}`,
      `Code de sortie FFmpeg : ${session.code}`,
      `Encodeur : ${session.encoder ? `${session.encoder.name} (${session.encoder.label}), validé : ${session.encoder.verified ? 'oui' : 'non'}` : 'inconnu'}`,
      '',
      'Dernières lignes FFmpeg :',
      ...session.stderr.slice(-30),
      '',
    ];
    await fs.writeFile(target, lines.join('\n'), 'utf8');
    return target;
  } catch {
    return null;
  }
}

function createStreamEngine({ app, emit, deps = {} }) {
  const spawnProcess = deps.spawn || spawn;
  const runtimePlatform = deps.platform || process.platform;
  const runtimeArch = deps.arch || process.arch;
  const resolveExecutable = deps.resolveExecutable || (() => (app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe')
    : path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win-x64', 'bin', 'ffmpeg.exe')));
  const children = new Map();
  const encoderCache = new Map();
  let sessionEncoder = null;
  let lastSession = null;
  let stopping = false;

  function publish(platform, status, message) {
    const entry = children.get(platform);
    if (entry) entry.status = status;
    emit({ type: 'destination', platform, status, message });
  }

  function watchOutput(platform, child, entry) {
    let progressPending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      progressPending += chunk;
      const lines = progressPending.split(/\r\n|\n|\r/);
      progressPending = lines.pop() || '';
      for (const line of lines) {
        const frame = line.match(/^frame=(\d+)/);
        if (frame && Number(frame[1]) > 0 && !entry.sawFrame) {
          entry.sawFrame = true;
          if (!stopping) {
            const label = sessionEncoder ? ` (${sessionEncoder.label})` : '';
            publish(platform, 'encoding', `Encodage local actif${label}; vérifie la réception dans la plateforme.`);
          }
        }
      }
    });

    let logPending = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      logPending += chunk;
      const lines = logPending.split(/\r\n|\n|\r/);
      logPending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        entry.stderrTail.push(line);
        if (entry.stderrTail.length > 40) entry.stderrTail.shift();
        if (/\b(error|failed|failure|invalid|impossible)\b/i.test(line)) entry.lastErrorText = line;
      }
    });
    child.on('error', () => {
      if (!stopping) publish(platform, 'error', 'Impossible de démarrer l’encodeur Windows.');
    });
    child.on('close', async (code) => {
      if (stopping) return;
      const current = children.get(platform);
      if (!current || current.child !== child) return;
      children.delete(platform);
      lastSession = { platform, code, encoder: sessionEncoder, stderr: [...current.stderrTail], at: new Date().toISOString() };
      const base = code === 0
        ? 'La sortie s’est arrêtée sans action de l’utilisateur. Vérifie la plateforme et la source.'
        : safeFailureMessage(current.lastErrorText || '');
      const report = code === 0 ? null : await writeDiagnostic(app, lastSession);
      emit({
        type: 'destination',
        platform,
        status: 'error',
        message: report ? `${base} Rapport détaillé : ${path.basename(report)} sur le Bureau.` : base,
      });
    });
  }

  async function selectEncoder(executable, profile, candidates) {
    const cached = encoderCache.get(executable);
    const remembered = cached && candidates.find((candidate) => candidate.name === cached);
    if (remembered) return { encoder: remembered, verified: true };
    for (const candidate of candidates) {
      if (await probeEncoder(executable, candidate, profile, spawnProcess)) {
        encoderCache.set(executable, candidate.name);
        return { encoder: candidate, verified: true };
      }
    }
    // Le sondage peut échouer pour une raison passagère : on tente quand même le
    // premier encodeur disponible, le direct tranchera.
    return { encoder: candidates[0], verified: false };
  }

  function spawnOutput(executable, profile, platform, outputUrl, encoderName) {
    const child = spawnProcess(executable, buildFfmpegArgs(profile, outputUrl, encoderName), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const entry = { child, status: 'connecting', sawFrame: false, lastErrorText: '', stderrTail: [] };
    children.set(platform, entry);
    publish(platform, 'connecting', 'Connexion au point d’ingestion…');
    watchOutput(platform, child, entry);
  }

  async function closeEntry(platform, entry) {
    const { child } = entry;
    const closed = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('close', resolve));
    try { child.stdin.end(); } catch { /* process may already have ended */ }
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS))]);
    if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill();
    children.delete(platform);
  }

  async function stop() {
    if (!children.size) return;
    stopping = true;
    const entries = [...children.entries()];
    try {
      await Promise.all(entries.map(async ([platform, entry]) => {
        publish(platform, 'stopping', 'Arrêt de la sortie…');
        await closeEntry(platform, entry);
        emit({ type: 'destination', platform, status: 'stopped', message: 'Envoi arrêté.' });
      }));
    } finally {
      stopping = false;
    }
  }

  async function start({ platforms, profileName, credentials }) {
    if (runtimePlatform !== 'win32' || runtimeArch !== 'x64') {
      throw new Error('Le moteur de diffusion est prévu pour l’application Windows x64.');
    }
    if (children.size) throw new Error('Une session de diffusion est déjà en cours.');
    const profile = PROFILES[profileName];
    if (!profile) throw new Error('Préréglage vidéo inconnu.');
    if (!Array.isArray(platforms) || platforms.length < 1 || platforms.length > 2) {
      throw new Error('Sélectionne une ou deux destinations.');
    }

    // Validate every destination before spawning so a partial start never leaves an orphan encoder.
    const destinations = [];
    for (const platform of platforms) {
      if (!['twitch', 'youtube', 'tiktok', 'relay'].includes(platform)) throw new Error('Destination non prise en charge.');
      if (destinations.some((destination) => destination.platform === platform)) {
        throw new Error('Cette destination est sélectionnée deux fois.');
      }
      destinations.push({ platform, outputUrl: destinationFor(platform, credentials) });
    }

    const executable = resolveExecutable();
    try {
      await fs.access(executable);
    } catch {
      throw new Error('Encodeur FFmpeg absent. Reconstruis le paquet Windows avec la commande indiquée dans le guide.');
    }
    const encoderNames = await readEncoderNames(executable, spawnProcess);
    if (!encoderNames.has('aac')) throw new Error('L’encodeur audio AAC est absent de ce paquet Windows.');
    const candidates = VIDEO_ENCODERS.filter((encoder) => encoderNames.has(encoder.name));
    if (!candidates.length) throw new Error('Aucun encodeur H.264 n’est disponible dans ce paquet Windows.');
    const selection = await selectEncoder(executable, profile, candidates);
    sessionEncoder = { name: selection.encoder.name, label: selection.encoder.label, verified: selection.verified };

    stopping = false;
    try {
      for (const destination of destinations) {
        spawnOutput(executable, profile, destination.platform, destination.outputUrl, sessionEncoder.name);
      }
    } catch (error) {
      const started = [...children.entries()];
      await Promise.all(started.map(([platform, entry]) => closeEntry(platform, entry)));
      throw error;
    }
    return { platforms, profile: profileName };
  }

  function writeChunk(child, buffer) {
    return new Promise((resolve, reject) => {
      if (!child || child.killed || child.stdin.destroyed || child.stdin.writableEnded) {
        reject(new Error('Une sortie de diffusion est fermée.'));
        return;
      }
      const onError = (error) => { cleanup(); reject(error); };
      const onDrain = () => { cleanup(); resolve(); };
      const cleanup = () => {
        child.stdin.removeListener('error', onError);
        child.stdin.removeListener('drain', onDrain);
      };
      child.stdin.once('error', onError);
      if (child.stdin.write(buffer)) {
        cleanup();
        resolve();
      } else child.stdin.once('drain', onDrain);
    });
  }

  async function pushChunk(input) {
    const buffer = Buffer.from(input);
    if (!buffer.length || buffer.length > MAX_CHUNK_BYTES) throw new Error('Segment média invalide ou trop volumineux.');
    const active = [...children.values()].filter((entry) => entry.status === 'connecting' || entry.status === 'encoding');
    if (!active.length) throw new Error('Aucune sortie de diffusion ne fonctionne.');
    const results = await Promise.allSettled(active.map((entry) => writeChunk(entry.child, buffer)));
    const failures = results.filter((result) => result.status === 'rejected').length;
    if (failures === active.length) throw new Error('Toutes les sorties de diffusion sont fermées.');
    return { accepted: true, failedOutputs: failures };
  }

  function getDiagnostics() {
    return {
      encoder: sessionEncoder,
      lastSession,
      outputs: [...children.entries()].map(([platform, entry]) => ({
        platform,
        status: entry.status,
        sawFrame: entry.sawFrame,
        stderr: entry.stderrTail.slice(-20),
      })),
    };
  }

  return Object.freeze({ start, pushChunk, stop, getDiagnostics, isActive: () => children.size > 0 });
}

module.exports = {
  createStreamEngine, PROFILES, VIDEO_ENCODERS, destinationFor, buildFfmpegArgs, safeFailureMessage,
};
