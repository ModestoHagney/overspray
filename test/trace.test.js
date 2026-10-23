import test from 'node:test';
import assert from 'node:assert/strict';
import { traceImage, flatColours, contours, simplify, paintColours, specAreas } from '../js/trace.js';
import { flatten, pieces as piecesOf } from '../js/shapes.js';

// a picture as RGBA pixels, painted by f(x, y) → [r, g, b] or [r, g, b, a]
function picture(w, h, f) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y), o = (y * w + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3] ?? 255; }
  return px;
}
const WHITE = [255, 255, 255], GREEN = [0, 112, 60], CREAM = [251, 220, 180];
// the area an outline fills: each piece counted the way it is turned, so a hole takes away
const areaOf = (pts) => Math.abs(piecesOf(pts).reduce((sum, [a, b]) => { const f = flatten(pts.slice(a, b)); return sum + f.reduce((s, p, i) => { const q = f[(i + 1) % f.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2; }, 0));

test('a square on white: the white round it is dropped, the square comes out at its size', () => {
  const px = picture(40, 30, (x, y) => (x >= 10 && x < 30 && y >= 5 && y < 25 ? GREEN : WHITE));
  const got = traceImage(px, 40, 30);
  assert.deepEqual(got.map((g) => g.color), ['#00703c']);
  assert.ok(Math.abs(areaOf(got[0].pts) - 400) < 6, 'area ' + areaOf(got[0].pts));
  assert.ok(got[0].pts.length <= 12, 'a square needs few points, got ' + got[0].pts.length);
});

test('a ring: the hole stays a hole, and the white shut inside another shape is kept as a shape', () => {
  // green ring with a white middle; beside it a cream square with nothing in it
  const ring = (x, y) => { const d = Math.hypot(x - 20, y - 20); return d < 15 && d >= 8; };
  const px = picture(70, 40, (x, y) => (ring(x, y) ? GREEN : x >= 45 && x < 65 && y >= 10 && y < 30 ? CREAM : WHITE));
  const got = traceImage(px, 70, 40);
  const by = Object.fromEntries(got.map((g) => [g.color, g]));
  assert.deepEqual(Object.keys(by).sort(), ['#00703c', '#fbdcb4', '#ffffff']);
  const ringArea = Math.PI * (15 * 15 - 8 * 8);
  assert.ok(Math.abs(areaOf(by['#00703c'].pts) - ringArea) < ringArea * 0.05, 'ring area ' + areaOf(by['#00703c'].pts) + ' wanted ' + ringArea);
  assert.equal(piecesOf(by['#00703c'].pts).length, 2);                                   // the outside and the hole
  assert.ok(Math.abs(areaOf(by['#ffffff'].pts) - Math.PI * 64) < Math.PI * 64 * 0.08);   // the white in the middle of the ring
  assert.ok(Math.abs(areaOf(by['#fbdcb4'].pts) - 400) < 6);
});

test('a soft edge is followed where it is half way, and leaves no rim of a third colour', () => {
  // green meeting cream along a slanted line, with the in-between pixels a picture has there
  const px = picture(60, 40, (x, y) => { const t = Math.max(0, Math.min(1, (x + y * 0.5 - 35) / 1.5 + 0.5)); return GREEN.map((g, i) => g + (CREAM[i] - g) * t); });
  const got = traceImage(px, 60, 40);
  assert.deepEqual(got.map((g) => g.color).sort(), ['#00703c', '#fbdcb4']); // neither is in three corners: there is no background to drop
  const total = got.reduce((s, g) => s + areaOf(g.pts), 0);
  assert.ok(Math.abs(total - 60 * 40) < 12, 'the two shapes meet with no gap: ' + total);
});

test('see-through pixels are no shape, and specks are left out', () => {
  const px = picture(30, 30, (x, y) => (x === 3 && y === 3 ? GREEN : Math.hypot(x - 15, y - 15) < 9 ? [...GREEN, 255] : [0, 0, 0, 0]));
  const got = traceImage(px, 30, 30);
  assert.equal(got.length, 1);
  assert.equal(piecesOf(got[0].pts).length, 1);
  assert.ok(Math.abs(areaOf(got[0].pts) - Math.PI * 81) < Math.PI * 81 * 0.06);
});

test('the parts: colours most used first, closed loops, fewer points after simplifying', () => {
  const px = picture(20, 20, (x) => (x < 14 ? WHITE : GREEN));
  assert.deepEqual(flatColours(px, 20, 20).map((c) => c.map(Math.round)), [WHITE, GREEN]);
  const field = new Float32Array(100).map((_, i) => (i % 10 >= 3 && i % 10 < 7 && i >= 30 && i < 70 ? 1 : 0));
  const loops = contours(field, 10, 10);
  assert.equal(loops.length, 1);
  assert.ok(simplify(loops[0]).length < loops[0].length);
});

test('a mask: a solid background with a see-through cut-out gives the cut-out as a shape', () => {
  // white all over, a clear disc cut out of it, a cream patch beside it
  const px = picture(60, 40, (x, y) => (Math.hypot(x - 18, y - 20) < 10 ? [0, 0, 0, 0] : x >= 38 && x < 52 && y >= 12 && y < 28 ? CREAM : WHITE));
  const got = traceImage(px, 60, 40);
  assert.deepEqual(got.map((g) => g.color), [null, '#fbdcb4']);            // the cut-out first, with no colour of its own
  assert.ok(Math.abs(areaOf(got[0].pts) - Math.PI * 100) < Math.PI * 100 * 0.05);
  // and a picture whose own background is see-through has no such thing: the hole in a ring stays a hole
  const ring = picture(40, 40, (x, y) => { const d = Math.hypot(x - 20, y - 20); return d < 15 && d >= 8 ? GREEN : [0, 0, 0, 0]; });
  assert.deepEqual(traceImage(ring, 40, 40).map((g) => g.color), ['#00703c']);
});

test('paint colours: the ones covering enough of the sheet, named after a one-colour picture, none already saved', () => {
  const blue = { name: 'Blue', px: picture(20, 20, () => [0, 0, 255]), w: 20, h: 20, weight: 100 };
  const mixed = { name: 'Logo', px: picture(20, 20, (x) => (x < 10 ? WHITE : x < 17 ? GREEN : CREAM)), w: 20, h: 20, weight: 50 };
  const got = paintColours([blue, mixed], { total: 1e6 }); // the cream strip is under 0.5%
  assert.deepEqual(got, [{ name: 'Blue', color: '#0000ff' }, { name: null, color: '#ffffff' }, { name: null, color: '#00703c' }]);
  assert.deepEqual(paintColours([blue, mixed], { total: 1e6, have: ['#0000fe'] }).map((c) => c.color), ['#ffffff', '#00703c']);
});

test('a spec map: the corners give the base finish, each other finish is an area', () => {
  const MATTE = [0, 204, 0], CHROME = [255, 0, 0];
  const px = picture(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? CHROME : MATTE));
  const got = specAreas(px, 40, 40);
  assert.deepEqual(got.base.map(Math.round), MATTE);
  assert.equal(got.areas.length, 1);
  assert.deepEqual(got.areas[0].rgb.map(Math.round), CHROME);
  assert.ok(Math.abs(areaOf(got.areas[0].pts) - 400) < 20);
});
