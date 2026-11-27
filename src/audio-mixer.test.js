import test from 'node:test';
import assert from 'node:assert/strict';

import { AUDIO_CONTEXT_OPTIONS, AudioMixer, TRACK_KINDS, clampVolume, levelPercent, resolveTrackGains } from './audio-mixer.js';

// AudioContext factice : même contrat que l’API Web Audio, sans navigateur.
function createStubContext() {
  const nodes = [];
  const makeNode = (type) => {
    const node = {
      type,
      targets: [],
      gain: { value: 1 },
      fftSize: 0,
      frequencyBinCount: 128,
      level: 0,
      connect(target) {
        node.targets.push(target);
        return target;
      },
      disconnect() {
        node.targets.length = 0;
      },
      getByteTimeDomainData(data) {
        data.fill(128 + Math.round(node.level * 127));
      },
    };
    nodes.push(node);
    return node;
  };
  return {
    nodes,
    state: 'running',
    async resume() {},
    async close() {},
    createGain: () => makeNode('gain'),
    createDynamicsCompressor: () => {
      const node = makeNode('compressor');
      node.threshold = { value: 0 };
      node.knee = { value: 0 };
      node.ratio = { value: 1 };
      node.attack = { value: 0.003 };
      node.release = { value: 0.25 };
      return node;
    },
    createAnalyser: () => makeNode('analyser'),
    createMediaStreamSource: () => makeNode('streamSource'),
    createMediaElementSource: () => makeNode('elementSource'),
    createMediaStreamDestination: () => {
      const node = makeNode('destination');
      node.stream = { getAudioTracks: () => [{ kind: 'audio' }] };
      return node;
    },
  };
}

function createMixer() {
  const context = createStubContext();
  const mixer = new AudioMixer({
    createContext: () => context,
    createStream: (tracks) => ({ tracks, getAudioTracks: () => tracks }),
  });
  return { mixer, context };
}

const audioStream = () => ({ getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }] });
const emptyStream = () => ({ getAudioTracks: () => [] });

test('les pistes ont un volume par défaut propre à leur nature', () => {
  assert.equal(TRACK_KINDS.mic.volume, 1);
  assert.equal(TRACK_KINDS.source.volume, 0.7);
  assert.equal(TRACK_KINDS.music.volume, 0.6);
});

test('clampVolume borne et sécurise les valeurs', () => {
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('0.4'), 0.4);
  assert.equal(clampVolume('abc'), 0);
  assert.equal(clampVolume(Number.NaN), 0);
});

test('resolveTrackGains coupe les pistes muettes', () => {
  const gains = resolveTrackGains([
    { id: 'mic', volume: 1, muted: false, solo: false },
    { id: 'music', volume: 0.6, muted: true, solo: false },
  ]);
  assert.equal(gains.get('mic'), 1);
  assert.equal(gains.get('music'), 0);
});

test('resolveTrackGains isole la piste en solo', () => {
  const gains = resolveTrackGains([
    { id: 'mic', volume: 1, muted: false, solo: false },
    { id: 'mic2', volume: 1, muted: false, solo: true },
    { id: 'source', volume: 0.7, muted: false, solo: false },
  ]);
  assert.equal(gains.get('mic'), 0);
  assert.equal(gains.get('mic2'), 1);
  assert.equal(gains.get('source'), 0);
});

test('une piste muette reste muette même en solo', () => {
  const gains = resolveTrackGains([{ id: 'mic', volume: 1, muted: true, solo: true }]);
  assert.equal(gains.get('mic'), 0);
});

test('levelPercent convertit une amplitude en largeur de vu-mètre', () => {
  assert.equal(levelPercent(0), 0);
  assert.equal(levelPercent(0.001), 3);
  assert.equal(levelPercent(0.1), 36);
  assert.equal(levelPercent(0.9), 100);
  assert.equal(levelPercent(Number.NaN), 0);
});

test('le contexte, le master et la destination sont créés une seule fois', async () => {
  const { mixer, context } = createMixer();
  await mixer.ensureContext();
  await mixer.ensureContext();
  assert.equal(context.nodes.filter((node) => node.type === 'destination').length, 1);
  assert.equal(context.nodes.filter((node) => node.type === 'gain').length, 1);
  assert.equal(context.nodes.filter((node) => node.type === 'compressor').length, 1);
  assert.ok(mixer.master.targets.includes(mixer.limiter));
  assert.ok(mixer.limiter.targets.includes(mixer.destination));
});

