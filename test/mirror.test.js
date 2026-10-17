import test from 'node:test';
import assert from 'node:assert/strict';

// mirror.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { mirrorLayer, pieceAt, withSeams, seamsOf } = await import('../js/mirror.js');
const { createFillLayer } = await import('../js/engine.js');
const { parseRegionMap, setMirror, carLinesWithTwins } = await import('../js/regions.js');

const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function map() {
  const m = parseRegionMap({
    format: 'overspray-regions/1', car: 'test',
    regions: [
      // lopsided on purpose: a plain rectangle fits every kind of mirror equally
      { id: 'left', name: 'Left', x: 0, y: 0, w: 400, h: 200, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 100, y: 200 }, { x: 0, y: 100 }] },
      { id: 'right', name: 'Right', x: 0, y: 600, w: 400, h: 200, points: [{ x: 0, y: 800 }, { x: 400, y: 800 }, { x: 400, y: 600 }, { x: 100, y: 600 }, { x: 0, y: 700 }] },
      { id: 'roof', name: 'Roof', x: 1000, y: 0, w: 400, h: 400, points: box(1000, 0, 400, 400), center: { a: { x: 1000, y: 0 }, b: { x: 1400, y: 0 } } },
      { id: 'lone', name: 'Lone', x: 1600, y: 0, w: 100, h: 100, points: box(1600, 0, 100, 100) },
      { id: 'num', name: 'Number', kind: 'number', x: 50, y: 50, w: 60, h: 60 },
    ],
  });
  setMirror(m, m.regions[0], 'right'); // one above the other on the sheet: a top/bottom reflection
  return m;
}
const shape = (pts) => { const l = createFillLayer('#111214'); l.shape = 'path'; l.name = 'Wedge'; l.pts = pts; const xs = pts.map(p => p.x), ys = pts.map(p => p.y); l.rx = Math.min(...xs); l.ry = Math.min(...ys); l.rw = Math.max(...xs) - l.rx; l.rh = Math.max(...ys) - l.ry; return l; };

test('pieceAt looks past the kit\'s zones', () => {
  assert.equal(pieceAt(map(), 60, 60).id, 'left');
  assert.equal(pieceAt(null, 1, 1), null);
});

test('a free shape mirrors onto the twin panel point by point', () => {
  const m = map();
  assert.equal(m.regions[0].mirrorKind, 'flipV');
  const l = shape([{ x: 0, y: 0 }, { x: 200, y: 0, c: { x: 300, y: 50 } }, { x: 100, y: 100 }]);
  const { copy, dst, error } = mirrorLayer(m, l);
  assert.equal(error, undefined);
  assert.equal(dst.id, 'right');
  assert.deepEqual(copy.pts, [{ x: 0, y: 800 }, { x: 200, y: 800, c: { x: 300, y: 750 } }, { x: 100, y: 700 }]);
  assert.deepEqual([copy.rx, copy.ry, copy.rw, copy.rh], [0, 700, 300, 100]);
  assert.equal(copy.flipV, false, 'the points already are the mirror image');
  assert.notEqual(copy.id, l.id);
  assert.equal(copy.name, 'Wedge (mirrored)');
  assert.deepEqual(l.pts[0], { x: 0, y: 0 }, 'the original is untouched');
});

test('across a centreline: the shape lands on the other half of the same panel', () => {
  const l = shape([{ x: 1050, y: 100 }, { x: 1150, y: 100 }, { x: 1050, y: 300 }]);
  const { copy, dst } = mirrorLayer(map(), l);
  assert.equal(dst.id, 'roof');
  assert.deepEqual(copy.pts, [{ x: 1350, y: 100 }, { x: 1250, y: 100 }, { x: 1350, y: 300 }]);
});

