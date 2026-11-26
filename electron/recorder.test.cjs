const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRecorder, stamp } = require('./recorder.cjs');

async function makeRecorder(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'camton-rec-'));
  const states = [];
  const recorder = createRecorder({
    app: { isPackaged: false, getPath: () => dir },
    emit: (state) => states.push(state),
    deps: { recordingsDir: () => path.join(dir, 'Camton Live'), ...extra },
    ...extra.recorderOptions,
  });
  return { recorder, dir, states };
}

test('enregistre les segments dans un fichier WebM', async () => {
  const { recorder, dir } = await makeRecorder();
  const started = await recorder.start();
  assert.match(started.name, /^Camton-Live-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.webm$/);

  await recorder.push(Buffer.from('premier'));
  const { bytes } = await recorder.push(Buffer.from('second'));
  assert.equal(bytes, 13);

  const stopped = await recorder.stop();
  assert.equal(stopped.bytes, 13);
  assert.ok(stopped.durationMs >= 0);

  const written = await fs.readFile(path.join(dir, 'Camton Live', stopped.name), 'utf8');
  assert.equal(written, 'premiersecond');
  assert.equal(recorder.isRecording(), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('refuse deux enregistrements simultanés', async () => {
  const { recorder, dir } = await makeRecorder();
  await recorder.start();
  await assert.rejects(recorder.start(), /déjà en cours/);
  await recorder.stop();
  await fs.rm(dir, { recursive: true, force: true });
});

test('refuse un segment hors session', async () => {
  const { recorder, dir } = await makeRecorder();
  await assert.rejects(recorder.push(Buffer.from('x')), /Aucun enregistrement/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('abandonne un enregistrement en supprimant le fichier', async () => {
  const { recorder, dir } = await makeRecorder();
  const started = await recorder.start();
  await recorder.push(Buffer.from('abc'));
  await recorder.discard();
  await assert.rejects(fs.access(started.path));
  await fs.rm(dir, { recursive: true, force: true });
});

test('refuse les chemins extérieurs au dossier des enregistrements', async () => {
  const { recorder, dir } = await makeRecorder();
  assert.throws(() => recorder.reveal('/etc/passwd'), /n’appartient pas/);
  await assert.rejects(recorder.convert('/etc/passwd.webm', 1000), /n’appartient pas/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('signale l’absence d’encodeur FFmpeg sans perdre le WebM', async () => {
  const { recorder, dir } = await makeRecorder({ resolveExecutable: () => '/chemin/inexistant/ffmpeg.exe' });
  const started = await recorder.start();
  await recorder.push(Buffer.from('abc'));
  const stopped = await recorder.stop();
  await assert.rejects(recorder.convert(stopped.path, 1000), /FFmpeg absent/);
  assert.equal(stopped.name, path.basename(started.path));
  await fs.rm(dir, { recursive: true, force: true });
});

test('bascule sur l’encodeur suivant quand le premier échoue', async () => {
  const attempts = [];
  const fakeSpawn = (_executable, args) => {
    const encoder = args[args.indexOf('-c:v') + 1];
    attempts.push(encoder);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (encoder === 'h264_nvenc') {
        child.stderr.emit('data', 'Cannot load nvcuda.dll');
        child.emit('close', 1);
      } else {
        child.stdout.emit('data', 'out_time_ms=500000\nprogress=continue\n');
        child.emit('close', 0);
      }
    });
    return child;
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'camton-rec-'));
  const states = [];
  const recorder = createRecorder({
    app: { isPackaged: false, getPath: () => dir },
    emit: (state) => states.push(state),
    deps: { recordingsDir: () => path.join(dir, 'Camton Live'), spawn: fakeSpawn, resolveExecutable: () => __filename },
  });
  const started = await recorder.start();
  await recorder.push(Buffer.from('abc'));
  const stopped = await recorder.stop();
  const result = await recorder.convert(stopped.path, 1000);
  assert.equal(result.encoder, 'h264_qsv');
  assert.deepEqual(attempts, ['h264_nvenc', 'h264_qsv']);
  assert.equal(result.name, started.name.replace('.webm', '.mp4'));
  assert.ok(states.some((state) => state.status === 'converting'));
  assert.ok(states.some((state) => state.status === 'converted'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('nomme les fichiers avec la date locale', () => {
  const name = stamp(new Date(2026, 0, 5, 7, 8, 9));
  assert.equal(name, '2026-01-05_07-08-09');
});
