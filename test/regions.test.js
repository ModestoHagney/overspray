import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS_FORMAT, createRegionMap, parseRegionMap, regionById, regionAt, mirrorPoint, uniqueRegionId, detectPieces, piecesRegionMap, simplifyOutline, renameRegion, labelPoint, pointInPolygon, snapToOutline, slideAlong, edgeSpan, matchPoint, linkPoints, linkLength, linkDir, twinLink, twinOf, syncTwin, addTwins, nearestIsStretch, setMirrorKind, seamPieces, centerLine, mirrorAcross, setMirror, trimShape, growOutline, guessMirrorKind, regionOutline } from '../js/regions.js';

// Convenience builder: a valid raw map with two mirrored door rectangles.
function rawMap(overrides = {}) {
  return {
    format: REGIONS_FORMAT,
    car: 'test car',
    regions: [
      { id: 'door_l', name: 'Left Door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r' },
      { id: 'door_r', name: 'Right Door', x: 900, y: 200, w: 300, h: 150, mirror: 'door_l' },
    ],
    ...overrides };
}

// ---------------------------------------------------------------- parseRegionMap

test('parseRegionMap accepts a valid map and preserves geometry', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(map.format, REGIONS_FORMAT);
  assert.equal(map.car, 'test car');
  assert.equal(map.regions.length, 2);
  const l = map.regions[0];
  assert.deepEqual(l, {
    id: 'door_l', name: 'Left Door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r' });
});

test('parseRegionMap normalizes a missing name to the id', () => {
  const map = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'hood', x: 0, y: 0, w: 10, h: 10 }] });
  assert.equal(map.regions[0].name, 'hood');
  // empty-string name also falls back to id
  const map2 = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'roof', name: '', x: 0, y: 0, w: 10, h: 10 }] });
  assert.equal(map2.regions[0].name, 'roof');
});

test('parseRegionMap strips unknown extra fields from regions', () => {
  const map = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'hood', x: 0, y: 0, w: 10, h: 10, color: 'red', locked: true }] });
  assert.deepEqual(Object.keys(map.regions[0]).sort(), ['h', 'id', 'name', 'w', 'x', 'y']);
});

test('parseRegionMap keeps a valid mirror field', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(map.regions[0].mirror, 'door_r');
  assert.equal(map.regions[1].mirror, 'door_l');
});

test('parseRegionMap falls back to "unknown car" when car is missing or empty', () => {
  const noCar = rawMap();
  delete noCar.car;
  assert.equal(parseRegionMap(noCar).car, 'unknown car');
  assert.equal(parseRegionMap(rawMap({ car: '' })).car, 'unknown car');
  assert.equal(parseRegionMap(rawMap({ car: 42 })).car, 'unknown car');
});

test('parseRegionMap rejects non-objects', () => {
  assert.throws(() => parseRegionMap(null), /not a region map object/);
  assert.throws(() => parseRegionMap('nope'), /not a region map object/);
  assert.throws(() => parseRegionMap(7), /not a region map object/);
});

test('parseRegionMap rejects a wrong format string', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ format: 'overspray-regions/2' })),
    /unknown format "overspray-regions\/2"/,
  );
  assert.throws(() => parseRegionMap({ regions: [] }), /unknown format/);
});

test('parseRegionMap rejects a missing regions array', () => {
  assert.throws(
    () => parseRegionMap({ format: REGIONS_FORMAT, car: 'c' }),
    /missing "regions" array/,
  );
  assert.throws(
    () => parseRegionMap({ format: REGIONS_FORMAT, regions: {} }),
    /missing "regions" array/,
  );
});

test('parseRegionMap rejects a region without an id', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ x: 0, y: 0, w: 1, h: 1 }] })),
    /region 0 has no id/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: '', x: 0, y: 0, w: 1, h: 1 }] })),
    /region 0 has no id/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [null] })),
    /region 0 is not an object/,
  );
});

test('parseRegionMap rejects duplicate ids', () => {
  assert.throws(
    () => parseRegionMap(rawMap({
      regions: [
        { id: 'a', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', x: 5, y: 5, w: 1, h: 1 },
      ] })),
    /duplicate region id "a"/,
  );
});

test('parseRegionMap rejects non-finite x/y/w/h', () => {
  for (const k of ['x', 'y', 'w', 'h']) {
    for (const bad of [NaN, Infinity, '5', undefined]) {
      const r = { id: 'r', x: 0, y: 0, w: 1, h: 1 };
      r[k] = bad;
      assert.throws(
        () => parseRegionMap(rawMap({ regions: [r] })),
        new RegExp(`region "r" has a bad "${k}"`),
      );
    }
  }
});

test('parseRegionMap rejects non-positive w/h', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: 'r', x: 0, y: 0, w: 0, h: 1 }] })),
    /non-positive size/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: 'r', x: 0, y: 0, w: 1, h: -3 }] })),
    /non-positive size/,
  );
});

