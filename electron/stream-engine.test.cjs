const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createStreamEngine, PROFILES, MAX_DESTINATIONS, destinationFor, buildFfmpegArgs, buildStats,
  safeFailureMessage,
} = require('./stream-engine.cjs');

const CREDENTIALS = Object.freeze({
  twitch: { key: 'live_1234567890_abcdef' },
  youtube: { endpoint: 'rtmps://a.rtmps.youtube.com:443/live2', key: 'abcd-efgh-ijkl-mnop' },
});

const ENCODERS = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D h264_mf              H264 via MediaFoundation (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)`;

function ffmpegStub({ encoders = ENCODERS, fail = '', failProbe = [], progress = '' } = {}) {
  const probe = `if [ "$1" = "-hide_banner" ] && [ "$2" = "-encoders" ]; then
  cat <<'LIST'
${encoders}
LIST
  exit 0
fi`;
  const probeGuard = failProbe.length
    ? `case "$*" in
  *testsrc2*)
    for rejected in ${failProbe.join(' ')}; do
      case "$*" in *"$rejected"*) exit 1 ;; esac
    done ;;
esac`
    : '';
  const progressBlock = progress ? `printf '%s' '${progress}'` : '';
  const body = fail
    ? `printf '%s\\n' "${fail}" >&2
exit 1`
    : `printf 'frame=1\\n'
${progressBlock}
cat > /dev/null
printf 'frame=2\\n'
exit 0`;
  return `#!/bin/sh
${probe}
${probeGuard}
${body}
`;
}

function harness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camton-engine-'));
  const executable = path.join(dir, 'ffmpeg');
  fs.writeFileSync(executable, ffmpegStub(options), { mode: 0o755 });
  const events = [];
  const engine = createStreamEngine({
    app: { isPackaged: false },
    emit: (event) => events.push(event),
    deps: { platform: 'win32', arch: 'x64', resolveExecutable: () => executable },
  });
  t.after(async () => {
    await engine.stop().catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
  });
  return { engine, events, executable };
}

function waitFor(events, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const match = events.find(predicate);
      if (match) { resolve(match); return; }
      if (Date.now() - startedAt > timeoutMs) { reject(new Error('Événement de diffusion attendu mais absent.')); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

test('each profile drives resolution, frame rate and bitrate in the encoder arguments', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const args = buildFfmpegArgs(profile, 'rtmp://ingest.example/app/key');
    assert.equal(args.at(-1), 'rtmp://ingest.example/app/key', `${name} doit terminer par la destination`);
    assert.equal(args[args.indexOf('-b:v') + 1], `${profile.bitrate}k`);
    assert.equal(args[args.indexOf('-maxrate') + 1], `${profile.bitrate}k`);
    const filter = args[args.indexOf('-vf') + 1];
    assert.match(filter, new RegExp(`scale=${profile.width}:${profile.height}`));
    assert.match(filter, new RegExp(`fps=${profile.fps}`));
    assert.equal(args[args.indexOf('-g') + 1], String(profile.fps * 2));
  }
});

test('the video opens on a one-second fade from black', () => {
  const args = buildFfmpegArgs(PROFILES.balanced, 'rtmps://live.twitch.tv:443/app/key');
  const filter = args[args.indexOf('-vf') + 1];
  assert.match(filter, /fade=t=in:st=0:d=1/);
  assert.ok(filter.trim().endsWith('fade=t=in:st=0:d=1'), 'le fondu reste en fin de chaîne');
});

test('the stream is re-encoded to H.264/AAC with optional audio and FLV output', () => {
  const args = buildFfmpegArgs(PROFILES.balanced, 'rtmps://live.twitch.tv:443/app/key');
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_mf');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-map') + 1], '0:v:0');
  assert.ok(args.includes('0:a:0?'), 'l’audio de la source reste optionnel');
  assert.equal(args[args.lastIndexOf('-f') + 1], 'flv');
  assert.equal(args[args.indexOf('-f') + 1], 'webm', 'le WebM produit par MediaRecorder est décodé');
});

test('YouTube ingest addresses are normalised to RTMPS on port 443', () => {
  const cases = [
    'rtmp://a.rtmp.youtube.com/live2',
    'rtmp://a.rtmp.youtube.com/live2/',
    'rtmps://a.rtmps.youtube.com:443/live2',
    'rtmps://a.rtmps.youtube.com:443/live2/',
    'rtmps://a.rtmps.youtube.com:443/live2/ancienne-cle',
  ];
  for (const endpoint of cases) {
    assert.equal(
      destinationFor('youtube', { youtube: { endpoint, key: ' cle ' } }),
      'rtmps://a.rtmps.youtube.com:443/live2/cle',
      `${endpoint} doit aboutir à une adresse unique`,
    );
  }
  assert.equal(
    destinationFor('youtube', { youtube: { endpoint: 'rtmp://192.168.1.20:1935/live2', key: 'k' } }),
    'rtmp://192.168.1.20:1935/live2/k',
    'un serveur local reste inchangé',
  );
});

test('destinations are built from the encrypted credentials only', () => {
  assert.equal(destinationFor('twitch', CREDENTIALS), 'rtmps://live.twitch.tv:443/app/live_1234567890_abcdef');
  assert.equal(destinationFor('youtube', CREDENTIALS), 'rtmps://a.rtmps.youtube.com:443/live2/abcd-efgh-ijkl-mnop');
  assert.throws(() => destinationFor('twitch', {}), /incomplets/);
  assert.throws(() => destinationFor('youtube', { youtube: { endpoint: 'rtmps://a.rtmps.youtube.com:443/live2' } }), /incomplets/);
});

test('a relay destination joins the address and the key of the intermediary', () => {
  assert.equal(
    destinationFor('relay', { relay: { endpoint: 'rtmps://live.restream.io:443/live/', key: 'abc123' } }),
    'rtmps://live.restream.io:443/live/abc123',
  );
  assert.throws(() => destinationFor('relay', { relay: { key: 'abc123' } }), /incomplets/);
});

test('a tiktok destination joins the ingest address and the session key', () => {
  assert.equal(
    destinationFor('tiktok', { tiktok: { endpoint: 'rtmps://push-rtmp-l6.example.tiktokcdn.com:443/stream/', key: ' cle ' } }),
    'rtmps://push-rtmp-l6.example.tiktokcdn.com:443/stream/cle',
  );
  assert.throws(() => destinationFor('tiktok', { tiktok: { key: 'cle' } }), /incomplets/);
});

test('encoder failures are translated into messages without leaking the key', () => {
  const key = CREDENTIALS.twitch.key;
  const unauthorized = safeFailureMessage(`HTTP error 401 Unauthorized for rtmps://live.twitch.tv:443/app/${key}`);
  assert.match(unauthorized, /refusé la clé/);
  assert.ok(!unauthorized.includes(key));
  assert.match(safeFailureMessage('Failed to resolve hostname live.twitch.tv'), /Connexion impossible/);
  assert.match(safeFailureMessage('Conversion failed!'), /L’encodeur a arrêté/);
});

