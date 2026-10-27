import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaComponents, detectMirrorAxis, pairTwins, zonesToRegions, blobGray, twinRelation, inferDecalPairs, applyOrientation } from '../js/zones.js';
import { createRegionMap, parseRegionMap, mirrorPointKind } from '../js/regions.js';

// ---------------------------------------------------------------- test pictures

const picture = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

// set every pixel of a box with set(px, py) → grey value, or null to leave it
function draw(img, x, y, w, h, set) {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const v = set(px, py);
      if (v === null) continue;
      img.data.set([v, v, v, 255], ((y + py) * img.width + x + px) * 4);
    }
  }
}
const box = (img, x, y, w, h) => draw(img, x, y, w, h, () => 200);

// A "P"-like mark that looks different turned, flipped or as is: a dark bar
// down the right, a mid-grey bar across the top, a bright spot bottom left.
function mark(img, x, y, w, h, how = 'same') {
  draw(img, x, y, w, h, (px, py) => {
    const u = how === 'rot180' ? w - 1 - px : px;
    const v = how === 'rot180' || how === 'flipV' ? h - 1 - py : py;
    if (u > w * 0.7) return 70;
    if (v < h * 0.2) return 150;
    if (u < w * 0.3 && v > h * 0.7) return 250;
    return null;
  });
}

// ---------------------------------------------------------------- blocks

test('alphaComponents boxes each block, top to bottom then left to right', () => {
  const img = picture(160, 160);
  box(img, 90, 10, 30, 25);
  box(img, 5, 10, 40, 15);
  box(img, 60, 100, 35, 50);
  const found = alphaComponents(img, 100);
  assert.deepEqual(found.map(b => [b.x, b.y, b.w, b.h, b.area]), [[5, 10, 40, 15, 600], [90, 10, 30, 25, 750], [60, 100, 35, 50, 1750]]);
});

test('alphaComponents joins touching boxes, not corner to corner, and drops small ones', () => {
  const img = picture(80, 80);
  box(img, 10, 10, 20, 20);
  box(img, 30, 15, 6, 10);  // touches the first box's side
  box(img, 36, 30, 20, 20); // only meets the first at a corner
  box(img, 70, 70, 5, 5);   // 25 px
  const found = alphaComponents(img, 50);
  assert.deepEqual(found.map(b => [b.x, b.y, b.w, b.h]), [[10, 10, 26, 20], [36, 30, 20, 20]]);
});

test('alphaComponents counts only alpha above thresh', () => {
  const img = picture(20, 20);
  box(img, 0, 0, 10, 10);
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) img.data[i] = 100;
  assert.equal(alphaComponents(img, 1, 99).length, 1);
  assert.equal(alphaComponents(img, 1, 100).length, 0);
});

// ---------------------------------------------------------------- the fold and twins

test('detectMirrorAxis finds a fold away from 1024 when two pairs agree on it', () => {
  // two pairs folding at y 800, and a box with no twin
  const rects = [
    { x: 300, y: 100, w: 200, h: 80 }, { x: 300, y: 1420, w: 200, h: 80 },
    { x: 1200, y: 500, w: 90, h: 60 }, { x: 1200, y: 1040, w: 90, h: 60 },
    { x: 700, y: 650, w: 150, h: 300 },
  ];
  assert.equal(detectMirrorAxis(rects), 800);
  assert.equal(detectMirrorAxis(rects.slice(0, 2)), 1024); // one pair could be chance
  assert.equal(detectMirrorAxis([]), 1024);
  assert.equal(detectMirrorAxis([], { fallback: 512 }), 512);
});

test('detectMirrorAxis snaps a fold within tol of 1024 to 1024', () => {
  const rects = [
    { x: 0, y: 900, w: 50, h: 50 }, { x: 0, y: 1102, w: 50, h: 50 },
    { x: 100, y: 800, w: 50, h: 50 }, { x: 100, y: 1202, w: 50, h: 50 },
  ];
  assert.equal(detectMirrorAxis(rects), 1024);
});

test('pairTwins pairs boxes either side of the fold, each box once', () => {
  const rects = [
    { x: 200, y: 950, w: 300, h: 50 },
    { x: 200, y: 1048, w: 300, h: 50 }, // twin of 0
    { x: 203, y: 1048, w: 300, h: 50 }, // would also fit 0, but 0 is taken
    { x: 900, y: 400, w: 120, h: 40 },
    { x: 900, y: 1608, w: 120, h: 40 }, // twin of 3
    { x: 1500, y: 960, w: 100, h: 128 }, // across the fold
  ];
  assert.deepEqual(pairTwins(rects, 1024, 6), [[0, 1], [3, 4]]);
});

