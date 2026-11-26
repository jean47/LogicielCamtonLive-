import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { compareVersions, parseNotes, shouldAnnounce } from './whats-new.js';

const readJson = (relative) => JSON.parse(readFileSync(path.join(import.meta.dirname, '..', relative), 'utf8'));

test('parseNotes transforme un texte en puces propres', () => {
  const notes = parseNotes('- Micro séparé\n• Musique locale\n\n- Master général');
  assert.deepEqual(notes, ['Micro séparé', 'Musique locale', 'Master général']);
});

test('parseNotes ignore les lignes vides et les fragments trop courts', () => {
  assert.deepEqual(parseNotes('\n\n-\n  \nPiste ajoutée'), ['Piste ajoutée']);
  assert.deepEqual(parseNotes(''), []);
  assert.deepEqual(parseNotes(undefined), []);
});

test('parseNotes limite le nombre de puces affichées', () => {
  const text = Array.from({ length: 30 }, (_, index) => `ligne ${index}`).join('\n');
  assert.equal(parseNotes(text).length, 12);
});

test('compareVersions ordonne correctement les versions', () => {
  assert.equal(compareVersions('0.4.4', '0.4.3'), 1);
  assert.equal(compareVersions('0.4.3', '0.4.4'), -1);
  assert.equal(compareVersions('0.4.4', '0.4.4'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v1.2', '1.2.0'), 0);
  assert.equal(compareVersions('', '0.1'), -1);
});

test('shouldAnnounce déclenche le pop-up au premier lancement et après mise à jour', () => {
  assert.equal(shouldAnnounce({ currentVersion: '0.4.4' }), true);
  assert.equal(shouldAnnounce({ currentVersion: '0.4.4', lastSeenVersion: '0.4.3' }), true);
  assert.equal(shouldAnnounce({ currentVersion: '0.4.4', lastSeenVersion: '0.4.4' }), false);
  assert.equal(shouldAnnounce({ currentVersion: '0.4.3', lastSeenVersion: '0.4.4' }), false);
  assert.equal(shouldAnnounce({}), false);
});

test('les nouveautés embarquées correspondent à la version du paquet', () => {
  const notes = readJson('src/release-notes.json');
  const pkg = readJson('package.json');
  assert.equal(notes.version, pkg.version, 'src/release-notes.json doit suivre la version de package.json');
  assert.ok(notes.notes.length >= 3);
});
