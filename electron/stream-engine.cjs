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

function assertRequiredEncoders(executable) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-encoders'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', () => reject(new Error('FFmpeg ne peut pas être exécuté. Vérifie les DLL du paquet Windows.')));
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error('Impossible de vérifier les encodeurs FFmpeg du paquet Windows.'));
        return;
      }
      if (!/^\s*V.{5}\s+h264_mf\b/m.test(output)) {
        reject(new Error('L’encodeur H.264 Media Foundation est absent de ce paquet Windows.'));
        return;
      }
      if (!/^\s*A.{5}\s+aac\b/m.test(output)) {
        reject(new Error('L’encodeur audio AAC est absent de ce paquet Windows.'));
        return;
      }
      resolve();
    });
  });
}

function destinationFor(platform, credentials) {
  if (platform === 'twitch' && credentials?.twitch?.key) {
    return `rtmps://live.twitch.tv:443/app/${credentials.twitch.key}`;
  }
  if (platform === 'youtube' && credentials?.youtube?.endpoint && credentials.youtube.key) {
    return `${credentials.youtube.endpoint}/${credentials.youtube.key}`;
  }
  throw new Error('Les paramètres de diffusion de cette destination sont incomplets.');
}

function safeFailureMessage(text) {
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|publish.*denied|authentication|access denied/i.test(text)) {
    return 'La plateforme a refusé la clé ou la destination. Vérifie les paramètres dans Twitch ou YouTube Studio.';
  }
  if (/resolve|connection|network|timed out|timeout|refused|handshake|tls|socket/i.test(text)) {
    return 'Connexion impossible. Vérifie Internet, le pare-feu et l’adresse d’ingestion.';
  }
  return 'L’encodeur a arrêté cette sortie. Vérifie la source et essaie un profil de qualité inférieur.';
}

function buildFfmpegArgs(profile, outputUrl) {
  const vf = `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${profile.fps},format=nv12`;
  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'warning', '-stats_period', '1', '-progress', 'pipe:1',
    '-thread_queue_size', '512', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf,
    '-c:v', 'h264_mf', '-rate_control', 'cbr', '-scenario', 'live_streaming',
    '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
    '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * 2), '-bf', '0',
    '-pix_fmt', 'nv12', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-map_metadata', '-1', '-flvflags', 'no_duration_filesize', '-f', 'flv', outputUrl,
  ];
}

function createStreamEngine({ app, emit, deps = {} }) {
  const spawnProcess = deps.spawn || spawn;
  const runtimePlatform = deps.platform || process.platform;
  const runtimeArch = deps.arch || process.arch;
  const resolveExecutable = deps.resolveExecutable || (() => (app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe')
    : path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win-x64', 'bin', 'ffmpeg.exe')));
  const children = new Map();
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
          if (!stopping) publish(platform, 'encoding', 'Encodage local actif; vérifie la réception dans la plateforme.');
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
        if (/\b(error|failed|failure)\b/i.test(line)) entry.lastErrorText = line;
      }
    });
    child.on('error', () => {
      if (!stopping) publish(platform, 'error', 'Impossible de démarrer l’encodeur Windows.');
    });
    child.on('close', (code) => {
      if (stopping) return;
      const current = children.get(platform);
      if (!current || current.child !== child) return;
      children.delete(platform);
      emit({
        type: 'destination',
        platform,
        status: 'error',
        message: code === 0
          ? 'La sortie s’est arrêtée sans action de l’utilisateur. Vérifie la plateforme et la source.'
          : safeFailureMessage(current.lastErrorText || ''),
      });
    });
  }

  function spawnOutput(executable, profile, platform, outputUrl) {
    const child = spawnProcess(executable, buildFfmpegArgs(profile, outputUrl), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const entry = { child, status: 'connecting', sawFrame: false, lastErrorText: '' };
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
      throw new Error('Sélectionne Twitch, YouTube ou les deux destinations.');
    }

    // Validate every destination before spawning so a partial start never leaves an orphan encoder.
    const destinations = [];
    for (const platform of platforms) {
      if (!['twitch', 'youtube'].includes(platform)) throw new Error('Destination non prise en charge.');
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
    await assertRequiredEncoders(executable);

    stopping = false;
    try {
      for (const destination of destinations) {
        spawnOutput(executable, profile, destination.platform, destination.outputUrl);
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

  return Object.freeze({ start, pushChunk, stop, isActive: () => children.size > 0 });
}

module.exports = { createStreamEngine, PROFILES, destinationFor, buildFfmpegArgs, safeFailureMessage };