test('parseRegionMap rejects a mirror pointing at an unknown id', () => {
  assert.throws(
    () => parseRegionMap(rawMap({
      regions: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, mirror: 'ghost' }] })),
    /region "a" mirrors unknown id "ghost"/,
  );
});

test('createRegionMap defaults car to "unknown car"', () => {
  assert.deepEqual(createRegionMap(), { format: REGIONS_FORMAT, car: 'unknown car', regions: [] });
  assert.equal(createRegionMap('gt3').car, 'gt3');
});

// ---------------------------------------------------------------- regionAt

test('regionAt finds a point inside and returns null outside', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionAt(map, 150, 250).id, 'door_l');
  assert.equal(regionAt(map, 950, 250).id, 'door_r');
  assert.equal(regionAt(map, 50, 50), null);
  assert.equal(regionAt(map, 500, 250), null); // gap between the doors
});

test('regionAt: later (topmost) region wins where rectangles overlap', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'under', x: 0, y: 0, w: 100, h: 100 },
      { id: 'over', x: 50, y: 50, w: 100, h: 100 },
    ] }));
  assert.equal(regionAt(map, 75, 75).id, 'over');   // overlap → topmost
  assert.equal(regionAt(map, 25, 25).id, 'under');  // only in the lower one
});

test('regionAt boundaries are inclusive on all edges', () => {
  const map = parseRegionMap(rawMap({
    regions: [{ id: 'r', x: 10, y: 20, w: 30, h: 40 }] }));
  assert.equal(regionAt(map, 10, 20).id, 'r');   // top-left corner
  assert.equal(regionAt(map, 40, 60).id, 'r');   // bottom-right corner (x+w, y+h)
  assert.equal(regionAt(map, 9.999, 20), null);
  assert.equal(regionAt(map, 40.001, 60), null);
});

// ---------------------------------------------------------------- regionById

test('regionById returns the region or null', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionById(map, 'door_l').name, 'Left Door');
  assert.equal(regionById(map, 'nope'), null);
});

// ---------------------------------------------------------------- mirrorPoint

test('mirrorPoint reflects u and preserves v', () => {
  const src = { x: 0, y: 0, w: 100, h: 100 };
  const dst = { x: 0, y: 0, w: 100, h: 100 };
  // u = 0.25, v = 0.5 → u' = 0.75, v' = 0.5
  assert.deepEqual(mirrorPoint(src, dst, 25, 50), { x: 75, y: 50 });
  // center maps to center
  assert.deepEqual(mirrorPoint(src, dst, 50, 50), { x: 50, y: 50 });
  // left edge maps to right edge
  assert.deepEqual(mirrorPoint(src, dst, 0, 10), { x: 100, y: 10 });
});

test('mirrorPoint works across different-sized rects', () => {
  const src = { x: 100, y: 200, w: 40, h: 20 };
  const dst = { x: 500, y: 600, w: 80, h: 40 };
  // point at u=0.25, v=0.5 of src → u'=0.75, v=0.5 of dst
  const p = mirrorPoint(src, dst, 110, 210);
  assert.deepEqual(p, { x: 500 + 0.75 * 80, y: 600 + 0.5 * 40 });
});

test('mirrorPoint with a zero-size src does not produce NaN', () => {
  const src = { x: 10, y: 10, w: 0, h: 0 };
  const dst = { x: 100, y: 100, w: 50, h: 50 };
  const p = mirrorPoint(src, dst, 10, 10);
  assert.ok(Number.isFinite(p.x));
  assert.ok(Number.isFinite(p.y));
  // u and v default to 0 → x lands at dst right edge, y at dst top
  assert.deepEqual(p, { x: 150, y: 100 });
});

// ---------------------------------------------------------------- uniqueRegionId

test('uniqueRegionId slugs names: lowercase, non-alphanumeric → underscore, trimmed', () => {
  const map = createRegionMap('c');
  assert.equal(uniqueRegionId('Left Door', map), 'left_door');
  assert.equal(uniqueRegionId('  Rear--Wing!! ', map), 'rear_wing');
  assert.equal(uniqueRegionId('A/B #3', map), 'a_b_3');
});

test('uniqueRegionId suffixes collisions with _2, _3, ...', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'hood', x: 0, y: 0, w: 1, h: 1 },
      { id: 'hood_2', x: 5, y: 5, w: 1, h: 1 },
    ] }));
  assert.equal(uniqueRegionId('Hood', map), 'hood_3');
});

test('uniqueRegionId falls back to "region" for empty or all-symbol names', () => {
  const map = createRegionMap('c');
  assert.equal(uniqueRegionId('', map), 'region');
  assert.equal(uniqueRegionId('!!!', map), 'region');
  const map2 = parseRegionMap(rawMap({
    regions: [{ id: 'region', x: 0, y: 0, w: 1, h: 1 }] }));
  assert.equal(uniqueRegionId('***', map2), 'region_2');
});