test('a ready-made box flips onto the twin; a trim follows it', () => {
  const m = map();
  const l = createFillLayer('#ff0000'); l.shape = 'triangle'; l.name = 'Tri';
  l.rx = 100; l.ry = 20; l.rw = 100; l.rh = 60;
  l.clip = [box(0, 0, 400, 200)]; l.clipAt = [{ x: 150, y: 50 }];
  const { copy } = mirrorLayer(m, l);
  assert.deepEqual([copy.rx, copy.ry, copy.rw, copy.rh], [100, 720, 100, 60]);
  assert.equal(copy.flipV, true);
  assert.equal(copy.clip.length, 1);
  assert.ok(copy.clip[0].every(q => q.y >= 596 && q.y <= 804), 'trimmed to the twin panel (with its bleed)');
  assert.deepEqual(copy.clipAt, [{ x: 150, y: 750 }]);
});

test('errors say what is missing', () => {
  const m = map();
  const off = shape([{ x: 1900, y: 1900 }, { x: 1950, y: 1900 }, { x: 1900, y: 1950 }]);
  assert.match(mirrorLayer(m, off).error, /not on a panel/);
  const lone = shape([{ x: 1610, y: 10 }, { x: 1650, y: 10 }, { x: 1610, y: 50 }]);
  assert.match(mirrorLayer(m, lone).error, /no twin or centreline/);
  assert.match(mirrorLayer(null, lone).error, /template/);
});

test('withMirrors: a Mirrored layer is followed by its other side, made fresh each time', async () => {
  const { withMirrors, mirrorImage } = await import('../js/mirror.js');
  const m = map();
  const l = shape([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }]);
  const plain = shape([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 10, y: 50 }]);
  const doc = { regionMap: m, baseColor: '#ffffff', layers: [plain, l] };
  assert.equal(withMirrors(doc), doc, 'nothing mirrored: the doc itself');
  l.mirrored = true;
  const shown = withMirrors(doc);
  assert.deepEqual(shown.layers.map(x => x.id), [plain.id, l.id, l.id + '~m']);
  assert.equal(shown.layers[2].mirrored, false);
  assert.deepEqual(shown.layers[2].pts[1], { x: 200, y: 800 });
  assert.equal(doc.layers.length, 2, 'the doc is not changed');
  l.pts[1].x = 300; // edit the layer: the other side follows
  assert.deepEqual(withMirrors(doc).layers[2].pts[1], { x: 300, y: 800 });
  // a layer that cannot be mirrored just paints one side
  const off = shape([{ x: 1900, y: 1900 }, { x: 1950, y: 1900 }, { x: 1900, y: 1950 }]); off.mirrored = true;
  assert.equal(mirrorImage(m, off), null);
  assert.equal(withMirrors({ ...doc, layers: [off] }).layers.length, 1);
});

test('text and pictures are carried across but stay readable, unless a true mirror is asked for', () => {
  const m = map(); // left ↔ right is a top/bottom reflection; the roof has a level centreline
  const pic = (x, y, extra = {}) => ({ id: 'p', type: 'image', name: 'Logo', img: { width: 100, height: 40 }, x, y, scale: 1, rotation: 10, flipH: false, flipV: false, ...extra });
  const onTwin = mirrorLayer(m, pic(200, 50)).copy;
  assert.deepEqual([onTwin.x, onTwin.y], [200, 750]);
  // a top/bottom reflection with the reversal taken out is a half turn: flipped both ways
  assert.deepEqual([onTwin.flipH, onTwin.flipV, onTwin.rotation], [true, true, -10]);
  const trueMirror = mirrorLayer(m, pic(200, 50, { mirrorFlip: true })).copy;
  assert.deepEqual([trueMirror.flipH, trueMirror.flipV], [false, true]);
  const text = mirrorLayer(m, { ...pic(1100, 100), type: 'text' }).copy; // across the roof's centreline
  assert.equal(text.flipH, false, 'not reversed');
  assert.deepEqual([text.x, text.y], [1300, 100]);
});

