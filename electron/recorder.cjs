const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 30 * 60 * 1000;

// La build FFmpeg embarquée est LGPL : pas de libx264, on convertit donc avec un
// encodeur matériel quand la machine en propose un.
const CONVERT_ENCODERS = Object.freeze(['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf']);

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function createRecorder({ app, emit = () => {}, deps = {} }) {
  const spawnProcess = deps.spawn || spawn;
  const resolveExecutable = deps.resolveExecutable || (() => (app.isPackaged
    ? path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe')
    : path.join(__dirname, '..', 'vendor', 'ffmpeg', 'win-x64', 'bin', 'ffmpeg.exe')));
  const recordingsDir = deps.recordingsDir || (() => path.join(app.getPath('videos'), 'Camton Live'));

  let session = null;
  let converting = null;

  function directory() {
    return recordingsDir();
  }

  async function ensureDirectory() {
    const dir = directory();
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  function assertInside(filePath) {
    const dir = path.resolve(directory()) + path.sep;
    const resolved = path.resolve(String(filePath || ''));
    if (!resolved.startsWith(dir)) throw new Error('Ce fichier n’appartient pas aux enregistrements Camton Live.');
    return resolved;
  }

  async function start() {
    if (session) throw new Error('Un enregistrement est déjà en cours.');
    const dir = await ensureDirectory();
    const file = path.join(dir, `Camton-Live-${stamp()}.webm`);
    const handle = await fs.open(file, 'w');
    session = { handle, file, bytes: 0, startedAt: Date.now() };
    return { path: file, name: path.basename(file) };
  }

  async function push(chunk) {
    if (!session) throw new Error('Aucun enregistrement en cours.');
    const buffer = Buffer.from(chunk);
    if (!buffer.length) return { bytes: session.bytes };
    if (buffer.length > MAX_CHUNK_BYTES) throw new Error('Segment d’enregistrement trop volumineux.');
    await session.handle.write(buffer);
    session.bytes += buffer.length;
    return { bytes: session.bytes };
  }

  async function stop() {
    if (!session) return null;
    const current = session;
    session = null;
    await current.handle.close();
    return {
      path: current.file,
      name: path.basename(current.file),
      bytes: current.bytes,
      durationMs: Date.now() - current.startedAt,
    };
  }

  async function discard() {
    if (!session) return null;
    const current = session;
    session = null;
    await current.handle.close();
    await fs.rm(current.file, { force: true }).catch(() => {});
    return current.file;
  }

  function runConvert(executable, input, output, encoder, durationMs) {
    return new Promise((resolve, reject) => {
      const args = [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1',
        '-i', input,
        '-c:v', encoder, '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', '-y', output,
      ];
      let child;
      try {
        child = spawnProcess(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        reject(error);
        return;
      }
      let pending = '';
      let lastError = '';
      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split(/\r\n|\n|\r/);
        pending = lines.pop() || '';
        for (const line of lines) {
          const micro = /^out_time_ms=(\d+)/.exec(line);
          if (micro && durationMs > 0) {
            const percent = Math.min(99, Math.round((Number(micro[1]) / 1000 / durationMs) * 100));
            emit({ status: 'converting', percent });
          }
        }
      });
      child.stderr?.on('data', (chunk) => { lastError = String(chunk).trim().split(/\r?\n/).pop() || lastError; });
      const timer = setTimeout(() => { try { child.kill(); } catch { /* terminé */ } }, CONVERT_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(true);
        else reject(new Error(lastError || 'La conversion a échoué.'));
      });
    });
  }

  async function convert(filePath, durationMs = 0) {
    if (converting) throw new Error('Une conversion est déjà en cours.');
    const input = assertInside(filePath);
    const output = input.replace(/\.webm$/i, '.mp4');
    if (output === input) throw new Error('Seuls les fichiers .webm peuvent être convertis.');
    const executable = resolveExecutable();
    try {
      await fs.access(executable);
    } catch {
      throw new Error('Encodeur FFmpeg absent : le fichier WebM reste lisible dans un lecteur vidéo.');
    }
    converting = { input, output };
    emit({ status: 'converting', percent: 0, name: path.basename(output) });
    try {
      let lastError = null;
      for (const encoder of CONVERT_ENCODERS) {
        try {
          await runConvert(executable, input, output, encoder, durationMs);
          emit({ status: 'converted', path: output, name: path.basename(output) });
          return { path: output, name: path.basename(output), encoder };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('Aucun encodeur H.264 n’a pu convertir le fichier.');
    } catch (error) {
      emit({ status: 'error', message: error.message });
      throw error;
    } finally {
      converting = null;
    }
  }

  function reveal(filePath) {
    const target = assertInside(filePath);
    return { path: target };
  }

  return {
    start, push, stop, discard, convert, reveal, directory, isRecording: () => Boolean(session),
  };
}

module.exports = { createRecorder, CONVERT_ENCODERS, stamp };