// ---------------------------------------------------------------- outlined regions

// An L: the full 100x100 box minus its top-right quarter.
const L_SHAPE = [
  { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

test('parseRegionMap keeps a valid outline and rejects a bad one', () => {
  const ok = parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE }] }));
  assert.deepEqual(ok.regions[0].points, L_SHAPE);
  assert.notEqual(ok.regions[0].points, L_SHAPE); // copied, not shared
  for (const points of [[], L_SHAPE.slice(0, 2), [{ x: 0, y: 0 }, { x: 1 }, { x: 2, y: 2 }], 'nope']) {
    assert.throws(
      () => parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points }] })),
      /bad "points"/,
    );
  }
});

test('regionAt follows the outline, not the bounding box', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'under', x: 0, y: 0, w: 100, h: 100 },
      { id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE },
    ] }));
  assert.equal(regionAt(map, 25, 25).id, 'l');
  assert.equal(regionAt(map, 75, 75).id, 'l');
  assert.equal(regionAt(map, 75, 25).id, 'under'); // inside l's box, outside its shape
});

// ---------------------------------------------------------------- detectPieces

// Draw the outline of a w×h box plus a grid line every `step` px, the way a
// wireframe draws one piece as a mesh.
function drawMesh(mask, W, x0, y0, w, h, step) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if (edge || (x - x0) % step === 0 || (y - y0) % step === 0) mask[y * W + x] = 1;
    }
  }
}

test('detectPieces finds one outline per separate mesh, largest first', () => {
  const W = 200, H = 120;
  const mask = new Uint8Array(W * H);
  drawMesh(mask, W, 10, 10, 41, 31, 10);   // small piece
  drawMesh(mask, W, 80, 20, 101, 81, 20);  // large piece
  mask[5 * W + 190] = 1;                   // a stray speck
  const pieces = detectPieces(mask, W, H);
  assert.equal(pieces.length, 2);
  const map = piecesRegionMap('test car', pieces);
  assert.deepEqual(map.regions.map(r => [r.id, r.name, r.x, r.y, r.w, r.h]), [
    ['piece_1', 'Panel 1', 80, 20, 101, 81],
    ['piece_2', 'Panel 2', 10, 10, 41, 31],
  ]);
  assert.equal(map.regions[0].points.length, 4); // a box simplifies to its corners
  parseRegionMap(map); // what detection produces must load as a map
});

test('detectPieces traces a diagonal line network and a concave shape', () => {
  const W = 60, H = 60;
  const mask = new Uint8Array(W * H);
  // an L drawn with 1px lines, including a diagonal that only touches corner to corner
  for (let i = 10; i <= 50; i++) { mask[10 * W + i] = 1; mask[i * W + 10] = 1; mask[50 * W + i] = 1; }
  for (let i = 10; i <= 30; i++) { mask[i * W + 50] = 1; mask[30 * W + (20 + i)] = 1; }
  for (let i = 30; i <= 50; i++) mask[i * W + 50] = 1;
  for (let i = 0; i <= 40; i++) mask[(10 + i) * W + (10 + i)] = 1; // diagonal
  const [outline] = detectPieces(mask, W, H, { minArea: 100 });
  const map = parseRegionMap(piecesRegionMap('test car', [outline]));
  assert.equal(regionAt(map, 30, 30).id, 'piece_1');
  assert.equal(regionAt(map, 5, 5), null);
});

test('simplifyOutline drops points on a straight run and keeps real corners', () => {
  const ring = [];
  for (let x = 0; x < 100; x += 5) ring.push({ x, y: 0 });
  for (let y = 0; y < 100; y += 5) ring.push({ x: 100, y });
  for (let x = 100; x > 0; x -= 5) ring.push({ x, y: 100 });
  for (let y = 100; y > 0; y -= 5) ring.push({ x: 0, y });
  assert.deepEqual(simplifyOutline(ring, 1), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
});

// ---------------------------------------------------------------- renameRegion / labelPoint

test('renameRegion makes the id follow the name and repoints the mirror partner', () => {
  const map = parseRegionMap(rawMap());
  renameRegion(map, regionById(map, 'door_l'), 'Driver Door');
  assert.deepEqual(map.regions.map(r => [r.id, r.name, r.mirror]), [
    ['driver_door', 'Driver Door', 'door_r'],
    ['door_r', 'Right Door', 'driver_door'],
  ]);
  parseRegionMap(map); // still a valid map: no dangling mirror
});

test('renameRegion avoids another region\'s id but not its own', () => {
  const map = piecesRegionMap('test car', [L_SHAPE, L_SHAPE, L_SHAPE]);
  renameRegion(map, map.regions[0], 'Roof');
  renameRegion(map, map.regions[1], 'Roof');
  renameRegion(map, map.regions[0], 'Roof'); // renaming to its current name is a no-op
  assert.deepEqual(map.regions.map(r => r.id), ['roof', 'roof_2', 'piece_3']);
});

test('labelPoint lands inside the shape and keeps off regions drawn over it', () => {
  const [l] = parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE }] })).regions;
  const p = labelPoint(l);
  assert.ok(pointInPolygon(L_SHAPE, p.x, p.y));
  assert.ok(p.room > 15); // the widest part of the L, not a corner
  const over = { id: 'over', x: 0, y: 40, w: 100, h: 60 }; // covers the L's foot
  const q = labelPoint(l, [over]);
  assert.ok(q.y < 40 && pointInPolygon(L_SHAPE, q.x, q.y));
});

