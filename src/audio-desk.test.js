import test from 'node:test';
import assert from 'node:assert/strict';

import { describeSourceCapture } from './audio-desk.js';

function fakeStream(tracks) {
  return { getAudioTracks: () => tracks };
}

test('une capture sans piste audio est signalée', () => {
  assert.deepEqual(describeSourceCapture(fakeStream([])), { label: 'Capture sans son système', warning: true });
  assert.deepEqual(describeSourceCapture(fakeStream([{ readyState: 'ended' }])), { label: 'Capture sans son système', warning: true });
});

test('une capture avec son annonce le son système', () => {
  assert.deepEqual(describeSourceCapture(fakeStream([{ readyState: 'live' }]), { muted: false, volume: 0.7 }), { label: 'Son système capté', warning: false });
});

test('une piste coupée ou à zéro est nommée', () => {
  const stream = fakeStream([{ readyState: 'live' }]);
  assert.match(describeSourceCapture(stream, { muted: true, volume: 1 }).label, /coupée/);
  assert.match(describeSourceCapture(stream, { muted: false, volume: 0 }).label, /volume à 0/);
});

test('aucune capture ne produit aucune mention', () => {
  assert.equal(describeSourceCapture(null), null);
});