test('progress fields become readable statistics', () => {
  const stats = buildStats({
    fps: '59.94',
    bitrate: '4521.3kbits/s',
    speed: '1.02x',
    drop_frames: '3',
    total_size: '2097152',
  });
  assert.deepEqual(stats, { fps: 60, bitrateKbps: 4521, speed: 1.02, droppedFrames: 3, totalBytes: 2097152 });
  assert.deepEqual(buildStats({}), { fps: 0, bitrateKbps: 0, speed: 0, droppedFrames: 0, totalBytes: 0 });
});

test('the encoder reports real throughput while the stream is running', async (t) => {
  const progress = [
    'frame=42',
    'fps=59.94',
    'bitrate=4512.7kbits/s',
    'total_size=3145728',
    'drop_frames=0',
    'speed=1.01x',
    'progress=continue',
    '',
  ].join('\n');
  const { engine, events } = harness(t, { progress });
  await engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS });
  const stats = await waitFor(events, (event) => event.type === 'stats');
  assert.equal(stats.platform, 'twitch');
  assert.equal(stats.bitrateKbps, 4513);
  assert.equal(stats.fps, 60);
  assert.equal(stats.droppedFrames, 0);
  assert.equal(stats.speed, 1.01);
});

test('four destinations are accepted and a fifth is refused', async (t) => {
  const { engine } = harness(t);
  assert.equal(MAX_DESTINATIONS, 4);
  const credentials = {
    twitch: { key: 'live_1234567890_abcdef' },
    youtube: { endpoint: 'rtmps://a.rtmps.youtube.com:443/live2', key: 'abcd-efgh-ijkl-mnop' },
    tiktok: { endpoint: 'rtmps://ingest.tiktok.example:443/app', key: 'tiktok-key-1234' },
    relay: { endpoint: 'rtmps://live.restream.io:443/live', key: 'relay-key-1234' },
  };
  const started = await engine.start({
    platforms: ['twitch', 'youtube', 'tiktok', 'relay'],
    profileName: 'smooth',
    credentials,
  });
  assert.equal(started.platforms.length, 4);
  await engine.stop();
  await assert.rejects(
    engine.start({ platforms: ['twitch', 'youtube', 'tiktok', 'relay', 'twitch'], profileName: 'smooth', credentials }),
    /entre une et 4 destinations/,
  );
});

