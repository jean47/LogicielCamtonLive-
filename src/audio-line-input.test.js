import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LineInputError,
  isVirtualCableLabel,
  listLineInputs,
  openLineInput,
  watchSignal,
} from './audio-line-input.js';

test('reconnaît les câbles virtuels et le mixage stéréo', () => {
  assert.equal(isVirtualCableLabel('CABLE Output (VB-Audio Virtual Cable)'), true);
  assert.equal(isVirtualCableLabel('Mixage stéréo (Realtek)'), true);
  assert.equal(isVirtualCableLabel('Voicemeeter Out B1'), true);
  assert.equal(isVirtualCableLabel('Microphone (Realtek Audio)'), false);
  assert.equal(isVirtualCableLabel(''), false);
});

test('liste les entrées avec les câbles en premier', async () => {
  const mediaDevices = {
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'mic', groupId: 'g1', label: 'Microphone (Realtek)' },
      { kind: 'videoinput', deviceId: 'cam', groupId: 'g2', label: 'Caméra' },
      { kind: 'audioinput', deviceId: 'cable', groupId: 'g3', label: 'CABLE Output (VB-Audio)' },
      { kind: 'audioinput', deviceId: 'default', groupId: 'g1', label: '' },
    ],
  };
  const entries = await listLineInputs(mediaDevices);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].deviceId, 'cable');
  assert.equal(entries[0].likelyCable, true);
  const alias = entries.find((entry) => entry.deviceId === 'default');
  assert.equal(alias.isAlias, true);
  assert.equal(alias.needsPermission, true);
  assert.match(alias.label, /Entrée audio/);
});

test('refuse un identifiant vide', async () => {
  await assert.rejects(() => openLineInput('', { mediaDevices: { getUserMedia: async () => ({}) } }), (error) => {
    assert.ok(error instanceof LineInputError);
    assert.equal(error.code, 'no-device');
    return true;
  });
});

test('ouvre une entrée sans traitement micro', async () => {
  let received = null;
  const stream = {
    getAudioTracks: () => [{ label: 'CABLE Output', getSettings: () => ({ echoCancellation: false, sampleRate: 48000 }) }],
    getTracks: () => [{ stop() {} }],
  };
  const mediaDevices = {
    getUserMedia: async (constraints) => {
      received = constraints;
      return stream;
    },
  };
  const line = await openLineInput('cable', { mediaDevices });
  assert.equal(line.stream, stream);
  assert.equal(line.processingActive, false);
  assert.equal(received.audio.echoCancellation, false);
  assert.equal(received.audio.noiseSuppression, false);
  assert.equal(received.audio.autoGainControl, false);
  assert.deepEqual(received.audio.deviceId, { exact: 'cable' });
});

test('réessaie sans contraintes de format quand le pilote refuse', async () => {
  const calls = [];
  const stream = { getAudioTracks: () => [{ label: 'Ligne', getSettings: () => ({}) }], getTracks: () => [] };
  const mediaDevices = {
    getUserMedia: async (constraints) => {
      calls.push(constraints);
      if (calls.length === 1) {
        const error = new Error('contraintes refusées');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return stream;
    },
  };
  const line = await openLineInput('line', { mediaDevices });
  assert.equal(calls.length, 2);
  assert.equal(line.stream, stream);
});

test('traduit un refus de permission', async () => {
  const mediaDevices = {
    getUserMedia: async () => {
      const error = new Error('refusé');
      error.name = 'NotAllowedError';
      throw error;
    },
  };
  await assert.rejects(() => openLineInput('cable', { mediaDevices }), (error) => {
    assert.equal(error.code, 'permission');
    assert.match(error.message, /confidentialité/i);
    return true;
  });
});

function fakeContext(amplitude) {
  return {
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({
      fftSize: 512,
      getByteTimeDomainData(buffer) {
        for (let index = 0; index < buffer.length; index += 1) {
          buffer[index] = 128 + Math.round(Math.sin(index) * 128 * amplitude);
        }
      },
    }),
    close: async () => {},
  };
}

test('le test de signal détecte du son', async () => {
  const track = { label: 'CABLE Output' };
  const result = await watchSignal(track, {
    durationMs: 60,
    intervalMs: 10,
    createContext: () => fakeContext(0.5),
    createStream: () => ({}),
  });
  assert.equal(result.hasSignal, true);
  assert.ok(result.peak > 0.003);
});

test('le test de signal signale le silence', async () => {
  const result = await watchSignal({}, {
    durationMs: 60,
    intervalMs: 10,
    createContext: () => fakeContext(0),
    createStream: () => ({}),
  });
  assert.equal(result.hasSignal, false);
});