// ---------------------------------------------------------------- seam links

// Two 100px squares. Square A's right edge (top to bottom) meets square B's
// top edge (right to left) — as if B were turned a quarter and moved away.
function linkedMap() {
  return parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 500, y: 300, w: 100, h: 100 },
    ],
    links: [{
      a: { region: 'a', from: { x: 100, y: 0 }, to: { x: 100, y: 100 } },
      b: { region: 'b', from: { x: 600, y: 300 }, to: { x: 500, y: 300 } } }] }));
}

test('snapToOutline lands on the edge, and on a corner when one is close', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const edge = snapToOutline(sq, 104, 40, 8);
  assert.deepEqual([edge.x, edge.y, edge.s], [100, 40, 140]);
  const corner = snapToOutline(sq, 97, 5, 8);
  assert.deepEqual([corner.x, corner.y, corner.s], [100, 0, 100]);
});

test('matchPoint carries a spot across a link to a turned, far-away region', () => {
  const map = linkedMap();
  const m = matchPoint(map, 102, 25, 5); // a quarter of the way down A's right edge
  assert.equal(m.side, 'a');
  assert.ok(Math.abs(m.t - 0.25) < 1e-9);
  assert.deepEqual(m.at, { x: 100, y: 25 });
  assert.deepEqual(m.partner, { x: 575, y: 300 }); // a quarter of the way along B's top edge, from the right
  const back = matchPoint(map, 575, 298, 5); // and the same link read from B's side
  assert.deepEqual(back.partner, { x: 100, y: 25 });
});

test('seamPieces follows a bent edge: every cut along one side lands on the matching cut of the other', () => {
  // A's right edge is straight; B's top edge has a kink, so a single straight line would drift in the middle
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 100, h: 200 },
      { id: 'b', x: 500, y: 300, w: 200, h: 200, points: [{ x: 500, y: 300 }, { x: 600, y: 260 }, { x: 700, y: 300 }, { x: 700, y: 500 }, { x: 500, y: 500 }] },
    ],
    links: [{ a: { region: 'a', from: { x: 100, y: 0 }, to: { x: 100, y: 200 } }, b: { region: 'b', from: { x: 700, y: 300 }, to: { x: 500, y: 300 }, dir: -1 } }] }));
  const link = map.links[0], pieces = seamPieces(map, link, 'a');
  const at = (m, q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  const n = pieces.length;
  assert.ok(n >= 4);
  pieces.forEach(({ m }, k) => {
    for (const t of [k / n, (k + 1) / n]) assert.ok(near(at(m, linkPoints(map, link, 'a', t, t)[0]), linkPoints(map, link, 'b', t, t)[0]));
  });
  // the middle of A's edge lands on the kink, where the whole-edge line misses it by 40px
  const mid = pieces[n / 2].m;
  assert.ok(near(at(mid, { x: 100, y: 100 }), { x: 600, y: 260 }));
  // over A's edge lands inside B, beyond its kink
  const over = at(mid, { x: 110, y: 100 });
  assert.ok(pointInPolygon(regionById(map, 'b').points, over.x, over.y));
});

test('matchPoint ignores spots off the linked stretch or too far from it', () => {
  const map = linkedMap();
  assert.equal(matchPoint(map, 50, 0, 5), null);   // A's top edge is not linked
  assert.equal(matchPoint(map, 130, 50, 5), null); // too far from the edge
});