test('a filled C-shaped panel mirrors onto its twin, though the middle of its box is not on it', () => {
  // a C: the middle of its box is the gap, which belongs to another panel
  const c = (x, y) => [{ x, y }, { x: x + 300, y }, { x: x + 300, y: y + 60 }, { x: x + 60, y: y + 60 }, { x: x + 60, y: y + 240 }, { x: x + 300, y: y + 240 }, { x: x + 300, y: y + 300 }, { x, y: y + 300 }];
  const m = parseRegionMap({
    format: 'overspray-regions/1', car: 'test',
    regions: [
      { id: 'c1', name: 'Arch left', x: 0, y: 0, w: 300, h: 300, points: c(0, 0) },
      { id: 'c2', name: 'Arch right', x: 1000, y: 0, w: 300, h: 300, points: c(1000, 0) },
      { id: 'gap', name: 'Wheel', x: 100, y: 100, w: 150, h: 100, points: box(100, 100, 150, 100) },
    ],
  });
  setMirror(m, m.regions[0], 'c2');
  assert.equal(pieceAt(m, 150, 150).id, 'gap'); // what the middle of the box is on
  const l = shape(c(0, 0));
  const { copy, dst, error } = mirrorLayer(m, l);
  assert.equal(error, undefined);
  assert.equal(dst.id, 'c2');
  assert.ok(copy.pts.every(p => p.x >= 1000 && p.x <= 1300));
  // a shape that sits wholly in the gap still belongs to the gap's panel
  assert.match(mirrorLayer(m, shape(box(120, 120, 60, 40))).error, /wheel has no twin/);
});

test('a Continues layer is trimmed to its panel and carried over each linked edge', () => {
  const m = map();
  m.links = [{ a: { region: 'lone', from: { x: 1700, y: 0 }, to: { x: 1700, y: 100 } }, b: { region: 'roof', from: { x: 1000, y: 0 }, to: { x: 1400, y: 0 } } }];
  const l = shape(box(1650, 20, 80, 20)); // hangs 30px over Lone's right edge
  l.continues = seamsOf(m, l).home.id;
  assert.equal(l.continues, 'lone');
  l.pts = l.pts.map(q => ({ x: q.x + 60, y: q.y })); l.rx += 60; // slid mostly over the edge: still Lone's
  const out = withSeams({ regionMap: m, layers: [l] }).layers;
  assert.equal(out.length, 9); // the layer, and the edge in 8 stretches of about 48px
  assert.equal(out[0].clip[0].length, 4); // its own part, trimmed to Lone
  assert.equal(out[1].id, l.id + '~s0.0');
  assert.deepEqual(out[1].clip, out[0].clip); // laid out as on its own panel...
  assert.equal(out[1].carry.clip[0].length, 4); // ...and trimmed to the roof
  assert.ok(out[1].carry.strip.every(q => q.y < 210)); // and to a strip along its stretch of the edge
  const k = out[5].carry, at = (x, y) => ({ x: Math.round(k.a * x + k.c * y + k.e), y: Math.round(k.b * x + k.d * y + k.f) });
  assert.deepEqual(at(1700, 50), { x: 1200, y: 0 }); // the edge's middle meets the roof's top edge's middle
  assert.ok(at(1720, 50).y > 0); // over the edge lands on the roof
  assert.deepEqual(out[0].clip[0].map(q => Math.round(q.x)), [1598, 1702, 1702, 1598]); // Lone, with its few px of bleed
  assert.equal(l.clip, undefined); // the layer itself is untouched
  assert.match(seamsOf(m, shape(box(10, 10, 50, 50))).error, /no linked edges/);
});

