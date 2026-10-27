import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS_FORMAT, MAP_LIMITS, mapFit, createRegionMap, parseRegionMap, regionById, regionAt, uniqueRegionId, detectPieces, piecesRegionMap, simplifyOutline, renameRegion, labelPoint, pointInPolygon, snapToOutline, slideAlong, edgeSpan, matchPoint, linkPoints, linkLength, linkDir, twinLink, twinOf, syncTwin, addTwins, nearestIsStretch, setMirrorKind, seamPieces, centerLine, mirrorAcross, setMirror, trimShape, growOutline, guessMirrorKind, regionOutline, suggestPairs } from '../js/regions.js';

// Two doors, each the other's twin. Fields in `extra` replace the map's own.
const rawMap = (extra = {}) => ({
  format: REGIONS_FORMAT, car: 'test car',
  regions: [
    { id: 'door_l', name: 'Left Door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r' },
    { id: 'door_r', name: 'Right Door', x: 900, y: 200, w: 300, h: 150, mirror: 'door_l' },
  ],
  ...extra,
});
const box = (id, x = 0, y = 0, w = 1, h = 1, more = {}) => ({ id, x, y, w, h, ...more });
const withRegions = (...regions) => parseRegionMap(rawMap({ regions }));

// ---------------------------------------------------------------- reading a map

test('a good map comes back with its boxes, twins and car', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(map.format, REGIONS_FORMAT);
  assert.equal(map.car, 'test car');
  assert.deepEqual(map.regions.map(r => [r.id, r.mirror]), [['door_l', 'door_r'], ['door_r', 'door_l']]);
  assert.deepEqual(map.regions[0], { id: 'door_l', name: 'left_door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r' });
});

test('a region with no name, or an empty one, is named after its id', () => {
  const [a, b] = withRegions(box('hood', 0, 0, 10, 10), box('roof', 20, 0, 10, 10, { name: '' })).regions;
  assert.equal(a.name, 'hood');
  assert.equal(b.name, 'roof');
});

test('fields the map format does not know are dropped', () => {
  const [r] = withRegions(box('hood', 0, 0, 10, 10, { color: 'red', locked: true })).regions;
  assert.deepEqual(Object.keys(r).sort(), ['h', 'id', 'name', 'w', 'x', 'y']);
});

test('a missing, empty or non-text car reads as "unknown car"', () => {
  const { car, ...noCar } = rawMap();
  for (const m of [noCar, rawMap({ car: '' }), rawMap({ car: 42 })]) assert.equal(parseRegionMap(m).car, 'unknown car');
});

test('broken maps are refused with a message saying what is wrong', () => {
  const refuses = (data, msg) => assert.throws(() => parseRegionMap(data), msg);
  for (const v of [null, 'nope', 7]) refuses(v, /not a region map object/);
  refuses(rawMap({ format: 'overspray-regions/2' }), /unknown format "overspray-regions\/2"/);
  refuses({ regions: [] }, /unknown format/);
  refuses({ format: REGIONS_FORMAT, car: 'c' }, /missing "regions" array/);
  refuses({ format: REGIONS_FORMAT, regions: {} }, /missing "regions" array/);
  refuses(rawMap({ regions: [{ x: 0, y: 0, w: 1, h: 1 }] }), /region 0 has no id/);
  refuses(rawMap({ regions: [box('')] }), /region 0 has no id/);
  refuses(rawMap({ regions: [null] }), /region 0 is not an object/);
  refuses(rawMap({ regions: [box('a'), box('a', 5, 5)] }), /duplicate region id "a"/);
  refuses(rawMap({ regions: [box('r', 0, 0, 0, 1)] }), /non-positive size/);
  refuses(rawMap({ regions: [box('r', 0, 0, 1, -3)] }), /non-positive size/);
  refuses(rawMap({ regions: [box('a', 0, 0, 1, 1, { mirror: 'ghost' })] }), /region "a" mirrors unknown id "ghost"/);
});

test('each box number must be a real number', () => {
  for (const k of ['x', 'y', 'w', 'h']) {
    for (const bad of [undefined, '12', -Infinity, NaN]) {
      assert.throws(() => withRegions(box('r', 0, 0, 1, 1, { [k]: bad })), new RegExp(`region "r" has a bad "${k}"`));
    }
  }
});