// ---------------------------------------------------------------- boxes as regions

test('zonesToRegions numbers boxes top to bottom, pairs twins, and avoids taken ids', () => {
  const zones = [
    { kind: 'number', x: 900, y: 1580, w: 70, h: 50 },
    { kind: 'sponsor', x: 200, y: 1064, w: 300, h: 60 },
    { kind: 'sponsor', x: 200, y: 924, w: 300, h: 60 },
    { kind: 'number', x: 900, y: 418, w: 70, h: 50 },
    { kind: 'sponsor', x: 1500, y: 960, w: 100, h: 128 },
  ];
  const map = createRegionMap('test car');
  map.regions.push({ id: 'number_1', name: 'mine', x: 0, y: 0, w: 5, h: 5 });
  const { regions, axis } = zonesToRegions(zones, map);
  assert.equal(axis, 1024);
  assert.deepEqual(regions.map(r => [r.id, r.name]), [
    ['number_1_2', 'Number 1 (70×50)'],
    ['sponsor_1', 'Sponsor 1 (300×60)'],
    ['sponsor_2', 'Sponsor 2 (100×128)'],
    ['sponsor_3', 'Sponsor 3 (300×60)'],
    ['number_2', 'Number 2 (70×50)'],
  ]);
  const pick = (id) => regions.find(r => r.id === id);
  assert.equal(pick('sponsor_1').mirror, 'sponsor_3');
  assert.equal(pick('sponsor_3').mirror, 'sponsor_1');
  assert.equal(pick('number_1_2').mirror, 'number_2');
  assert.equal(pick('sponsor_2').mirror, undefined);
  assert.ok(regions.every(r => r.rot === 0 && (!r.mirror || r.mirrorKind === 'flipV')));
  // and a map holding them reads back with kind and mirrorKind kept
  const back = parseRegionMap({ ...map, regions: [...map.regions, ...regions] });
  const s1 = back.regions.find(r => r.id === 'sponsor_1');
  assert.deepEqual([s1.kind, s1.mirrorKind, s1.rot], ['sponsor', 'flipV', undefined]); // rot 0 is not stored
});

test('zonesToRegions takes a fold it is given', () => {
  const zones = [{ kind: 'sponsor', x: 0, y: 100, w: 50, h: 20 }, { kind: 'sponsor', x: 0, y: 380, w: 50, h: 20 }];
  const { regions, axis } = zonesToRegions(zones, null, { axis: 250 });
  assert.equal(axis, 250);
  assert.equal(regions[0].mirror, regions[1].id);
});

// ---------------------------------------------------------------- reading the decals

test('twinRelation tells a turned twin, a flipped twin and a copy apart', () => {
  const img = picture(200, 200);
  mark(img, 0, 0, 30, 50);
  mark(img, 50, 0, 30, 50, 'rot180');
  mark(img, 100, 0, 30, 50, 'flipV');
  mark(img, 150, 0, 30, 50);
  const grey = (x) => blobGray(img, { x, y: 0, w: 30, h: 50 });
  const A = grey(0);
  assert.equal(twinRelation(A, grey(50)).kind, 'rot180');
  assert.equal(twinRelation(A, grey(100)).kind, 'flipV');
  const copy = twinRelation(A, grey(150));
  assert.equal(copy.kind, 'same');
  assert.ok(copy.margin > 0.1);
});

test('blobGray weights brightness by alpha', () => {
  const img = picture(2, 1);
  img.data.set([255, 255, 255, 255, 100, 0, 0, 51]);
  const g = blobGray(img, { x: 0, y: 0, w: 2, h: 1 });
  assert.ok(Math.abs(g.data[0] - 255) < 1e-3);
  assert.ok(Math.abs(g.data[1] - 6) < 1e-3); // 0.3 × 100 × 0.2
});

test('inferDecalPairs reads twin decals across the fold and skips ones too even to read', () => {
  const img = picture(300, 2048);
  mark(img, 20, 200, 30, 50);
  mark(img, 20, 1798, 30, 50, 'rot180');
  mark(img, 120, 600, 30, 50);
  mark(img, 120, 1398, 30, 50, 'flipV');
  box(img, 220, 300, 25, 25); // squares read the same every way
  box(img, 220, 1723, 25, 25);
  const pairs = inferDecalPairs(img, { minArea: 300, axis: 1024 });
  assert.deepEqual(pairs.map(p => [p.a.x, p.a.y, p.b.y, p.kind]), [[20, 200, 1798, 'rot180'], [120, 600, 1398, 'flipV']]);
});