test('un limiteur protège la sortie de l’écrêtage', async () => {
  const { mixer } = createMixer();
  await mixer.ensureContext();
  assert.equal(mixer.limiter.threshold.value, -3);
  assert.equal(mixer.limiter.ratio.value, 20);
  assert.equal(mixer.limiter.knee.value, 0);
});

test('une piste attachée traverse gain, analyseur puis master', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  assert.equal(await mixer.attachStream('mic', audioStream()), true);

  const track = mixer.tracks.get('mic');
  assert.equal(track.source.targets[0], track.gainNode);
  assert.equal(track.gainNode.targets[0], track.analyser);
  assert.equal(track.analyser.targets[0], mixer.master);
  assert.equal(track.gainNode.gain.value, 1);
});

test('un flux sans piste audio n’est pas attaché', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  assert.equal(await mixer.attachStream('mic', emptyStream()), false);
  assert.equal(mixer.isAttached('mic'), false);
});

test('le volume, le mute et le solo pilotent le gain réel', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  mixer.createTrack({ id: 'music', kind: 'music' });
  await mixer.attachStream('mic', audioStream());
  await mixer.attachStream('music', audioStream());

  mixer.setVolume('music', 0.3);
  assert.equal(mixer.tracks.get('music').gainNode.gain.value, 0.3);

  mixer.setMuted('music', true);
  assert.equal(mixer.tracks.get('music').gainNode.gain.value, 0);

  mixer.setMuted('music', false);
  mixer.setSolo('music', true);
  assert.equal(mixer.tracks.get('music').gainNode.gain.value, 0.3);
  assert.equal(mixer.tracks.get('mic').gainNode.gain.value, 0);
});

test('le master se coupe indépendamment des pistes', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  await mixer.attachStream('mic', audioStream());
  mixer.setMasterMuted(true);
  assert.equal(mixer.master.gain.value, 0);
  mixer.setMasterMuted(false);
  mixer.setMasterVolume(0.5);
  assert.equal(mixer.master.gain.value, 0.5);
});

test('détacher et retirer une piste libère ses nœuds', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'music', kind: 'music' });
  await mixer.attachStream('music', audioStream());
  const track = mixer.tracks.get('music');
  const source = track.source;

  mixer.removeTrack('music');
  assert.equal(source.targets.length, 0);
  assert.equal(mixer.tracks.has('music'), false);
});

test('le flux de sortie contient l’audio mixé', async () => {
  const { mixer } = createMixer();
  await mixer.ensureContext();
  const output = mixer.getOutputStream();
  assert.equal(output.getAudioTracks().length, 1);
});

test('readLevels renvoie un niveau par piste et pour le master', async () => {
  const { mixer } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  await mixer.attachStream('mic', audioStream());
  mixer.tracks.get('mic').analyser.level = 0.5;
  mixer.masterAnalyser.level = 0.25;

  const { tracks, master } = mixer.readLevels();
  assert.ok(tracks.get('mic') > 0.4);
  assert.ok(master > 0.2);
});

test('dispose ferme le contexte et vide les pistes', async () => {
  const { mixer, context } = createMixer();
  mixer.createTrack({ id: 'mic', kind: 'mic' });
  await mixer.attachStream('mic', audioStream());
  let closed = false;
  context.close = async () => {
    closed = true;
  };
  await mixer.dispose();
  assert.equal(mixer.tracks.size, 0);
  assert.equal(mixer.context, null);
  assert.equal(closed, true);
});

test('une piste musique coupée puis réactivée réutilise le même nœud source', async () => {
  const { mixer, context } = createMixer();
  mixer.createTrack({ id: 'music', kind: 'music', volume: 0.6 });
  const element = { pause() {}, currentTime: 0 };
  let created = 0;
  const original = context.createMediaElementSource;
  context.createMediaElementSource = (target) => {
    created += 1;
    return original(target);
  };
  assert.equal(await mixer.attachElement('music', element), true);
  mixer.detach('music');
  assert.equal(mixer.tracks.get('music').inputNode, null);
  assert.equal(await mixer.attachElement('music', element), true);
  assert.equal(created, 1, 'createMediaElementSource ne doit être appelé qu’une fois');
  assert.ok(mixer.tracks.get('music').inputNode, 'la piste est réarmée');
});

test('le contexte audio tourne en 48 kHz avec un tampon large', async () => {
  assert.equal(AUDIO_CONTEXT_OPTIONS.sampleRate, 48000);
  assert.equal(AUDIO_CONTEXT_OPTIONS.latencyHint, 'playback');
});