test('a new map is empty and names its car', () => {
  assert.deepEqual(createRegionMap('mx5'), { format: REGIONS_FORMAT, car: 'mx5', regions: [] });
  assert.equal(createRegionMap().car, 'unknown car');
});

// ---------------------------------------------------------------- finding regions

test('regionAt gives the door under a point, null between and around them', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionAt(map, 150, 250).id, 'door_l');
  assert.equal(regionAt(map, 950, 250).id, 'door_r');
  assert.equal(regionAt(map, 500, 250), null);
  assert.equal(regionAt(map, 50, 50), null);
});

test('regionAt: where boxes overlap, the later one is on top', () => {
  const map = withRegions(box('under', 0, 0, 100, 100), box('over', 50, 50, 100, 100));
  assert.equal(regionAt(map, 75, 75).id, 'over');
  assert.equal(regionAt(map, 25, 25).id, 'under');
});

test('regionAt counts a box edge as inside', () => {
  const map = withRegions(box('r', 5, 15, 20, 10));
  assert.equal(regionAt(map, 5, 15)?.id, 'r');
  assert.equal(regionAt(map, 25, 25)?.id, 'r');
  assert.equal(regionAt(map, 4.99, 15), null);
  assert.equal(regionAt(map, 25, 25.01), null);
});

test('regionById finds a region by id, null for an id not there', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionById(map, 'door_r').name, 'right_door');
  assert.equal(regionById(map, 'nope'), null);
});

// ---------------------------------------------------------------- ids

test('uniqueRegionId turns a name into lowercase words joined by _', () => {
  const id = (name) => uniqueRegionId(name, createRegionMap('c'));
  assert.equal(id('Front Bumper'), 'front_bumper');
  assert.equal(id(' --Side Pod (L)!'), 'side_pod_l');
  assert.equal(id('Wing #2/top'), 'wing_2_top');
});

test('uniqueRegionId adds the next free number when the id is taken', () => {
  assert.equal(uniqueRegionId('Hood', withRegions(box('hood'), box('hood_2', 5, 5))), 'hood_3');
  assert.equal(uniqueRegionId('Hood', withRegions(box('hood'), box('hood_3', 5, 5))), 'hood_2');
});

test('uniqueRegionId uses "region" when nothing is left of the name', () => {
  assert.equal(uniqueRegionId('', createRegionMap('c')), 'region');
  assert.equal(uniqueRegionId('!!!', createRegionMap('c')), 'region');
  assert.equal(uniqueRegionId('***', withRegions(box('region'))), 'region_2');
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
    ['piece_1', 'panel_1', 80, 20, 101, 81],
    ['piece_2', 'panel_2', 10, 10, 41, 31],
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
    ['driver_door', 'driver_door', 'door_r'],
    ['door_r', 'right_door', 'driver_door'],
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

// ---------------------------------------------------------------- shared maps

test('parseRegionMap refuses maps over the size caps and cuts long names', () => {
  const many = Array.from({ length: MAP_LIMITS.regions + 1 }, (_, i) => ({ id: 'r' + i, x: 0, y: 0, w: 1, h: 1 }));
  assert.throws(() => parseRegionMap(rawMap({ regions: many })), /too many regions/);
  const pts = Array.from({ length: MAP_LIMITS.points + 1 }, (_, i) => ({ x: i, y: i % 2 }));
  assert.throws(() => parseRegionMap(rawMap({ regions: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, points: pts }] })), /too detailed/);
  const map = parseRegionMap(rawMap({ car: 'c'.repeat(500), regions: [{ id: 'a', name: 'n'.repeat(500), x: 0, y: 0, w: 1, h: 1 }] }));
  assert.equal(map.car.length, MAP_LIMITS.name);
  assert.equal(map.regions[0].name.length, MAP_LIMITS.name);
});