test('a piece placed over a panel shows what a Continues layer paints over its spot, turned to match', () => {
  const m = map();
  // Lone stands on its side on the sheet: its line runs down, the matching one on the roof runs across
  m.places = parseRegionMap({ ...m, places: [{ piece: { region: 'lone', from: { x: 1600, y: 0 }, to: { x: 1600, y: 100 } }, at: { region: 'roof', from: { x: 1000, y: 200 }, to: { x: 1100, y: 200 } } }] }).places;
  const l = shape(box(1010, 10, 380, 380)); // over the roof, no edges linked
  const s = seamsOf(m, l);
  assert.equal(s.home.id, 'roof');
  l.continues = s.home.id;
  const out = withSeams({ regionMap: m, layers: [l] }).layers;
  assert.equal(out.length, 2);
  const k = out[1].carry, at = (x, y) => ({ x: Math.round(k.a * x + k.c * y + k.e), y: Math.round(k.b * x + k.d * y + k.f) });
  assert.deepEqual(at(1000, 200), { x: 1600, y: 0 });
  assert.deepEqual(at(1100, 200), { x: 1600, y: 100 }); // front to back on the roof is top to bottom on Lone
  assert.equal(out[1].carry.strip, undefined); // the whole piece, not a strip by an edge
  assert.ok(out[1].carry.clip[0].every(q => q.x >= 1590)); // trimmed to Lone
});

test('a car gradient is laid along each panel\'s car line, the whole car from its front to its back', () => {
  const m = map();
  // a line down Lone (turned on the sheet) covers the back fifth of the car
  m.carLines = parseRegionMap({ ...m, carLines: [{ regions: ['lone'], from: { x: 1650, y: 0 }, to: { x: 1650, y: 100 }, a: 0.8, b: 1 }] }).carLines;
  const g = createFillLayer('#000000');
  g.car = { blocks: [{ color: '#000000', from: 0, to: 1 }] };
  const out = withSeams({ regionMap: m, layers: [g, shape(box(0, 0, 10, 10))] }).layers;
  assert.equal(out[0].carPaint.length, 1);
  const { p0, p1, clip } = out[0].carPaint[0];
  assert.deepEqual([p0, p1].map(q => ({ x: Math.round(q.x), y: Math.round(q.y) })), [{ x: 1650, y: -400 }, { x: 1650, y: 100 }]); // front of the car 4 lines' length back up the sheet
  assert.ok(clip[0].every(q => q.x > 1590 && q.x < 1710)); // only on Lone
  assert.equal(out[1].carPaint, undefined);
});

test('trimmed to several linked panels, copies carry on from each, taking only that panel\'s copies', () => {
  const m = map();
  m.links = [{ a: { region: 'lone', from: { x: 1700, y: 0 }, to: { x: 1700, y: 100 } }, b: { region: 'roof', from: { x: 1000, y: 0 }, to: { x: 1400, y: 0 } } }];
  const l = shape(box(1650, 20, 30, 30));
  l.repeat = { way: 'scatter', count: 20 };
  l.clip = [box(1600, 0, 100, 100), box(1000, 0, 400, 400)];
  l.clipAt = [{ x: 1650, y: 50 }, { x: 1200, y: 200 }];
  l.continues = 'lone';
  assert.deepEqual(seamsOf(m, l).homes.map(r => r.id), ['lone', 'roof']);
  const out = withSeams({ regionMap: m, layers: [l] }).layers;
  assert.equal(out.length, 17); // the layer, Lone's copies onto the roof, the roof's onto Lone (8 stretches each)
  assert.ok(out[1].carry.from && out[9].carry.from);
  assert.ok(out[1].carry.from.every(q => q.x > 1590)); // Lone's copies only
  // without Repeat it stays on its one panel: no copies to sort
  delete l.repeat;
  assert.deepEqual(seamsOf(m, l).homes.map(r => r.id), ['lone']);
  assert.equal(withSeams({ regionMap: m, layers: [l] }).layers[1].carry.from, null);
});

test('a Repeat is carried across as its mirror image: the copies run the way the original\'s land', async () => {
  const { cleanRepeat, repeatOffsets } = await import('../js/engine.js');
  const near = (a, b) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6);
  const cases = [
    [shape([{ x: 50, y: 20 }, { x: 150, y: 20 }, { x: 50, y: 60 }]), p => ({ x: p.x, y: -p.y })], // twin above/below
    [shape([{ x: 1050, y: 100 }, { x: 1150, y: 100 }, { x: 1050, y: 300 }]), p => ({ x: -p.x, y: p.y })], // across the roof's centreline
  ];
  for (const [l, flip] of cases) {
    for (const turn of [0, 30]) {
      for (const way of ['across', 'down', 'grid']) {
        l.turn = turn; l.repeat = cleanRepeat({ way, count: 3, rows: 2, gapX: 10, gapY: 5, angle: 15 });
        const { copy } = mirrorLayer(map(), l);
        assert.ok(near(repeatOffsets(copy).list, repeatOffsets(l).list.map(flip)), `${way}, turned ${turn}`);
      }
    }
  }
});

