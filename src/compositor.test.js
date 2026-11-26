import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRect, coverRect, overlayRect } from './compositor.js';

test('la source principale garde ses proportions dans un cadre 16:9', () => {
  const rect = fitRect(1920, 1080, 1280, 720);
  assert.deepEqual(rect, { x: 0, y: 0, width: 1280, height: 720 });
});

test('une source 4:3 est centrée avec des bandes latérales', () => {
  const rect = fitRect(1024, 768, 1280, 720);
  assert.equal(rect.height, 720);
  assert.equal(rect.width, 960);
  assert.equal(rect.x, 160);
  assert.equal(rect.y, 0);
});

test('une source verticale est centrée avec des bandes noires de chaque côté', () => {
  const rect = fitRect(1080, 1920, 1280, 720);
  assert.equal(rect.height, 720);
  assert.equal(rect.width, 405);
  assert.equal(rect.x, 438);
});

test('une source inconnue remplit le cadre sans diviser par zéro', () => {
  assert.deepEqual(fitRect(0, 0, 1280, 720), { x: 0, y: 0, width: 1280, height: 720 });
});

test('la vignette recadre la caméra en 16:9 au lieu de l’étirer', () => {
  const crop = coverRect(640, 480, 280, 158);
  assert.equal(crop.sw, 640, 'la largeur reste entière : on recadre en hauteur');
  assert.equal(crop.sh, Math.round(158 / (280 / 640)));
  assert.equal(crop.sx, 0);
  assert.equal(crop.sy, Math.round((480 - crop.sh) / 2));
  assert.equal(crop.width, 280);
  assert.equal(crop.height, 158);
});

test('la vignette se place dans le coin demandé avec une marge', () => {
  const bottomRight = overlayRect(1280, 720, 'br', 0.22);
  assert.equal(bottomRight.width, 282);
  assert.equal(bottomRight.x, 1280 - 282 - 26);
  assert.equal(bottomRight.y, 720 - bottomRight.height - 26);

  const topLeft = overlayRect(1280, 720, 'tl', 0.22);
  assert.equal(topLeft.x, 26);
  assert.equal(topLeft.y, 26);

  const topRight = overlayRect(1280, 720, 'tr', 0.22);
  assert.equal(topRight.x, bottomRight.x);
  assert.equal(topRight.y, 26);
});

test('une taille ou un coin invalide retombe sur les valeurs sûres', () => {
  const rect = overlayRect(1000, 562, 'nord-ouest', 5);
  assert.equal(rect.width, 500, 'la taille est plafonnée à 50 %');
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1000);
  const tiny = overlayRect(1000, 562, 'br', 0.01);
  assert.equal(tiny.width, 100, 'la taille est plancher à 10 %');
});