test('mapFit: same template scores 1, another car scores low, nothing traced is null', () => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  const a = piecesRegionMap('car', [sq(0, 0, 100), sq(200, 0, 100), sq(400, 0, 50)]);
  const b = piecesRegionMap('car', [sq(1, 0, 100), sq(200, 2, 100), sq(400, 0, 50)]);
  a.regions[0].name = 'Bonnet'; // renaming and pairing don't change the fit
  assert.equal(mapFit(a, b), 1);
  const other = piecesRegionMap('other', [sq(0, 0, 100), sq(600, 600, 300)]);
  assert.ok(mapFit(a, other) < 0.9);
  assert.equal(mapFit(a, rawMap()), null);
  assert.equal(mapFit(null, a), null);
});

test('suggestPairs finds twins, marks exact and weak ones, and leaves checked panels out', () => {
  const box = (id, pts) => { const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { id, name: id, points: pts, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };
  const notched = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 60, y: 100 }, { x: 40, y: 60 }, { x: 0, y: 60 }];
  const flip = (pts, at, dy = 0) => pts.map(p => ({ x: at - p.x, y: p.y + dy }));
  const hood = notched.map(p => ({ x: p.x * 1.3, y: p.y * 0.6 + 900 }));
  const wing = notched.map(p => ({ x: p.x * 0.7, y: p.y * 0.8 + 300 })); // another size: not the doors' twin
  const map = { regions: [
    box('door_l', notched), box('door_r', flip(notched, 900)),                                     // an exact mirror
    box('wing_l', wing), box('wing_r', flip(wing, 900).map((p, i) => (i === 4 ? { x: p.x - 6, y: p.y } : p))), // near
    box('roof', [{ x: 0, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 700 }, { x: 0, y: 700 }]),     // no twin
    box('hood', hood), box('boot', flip(hood, 900)),
  ] };
  map.regions[5].noPair = true; // checked by hand: not suggested
  let s = suggestPairs(map);
  const keyed = s.pairs.map(p => [p.a.id, p.b.id, p.exact]);
  assert.deepEqual(keyed, [['door_l', 'door_r', true], ['wing_l', 'wing_r', false]]);
  assert.ok(s.pairs[1].fit > 0.8 && s.pairs[1].fit < 1);
  assert.deepEqual(s.none.map(r => r.id), ['roof', 'boot']);
  setMirror(map, map.regions[0], 'door_r'); // paired: out of the list
  s = suggestPairs(map);
  assert.deepEqual(s.pairs.map(p => p.a.id), ['wing_l']);
  // the same shape four times over: none of them is sure which is its twin
  const many = { regions: [0, 1, 2, 3].map(k => box('p' + k, notched.map(p => ({ x: p.x + 300 * k, y: p.y })))) };
  assert.ok(suggestPairs(many).pairs.every(p => p.weak && !p.exact));
});

test('parseRegionMap keeps noPair only on a panel with no twin', () => {
  const map = parseRegionMap(rawMap({ regions: [
    { id: 'roof', x: 0, y: 0, w: 10, h: 10, noPair: true },
    { id: 'a', x: 20, y: 0, w: 10, h: 10, mirror: 'b', noPair: true },
    { id: 'b', x: 40, y: 0, w: 10, h: 10, mirror: 'a' },
  ] }));
  assert.equal(map.regions[0].noPair, true);
  assert.equal(map.regions[1].noPair, undefined);
});

test('panel names are cleaned: lowercase, no spaces or special characters', () => {
  const map = parseRegionMap(rawMap({ regions: [
    { id: 'a', name: 'Left Door!', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', name: '  Rear  Wing (2) ', x: 20, y: 0, w: 10, h: 10 },
    { id: 's', name: 'Sponsor 1 (200×100)', x: 40, y: 0, w: 10, h: 10, kind: 'sponsor' }, // a kit's own box keeps its label
  ] }));
  assert.deepEqual(map.regions.map(r => r.name), ['left_door', 'rear_wing_2', 'Sponsor 1 (200×100)']);
  renameRegion(map, map.regions[0], 'Bonnet Scoop');
  assert.equal(map.regions[0].name, 'bonnet_scoop');
  renameRegion(map, map.regions[0], '!!!'); // nothing left: the name stays as it was
  assert.equal(map.regions[0].name, 'bonnet_scoop');
});