test('linkPoints follows the stretch end to end, on both sides', () => {
  const map = linkedMap();
  const a = linkPoints(map, map.links[0], 'a'), b = linkPoints(map, map.links[0], 'b');
  assert.deepEqual([a[0], a[a.length - 1]], [{ x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.deepEqual([b[0], b[b.length - 1]], [{ x: 600, y: 300 }, { x: 500, y: 300 }]);
  assert.equal(linkLength(map, map.links[0]), 100);
});

test('links survive parsing and follow a renamed region; bad links are rejected', () => {
  const map = linkedMap();
  renameRegion(map, regionById(map, 'b'), 'Rear Bumper');
  assert.equal(map.links[0].b.region, 'rear_bumper');
  assert.deepEqual(parseRegionMap(map).links, map.links);
  assert.throws(() => parseRegionMap({ ...map, links: [{ a: map.links[0].a, b: { ...map.links[0].b, region: 'nope' } }] }), /unknown region "nope"/);
  assert.throws(() => parseRegionMap({ ...map, links: [{ a: map.links[0].a }] }), /bad "b" end/);
  assert.equal(parseRegionMap(rawMap()).links, undefined); // maps without links stay as they were
});

test('a link side runs the shorter way by default, and keeps a stored dir past half the outline', () => {
  const map = linkedMap();
  const side = map.links[0].a; // A's right edge, top to bottom: the way the corners are listed
  assert.equal(linkDir(map, map.links[0], 'a'), 1);
  side.dir = 1;
  side.to = { x: 0, y: 50 }; // slide the end on round the bottom and half-way up the left edge
  assert.equal(linkLength(map, { a: side, b: side }), 250); // 100 right + 100 bottom + 50 left, not the 150 short way
  delete side.dir;
  assert.equal(linkLength(map, { a: side, b: side }), 150);
  side.dir = -1;
  assert.equal(parseRegionMap(map).links[0].a.dir, -1); // dir survives a save and load
});

test('twinLink links the matching edges on the other side of the car, and not twice', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'ld', x: 0, y: 0, w: 100, h: 100, mirror: 'rd', mirrorKind: 'flip' },
      { id: 'rd', x: 300, y: 0, w: 100, h: 100, mirror: 'ld', mirrorKind: 'flip' },
      { id: 'lq', x: 0, y: 200, w: 100, h: 100, mirror: 'rq', mirrorKind: 'flip' },
      { id: 'rq', x: 300, y: 200, w: 100, h: 100, mirror: 'lq', mirrorKind: 'flip' },
      { id: 'roof', x: 600, y: 0, w: 200, h: 100, center: { a: { x: 600, y: 0 }, b: { x: 800, y: 0 } } },
      { id: 'lone', x: 600, y: 300, w: 100, h: 100 },
    ],
    links: [{ a: { region: 'ld', from: { x: 0, y: 100 }, to: { x: 100, y: 100 } }, b: { region: 'lq', from: { x: 0, y: 200 }, to: { x: 100, y: 200 } } }] }));
  const t = twinLink(map, map.links[0]);
  assert.deepEqual([t.a.region, t.a.from, t.a.to], ['rd', { x: 400, y: 100 }, { x: 300, y: 100 }]);
  assert.deepEqual([t.b.region, t.b.from, t.b.to], ['rq', { x: 400, y: 200 }, { x: 300, y: 200 }]);
  // it runs along the bottom edge, not round the other three sides
  assert.equal(linkLength(map, t), 100);
  map.links.push(t);
  assert.equal(twinLink(map, map.links[0]), null); // already there
  assert.equal(twinLink(map, t), null);            // and linking the other side finds the first
  // each finds the other to be removed with it, even nudged a little
  t.a.from = { x: 392, y: 100 };
  assert.equal(twinOf(map, map.links[0]), t);
  assert.equal(twinOf(map, t), map.links[0]);
  // an end moved on one: syncTwin sets the twin to match again
  map.links[0].a.from = { x: 10, y: 100 };
  assert.equal(syncTwin(map, map.links[0], t), true);
  assert.deepEqual([t.a.region, t.a.from, t.a.to], ['rd', { x: 390, y: 100 }, { x: 300, y: 100 }]);
  assert.deepEqual(t.b.from, { x: 400, y: 200 });
  // a panel with only a centreline is carried across it: left half of the roof's front edge to the right half
  const roof = { a: { region: 'ld', from: { x: 100, y: 0 }, to: { x: 100, y: 50 } }, b: { region: 'roof', from: { x: 600, y: 100 }, to: { x: 650, y: 100 } } };
  const r = twinLink(map, roof);
  assert.deepEqual([r.b.region, r.b.from, r.b.to], ['roof', { x: 800, y: 100 }, { x: 750, y: 100 }]);
  assert.deepEqual([r.a.region, r.a.from, r.a.to], ['rd', { x: 300, y: 0 }, { x: 300, y: 50 }]);
  // a panel with neither has no other side
  assert.equal(twinLink(map, { a: roof.a, b: { region: 'lone', from: { x: 600, y: 300 }, to: { x: 700, y: 300 } } }), null);
});

test('addTwins gives links made before a pairing their twins, once', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'ld', x: 0, y: 0, w: 100, h: 100 }, { id: 'rd', x: 300, y: 0, w: 100, h: 100 },
      { id: 'lq', x: 0, y: 200, w: 100, h: 100, mirror: 'rq', mirrorKind: 'flip' },
      { id: 'rq', x: 300, y: 200, w: 100, h: 100, mirror: 'lq', mirrorKind: 'flip' },
    ],
    links: [{ a: { region: 'ld', from: { x: 0, y: 100 }, to: { x: 100, y: 100 } }, b: { region: 'lq', from: { x: 0, y: 200 }, to: { x: 100, y: 200 } } }] }));
  assert.equal(addTwins(map).length, 0); // the doors aren't paired yet: no other side
  setMirror(map, regionById(map, 'ld'), 'rd');
  assert.equal(addTwins(map).length, 1);
  assert.deepEqual([map.links[1].a.region, map.links[1].b.region], ['rd', 'rq']);
  assert.equal(addTwins(map).length, 0); // not twice
});