test('a session starts one encoder per destination, accepts chunks and stops cleanly', async (t) => {
  const { engine, events } = harness(t);
  const started = await engine.start({ platforms: ['twitch', 'youtube'], profileName: 'smooth', credentials: CREDENTIALS });
  assert.deepEqual(started, { platforms: ['twitch', 'youtube'], profile: 'smooth' });
  assert.equal(engine.isActive(), true);

  for (const platform of ['twitch', 'youtube']) {
    const encoding = await waitFor(events, (event) => event.platform === platform && event.status === 'encoding');
    assert.match(encoding.message, /Encodage local actif/);
    assert.ok(events.some((event) => event.platform === platform && event.status === 'connecting'));
  }

  const result = await engine.pushChunk(new Uint8Array([1, 2, 3, 4]).buffer);
  assert.deepEqual(result, { accepted: true, failedOutputs: 0 });

  await engine.stop();
  assert.equal(engine.isActive(), false);
  for (const platform of ['twitch', 'youtube']) {
    assert.ok(events.some((event) => event.platform === platform && event.status === 'stopped'));
  }
  await assert.rejects(engine.pushChunk(new Uint8Array([1]).buffer), /Aucune sortie/);
});

test('an encoder that exits reports its destination and releases the session', async (t) => {
  const { engine, events } = harness(t, { fail: 'HTTP error 401 Unauthorized' });
  await engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS });
  const failure = await waitFor(events, (event) => event.status === 'error');
  assert.equal(failure.platform, 'twitch');
  assert.match(failure.message, /refusé la clé/);
  assert.equal(engine.isActive(), false);
});

test('a destination without credentials aborts before any encoder is spawned', async (t) => {
  const { engine, events } = harness(t);
  await assert.rejects(
    engine.start({ platforms: ['twitch', 'youtube'], profileName: 'balanced', credentials: { twitch: CREDENTIALS.twitch } }),
    /incomplets/,
  );
  assert.equal(engine.isActive(), false);
  assert.equal(events.length, 0);
});

test('duplicate, unknown, empty and concurrent sessions are refused', async (t) => {
  const { engine } = harness(t);
  await assert.rejects(engine.start({ platforms: ['twitch', 'twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /deux fois/);
  await assert.rejects(engine.start({ platforms: ['kick'], profileName: 'balanced', credentials: CREDENTIALS }), /non prise en charge/);
  await assert.rejects(engine.start({ platforms: [], profileName: 'balanced', credentials: CREDENTIALS }), /entre une et 4 destinations/);
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'ultra', credentials: CREDENTIALS }), /Préréglage vidéo inconnu/);

  await engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS });
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /déjà en cours/);
  await engine.stop();
});

test('a build without any H.264 encoder is rejected before going live', async (t) => {
  const { engine } = harness(t, { encoders: ENCODERS.replace(/^.*h264_mf.*$/m, '') });
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /Aucun encodeur H\.264/);
  assert.equal(engine.isActive(), false);
});

test('the encoder ladder keeps the first candidate that really encodes', async (t) => {
  const ladder = ENCODERS.replace(' V....D h264_mf', ' V....D h264_nvenc           NVIDIA NVENC\n V....D h264_mf');
  const { engine, events } = harness(t, { encoders: ladder });
  await engine.start({ platforms: ['twitch'], profileName: 'smooth', credentials: CREDENTIALS });
  const encoding = await waitFor(events, (event) => event.status === 'encoding');
  assert.match(encoding.message, /NVIDIA NVENC/);
  await engine.stop();
});

test('a candidate the machine cannot run is skipped for the next one', async (t) => {
  const ladder = ENCODERS.replace(' V....D h264_mf', ' V....D h264_nvenc           NVIDIA NVENC\n V....D h264_mf');
  const { engine, events } = harness(t, { encoders: ladder, failProbe: ['h264_nvenc'] });
  await engine.start({ platforms: ['twitch'], profileName: 'smooth', credentials: CREDENTIALS });
  const encoding = await waitFor(events, (event) => event.status === 'encoding');
  assert.match(encoding.message, /Windows Media Foundation/);
  await engine.stop();
});

test('a build without the AAC encoder is rejected before going live', async (t) => {
  const { engine } = harness(t, { encoders: ENCODERS.replace(/^.*A\.\.\.\.D aac.*$/m, '') });
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /audio AAC est absent/);
});

test('the engine refuses to run outside the Windows x64 application', async () => {
  const events = [];
  const engine = createStreamEngine({
    app: { isPackaged: false },
    emit: (event) => events.push(event),
    deps: { platform: 'linux', arch: 'x64', resolveExecutable: () => '/nonexistent/ffmpeg' },
  });
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /Windows x64/);
  assert.equal(engine.isActive(), false);
});

test('a missing FFmpeg binary is reported with the packaging hint', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camton-engine-missing-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const engine = createStreamEngine({
    app: { isPackaged: true },
    emit: () => {},
    deps: { platform: 'win32', arch: 'x64', resolveExecutable: () => path.join(dir, 'ffmpeg.exe') },
  });
  await assert.rejects(engine.start({ platforms: ['twitch'], profileName: 'balanced', credentials: CREDENTIALS }), /FFmpeg absent/);
});