test('applyOrientation turns the upper of a rot180 pair, leaves flipV upright and the middle alone', () => {
  const r = (id, x, y, w, h, mirror) => ({ id, x, y, w, h, kind: 'sponsor', rot: 0, ...(mirror && { mirror, mirrorKind: 'flipV' }) });
  const regions = [
    r('top_a', 20, 150, 120, 50, 'bottom_a'), r('bottom_a', 20, 1848, 120, 50, 'top_a'),
    r('top_b', 400, 650, 120, 50, 'bottom_b'), r('bottom_b', 400, 1348, 120, 50, 'top_b'),
    r('middle', 800, 950, 80, 200),
    r('loose', 0, 50, 40, 40),
  ];
  const pairs = [
    { a: { x: 30, y: 200, w: 30, h: 50 }, b: { x: 30, y: 1798, w: 30, h: 50 }, kind: 'rot180', margin: 0.4 },
    { a: { x: 420, y: 600, w: 30, h: 50 }, b: { x: 420, y: 1398, w: 30, h: 50 }, kind: 'flipV', margin: 0.4 },
  ];
  assert.equal(applyOrientation(regions, pairs, 1024), 3);
  assert.deepEqual(regions.map(x => [x.id, x.rot, x.mirrorKind]), [
    ['top_a', 180, 'rot180'], ['bottom_a', 0, 'rot180'],
    ['top_b', 0, 'flipV'], ['bottom_b', 0, 'flipV'],
    ['middle', 0, undefined],
    ['loose', 180, undefined],
  ]);
  assert.equal(applyOrientation(regions, pairs, 1024), 0); // nothing left to change
  assert.equal(applyOrientation(regions, [], 1024), 0);
});

test('applyOrientation: twins that read differently both take the nearer reading', () => {
  const regions = [
    { id: 'up', x: 0, y: 100, w: 60, h: 40, rot: 0, mirror: 'down', mirrorKind: 'flipV' },
    { id: 'down', x: 0, y: 1908, w: 60, h: 40, rot: 0, mirror: 'up', mirrorKind: 'flipV' },
  ];
  const pairs = [
    { a: { x: 10, y: 110, w: 20, h: 20 }, b: { x: 900, y: 1500, w: 20, h: 20 }, kind: 'rot180', margin: 0.5 }, // near 'up'
    { a: { x: 900, y: 500, w: 20, h: 20 }, b: { x: 10, y: 1700, w: 20, h: 20 }, kind: 'same', margin: 0.5 },  // nearer 'down', but not as near
  ];
  applyOrientation(regions, pairs, 1024);
  assert.deepEqual(regions.map(x => [x.rot, x.mirrorKind]), [[180, 'rot180'], [0, 'rot180']]);
});

// ---------------------------------------------------------------- twin kinds in maps (regions.js)

test('mirrorPointKind moves a point to the same spot in the twin, as the kind says', () => {
  const a = { x: 0, y: 0, w: 200, h: 100 }, b = { x: 500, y: 500, w: 100, h: 50 };
  assert.deepEqual(mirrorPointKind(a, b, 50, 20, 'flip'), { x: 575, y: 510 });
  assert.deepEqual(mirrorPointKind(a, b, 50, 20, 'flipV'), { x: 525, y: 540 });
  assert.deepEqual(mirrorPointKind(a, b, 50, 20, 'rot180'), { x: 575, y: 540 });
  assert.deepEqual(mirrorPointKind(a, b, 50, 20, 'same'), { x: 525, y: 510 });
});

test('a map keeps a twin kind only with a twin, and drops kinds, turns and zone types it does not know', () => {
  const map = parseRegionMap({
    format: 'overspray-regions/1', car: 't',
    regions: [
      { id: 'p', x: 0, y: 0, w: 10, h: 10, mirror: 'q', mirrorKind: 'rot180', rot: 90, kind: 'number' },
      { id: 'q', x: 0, y: 20, w: 10, h: 10, mirror: 'p', mirrorKind: 'upside', rot: 30, kind: 'bonnet' },
      { id: 's', x: 50, y: 0, w: 10, h: 10, mirrorKind: 'flipV' },
    ] });
  const [p, q, s] = map.regions;
  assert.deepEqual([p.mirrorKind, p.rot, p.kind], ['rot180', 90, 'number']);
  assert.deepEqual([q.mirrorKind, q.rot, q.kind], [undefined, undefined, undefined]);
  assert.equal(s.mirrorKind, undefined);
});