test('nearestIsStretch stops a band at a slit but not at a corner', () => {
  // a panel with a slit 10 px wide cut down from the top; the stretch is the slit's left wall
  const outline = [{ x: 0, y: 0 }, { x: 95, y: 0 }, { x: 95, y: 80 }, { x: 105, y: 80 }, { x: 105, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const wall = Array.from({ length: 27 }, (_, k) => ({ x: 95, y: k * 80 / 26 }));
  const mine = nearestIsStretch(outline, wall, 22);
  assert.equal(mine(85, 40), true);   // beside the wall, on its own side
  assert.equal(mine(110, 40), false); // across the slit
  assert.equal(mine(85, 95), true);   // below the slit's end: still a straight way inside
  // a corner: the top edge's band runs right into it
  const top = Array.from({ length: 32 }, (_, k) => ({ x: k * 95 / 31, y: 0 }));
  assert.equal(nearestIsStretch(outline, top, 22)(3, 10), true);
});

test('guessMirrorKind gives the same answer whichever panel comes first', () => {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const box = (pts) => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { points: pts, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  for (let k = 0; k < 300; k++) { // a notched panel and a rough, not exact, mirror of it
    const a = box([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 + 20 * r() }, { x: 60 + 30 * r(), y: 60 + 30 * r() }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    const b = box(a.points.map(p => ({ x: 300 - p.x + 8 * (r() - 0.5), y: p.y + 8 * (r() - 0.5) })).concat([{ x: 300 - 20 * r(), y: 100 }]));
    assert.equal(guessMirrorKind(a, b), guessMirrorKind(b, a));
  }
});

test('setMirrorKind moves the twins to match and leaves the first link alone', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'ld', x: 0, y: 0, w: 100, h: 100, mirror: 'rd', mirrorKind: 'flip' },
      { id: 'rd', x: 300, y: 0, w: 100, h: 100, mirror: 'ld', mirrorKind: 'flip' },
      { id: 'lq', x: 0, y: 200, w: 100, h: 100, mirror: 'rq', mirrorKind: 'flip' },
      { id: 'rq', x: 300, y: 200, w: 100, h: 100, mirror: 'lq', mirrorKind: 'flip' },
    ],
    links: [{ a: { region: 'ld', from: { x: 0, y: 100 }, to: { x: 100, y: 100 } }, b: { region: 'lq', from: { x: 0, y: 200 }, to: { x: 100, y: 200 } } }] }));
  addTwins(map);
  const [first, twin] = map.links;
  assert.equal(setMirrorKind(map, regionById(map, 'rd'), 'flipV'), 1);
  assert.equal(regionById(map, 'ld').mirrorKind, 'flipV');
  assert.deepEqual([first.a.from, first.a.to], [{ x: 0, y: 100 }, { x: 100, y: 100 }]); // where it was drawn
  assert.deepEqual([twin.a.region, twin.a.from.y, twin.a.to.y], ['rd', 0, 0]); // now the top edge
  assert.equal(map.links.length, 2);
});

test('guessMirrorKind goes by where the twins sit on the sheet', () => {
  const box = (pts) => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { points: pts, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  const rect = (x, y) => box([{ x, y }, { x: x + 200, y }, { x: x + 200, y: y + 100 }, { x, y: y + 100 }]);
  assert.equal(guessMirrorKind(rect(0, 0), rect(500, 0)), 'flip');   // side by side
  assert.equal(guessMirrorKind(rect(0, 0), rect(0, 400)), 'flipV');  // one above the other
  // a notched panel and the same panel turned 180°, side by side: the shape clearly says turned
  const notched = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 60, y: 100 }, { x: 40, y: 60 }, { x: 0, y: 60 }];
  const turned = box(notched.map(p => ({ x: 900 - p.x, y: 100 - p.y })));
  assert.equal(guessMirrorKind(box(notched), turned), 'rot180');
  assert.equal(guessMirrorKind(box(notched), box(notched.map(p => ({ x: 900 - p.x, y: p.y })))), 'flip');
});