test('a scattered Repeat lands on the other side in the original\'s spots, mirrored', async () => {
  const { cleanRepeat, repeatOffsets } = await import('../js/engine.js');
  const l = shape([{ x: 50, y: 20 }, { x: 70, y: 20 }, { x: 50, y: 40 }]);
  l.clip = [box(0, 0, 400, 200)]; l.clipAt = [{ x: 150, y: 50 }];
  l.repeat = cleanRepeat({ way: 'scatter', count: 12, seed: 3 });
  const { copy } = mirrorLayer(map(), l), mine = repeatOffsets(l), its = repeatOffsets(copy);
  assert.equal(its.list.length, mine.list.length);
  // each copy is where the original's lands: the twin is a top/bottom reflection about y = 400
  its.list.forEach((o, k) => {
    assert.ok(Math.abs(its.cx + o.x - (mine.cx + mine.list[k].x)) < 1e-6);
    assert.ok(Math.abs(its.cy + o.y - (800 - mine.cy - mine.list[k].y)) < 1e-6);
  });
});

test('a Repeat\'s fade dots are kept, and carried across as their mirror image', async () => {
  const { cleanRepeat, repeatAim } = await import('../js/engine.js');
  const l = shape([{ x: 50, y: 20 }, { x: 150, y: 20 }, { x: 50, y: 60 }]);
  l.repeat = cleanRepeat({ way: 'across', count: 4, fadeOut: true });
  const d = repeatAim(l); // none set: out from the layer's middle to its furthest copy
  assert.deepEqual(d.a, { x: l.rx + l.rw / 2, y: l.ry + l.rh / 2 });
  assert.ok(Math.abs(d.b.x - d.a.x - 300) < 1e-6);
  l.repeat = cleanRepeat({ ...l.repeat, aim: { a: { x: 10, y: 5 }, b: { x: 200, y: 30 } } });
  const mine = repeatAim(l), its = repeatAim(mirrorLayer(map(), l).copy); // the twin is a top/bottom reflection about y = 400
  for (const e of ['a', 'b']) assert.ok(Math.abs(its[e].x - mine[e].x) < 1e-6 && Math.abs(its[e].y - (800 - mine[e].y)) < 1e-6, e);
});

test('a paired panel with no car line of its own follows its twin\'s, mirrored onto it', () => {
  const m = map();
  m.carLines = [{ regions: ['left'], from: { x: 50, y: 50 }, to: { x: 350, y: 50 }, a: 0, b: 0.5 }];
  const all = carLinesWithTwins(m);
  assert.equal(all.length, 2);
  const t = all[1];
  assert.deepEqual([t.regions, t.twin, t.of, t.a, t.b], [['right'], true, 0, 0, 0.5]);
  assert.deepEqual([t.from, t.to].map(q => ({ x: Math.round(q.x), y: Math.round(q.y) })), [{ x: 50, y: 750 }, { x: 350, y: 750 }]); // flipped top to bottom
  const g = createFillLayer('#000000');
  g.car = { blocks: [{ color: '#000000', from: 0, to: 1 }] };
  assert.equal(withSeams({ regionMap: m, layers: [g] }).layers[0].carPaint.length, 2);
  // a line of its own wins
  m.carLines.push({ regions: ['right'], from: { x: 0, y: 700 }, to: { x: 400, y: 700 }, a: 0.5, b: 1 });
  assert.equal(carLinesWithTwins(m).length, 2);
});