test('seamPieces carries into a thin curved panel whose middle sits beyond its edge\'s line', () => {
  // a banana-shaped strip: its top edge bows up, so the line between that edge's ends runs below the panel's middle
  const arc = (r, a0, a1) => Array.from({ length: 19 }, (_, k) => { const t = (a0 + (a1 - a0) * k / 18) * Math.PI / 180; return { x: Math.round((500 + r * Math.cos(t)) * 10) / 10, y: Math.round((600 + r * Math.sin(t)) * 10) / 10 }; });
  const top = arc(320, 225, 315), pts = [...top, ...arc(260, 315, 225)];
  const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'side', x: 300, y: 800, w: 400, h: 200 },
      { id: 'strip', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), points: pts },
    ],
    links: [{ a: { region: 'side', from: { x: 300, y: 800 }, to: { x: 700, y: 800 } }, b: { region: 'strip', from: top[0], to: top[18] } }] }));
  const strip = regionById(map, 'strip'), pieces = seamPieces(map, map.links[0], 'a');
  assert.ok(pieces.length > 3);
  for (const { strip: s } of pieces) { // a few px in from the edge, the way the strip runs: inside the panel
    const ex = (s[0].x + s[1].x) / 2, ey = (s[0].y + s[1].y) / 2, dx = (s[3].x + s[2].x) / 2 - ex, dy = (s[3].y + s[2].y) / 2 - ey, l = Math.hypot(dx, dy);
    assert.ok(pointInPolygon(regionOutline(strip), ex + dx / l * 8, ey + dy / l * 8));
  }
});

// ---------------------------------------------------------------- centerline

test('centerLine runs square to the twin corners through their midpoint, spanning the region', () => {
  // a 200x100 box whose twin corners are its top-left and bottom-left: the car's middle is the level line y=50
  const r = { id: 'roof', x: 0, y: 0, w: 200, h: 100, center: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } };
  const c = centerLine(r);
  assert.deepEqual(c.mid, { x: 0, y: 50 });
  assert.deepEqual([c.p0, c.p1].map(q => [Math.round(q.x), Math.round(q.y)]).sort((p, q) => p[0] - q[0]), [[0, 50], [200, 50]]);
  assert.ok(Math.abs(Math.abs(c.angle) % 180) < 1e-9); // level
  assert.deepEqual(mirrorAcross(r, 30, 10), { x: 30, y: 90 });
  assert.equal(centerLine({ id: 'door', x: 0, y: 0, w: 1, h: 1 }), null);
});

test('centerLine follows a region turned on the sheet', () => {
  // twin corners on a 45° slant: the centerline is the other diagonal
  const r = { id: 'bonnet', x: 0, y: 0, w: 100, h: 100, center: { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } } };
  const m = mirrorAcross(r, 100, 0); // a point on the centerline stays put
  assert.ok(Math.abs(m.x - 100) < 1e-9 && Math.abs(m.y) < 1e-9);
  const n = mirrorAcross(r, 0, 0);   // one twin lands on the other
  assert.ok(Math.abs(n.x - 100) < 1e-9 && Math.abs(n.y - 100) < 1e-9);
});

test('parseRegionMap keeps a valid center and rejects a bad one', () => {
  const center = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
  const ok = parseRegionMap(rawMap({ regions: [{ id: 'roof', x: 0, y: 0, w: 10, h: 10, center }] }));
  assert.deepEqual(ok.regions[0].center, center);
  for (const bad of [{ a: center.a }, { a: center.a, b: center.a }, null]) {
    assert.throws(() => parseRegionMap(rawMap({ regions: [{ id: 'roof', x: 0, y: 0, w: 10, h: 10, center: bad }] })), /bad "center"/);
  }
});

test('setMirror pairs both ways, releases old partners, and unpairs', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 1, h: 1, mirror: 'b' },
      { id: 'b', x: 2, y: 0, w: 1, h: 1, mirror: 'a' },
      { id: 'c', x: 4, y: 0, w: 1, h: 1 },
    ] }));
  const [a, b, c] = map.regions;
  setMirror(map, a, 'c'); // a leaves b for c
  assert.deepEqual([a.mirror, b.mirror, c.mirror], ['c', undefined, 'a']);
  setMirror(map, b, 'c'); // c is taken over by b, a is released
  assert.deepEqual([a.mirror, b.mirror, c.mirror], [undefined, 'c', 'b']);
  setMirror(map, c, null); // unpair
  assert.deepEqual([a.mirror, b.mirror, c.mirror], [undefined, undefined, undefined]);
  setMirror(map, a, 'a');  // a region cannot mirror itself — that is what a centerline is for
  assert.equal(a.mirror, undefined);
  parseRegionMap(map);
});

// ---------------------------------------------------------------- trimming

const boxOf = (pts) => [Math.min(...pts.map(q => q.x)), Math.min(...pts.map(q => q.y)), Math.max(...pts.map(q => q.x)), Math.max(...pts.map(q => q.y))];

test('growOutline pushes every side out, whichever way round the outline is listed', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  for (const pts of [sq, [...sq].reverse()]) {
    const [x0, y0, x1, y1] = boxOf(growOutline(pts, 2));
    assert.ok(x0 < -1 && y0 < -1 && x1 > 101 && y1 > 101, JSON.stringify([x0, y0, x1, y1]));
  }
});

test('trimShape is the whole region, or the clicked half when it has a centerline', () => {
  const plain = { id: 'door', x: 0, y: 0, w: 200, h: 100 };
  assert.deepEqual(boxOf(trimShape(plain, 50, 50, 0)), [0, 0, 200, 100]);
  // twin corners top-left and bottom-left: the centerline is the level line y=50
  const roof = { ...plain, id: 'roof', center: { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } } };
  assert.deepEqual(boxOf(trimShape(roof, 150, 20, 0)), [0, 0, 200, 50]);
  assert.deepEqual(boxOf(trimShape(roof, 150, 80, 0)), [0, 50, 200, 100]);
  // with bleed the two halves overlap a little, so no seam shows between them
  const top = boxOf(trimShape(roof, 150, 20)), bottom = boxOf(trimShape(roof, 150, 80));
  assert.ok(top[3] > 50 && bottom[1] < 50);
});

// ---------------------------------------------------------------- how a mirror partner lies

test('guessMirrorKind tells how a partner lies from the two outlines', () => {
  const at = (pts, dx, dy) => {
    const p = pts.map(q => ({ x: q.x + dx, y: q.y + dy }));
    const xs = p.map(q => q.x), ys = p.map(q => q.y);
    return { id: 'r', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), points: p };
  };
  const src = at(L_SHAPE, 0, 0);
  assert.equal(guessMirrorKind(src, at(L_SHAPE.map(q => ({ x: 100 - q.x, y: q.y })), 300, 0)), 'flip');
  assert.equal(guessMirrorKind(src, at(L_SHAPE.map(q => ({ x: q.x, y: 100 - q.y })), 0, 300)), 'flipV');
  assert.equal(guessMirrorKind(src, at(L_SHAPE.map(q => ({ x: 100 - q.x, y: 100 - q.y })), 300, 300)), 'rot180');
  assert.equal(guessMirrorKind(src, at(L_SHAPE, 300, 300)), 'same');
  // two plain boxes fit every way, and then it is the default
  assert.equal(guessMirrorKind({ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 50, y: 0, w: 10, h: 10 }), 'flip');
  // narrowed to the two reflections: a stacked twin that is not in the same column is still top/bottom
  assert.equal(guessMirrorKind(src, at(L_SHAPE.map(q => ({ x: q.x, y: 100 - q.y })), 40, 300), ['flip', 'flipV']), 'flipV');
  assert.equal(guessMirrorKind(src, at(L_SHAPE.map(q => ({ x: 100 - q.x, y: 100 - q.y })), 300, 300), ['flip', 'flipV']) === 'rot180', false);
});

test('setMirror records how the pair lies, and clears it when unpaired', () => {
  const below = L_SHAPE.map(q => ({ x: q.x, y: 400 - q.y }));
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE },
      { id: 'b', x: 0, y: 300, w: 100, h: 100, points: below },
    ] }));
  const [a, b] = map.regions;
  setMirror(map, a, 'b');
  assert.deepEqual([a.mirrorKind, b.mirrorKind], ['flipV', 'flipV']);
  assert.equal(parseRegionMap(map).regions[0].mirrorKind, 'flipV'); // survives a save and load
  setMirror(map, a, null);
  assert.deepEqual([a.mirrorKind, b.mirrorKind], [undefined, undefined]);
});

test('slideAlong moves a spot round the outline, kept to its edge by edgeSpan', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.deepEqual(slideAlong(sq, 50, 0, 1), { x: 51, y: 0 });
  assert.deepEqual(slideAlong(sq, 50, 0, -1), { x: 49, y: 0 });
  assert.deepEqual(slideAlong(sq, 100, 0, 1), { x: 100, y: 1 }); // with no span it goes round
  const top = edgeSpan(sq, 50, 0, 1);
  assert.deepEqual(top, { start: 0, len: 100 });
  assert.deepEqual(slideAlong(sq, 95, 0, 10, top), { x: 100, y: 0 }); // stops at the corner
  assert.deepEqual(slideAlong(sq, 100, 0, 10, top), { x: 100, y: 0 }); // and stays there
  assert.deepEqual(slideAlong(sq, 100, 0, -10, top), { x: 90, y: 0 }); // back along its own edge is fine
  assert.deepEqual(slideAlong(sq, 5, 0, -10, top), { x: 0, y: 0 });
  // on a corner, the way the first press goes picks the edge
  assert.deepEqual(edgeSpan(sq, 100, 0, 1), { start: 100, len: 100 });
  assert.deepEqual(edgeSpan(sq, 100, 0, -1), { start: 0, len: 100 });
  assert.deepEqual(edgeSpan(sq, 0, 0, -1), { start: 300, len: 100 }); // wraps round
  // gentle bends aren't corners: a curve of 10 degree turns has none
  const circle = Array.from({ length: 36 }, (_, i) => ({ x: 100 * Math.cos(i * Math.PI / 18), y: 100 * Math.sin(i * Math.PI / 18) }));
  assert.equal(edgeSpan(circle, 100, 0, 1), null);
});
