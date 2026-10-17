import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js creates a handful of scratch canvases at module scope; stub just
// enough DOM for the module to import in Node. Only pure (non-canvas)
// functions are exercised here.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
// loadImage stub — resolves immediately so image layers deserialize
globalThis.Image = class {
  set src(v) { queueMicrotask(() => this.onload && this.onload()); }
};

const {
  createDoc,
  createFillLayer,
  serializeDoc,
  deserializeDoc,
  fadeStops,
  carStops,
  resolveParams,
  defaultParams,
  readPalettes,
} = await import('../js/engine.js');

// Layers built by hand (factory functions for image/text need real canvas).
function fakeTextLayer(overrides = {}) {
  return {
    id: 'T1', type: 'text', name: 'text', visible: true, opacity: 1,
    material: 'gloss', img: {}, src: 'data:image/png;base64,x',
    text: 'TEXT', font: 'Arial Black', fontSize: 160,
    textColor: '#ffffff', outlineColor: '#000000', outlineWidth: 0,
    italic: false, letterSpacing: 0, curve: 0, fx: null,
    x: 1024, y: 1024, scale: 1, rotation: 0, skewX: 0, skewY: 0,
    flipH: false, flipV: false,
    ...overrides,
  };
}

test('serializeDoc round-trips curve on text layers (default 0)', () => {
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ curve: -45 }), fakeTextLayer({ id: 'T2' }));
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].curve, -45);
  assert.equal(out.layers[1].curve, 0);
});

test('serializeDoc carries fx as-is, null when absent', () => {
  const fx = { shadow: 20, shadowDX: 8, shadowDY: 8, shadowColor: '#000000' };
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ fx }), fakeTextLayer({ id: 'T2', fx: null }));
  const out = serializeDoc(doc);
  assert.deepEqual(out.layers[0].fx, fx);
  assert.equal(out.layers[1].fx, null);
});

test('a layer keeps a Multiply blend through save and load; anything else is Normal', async () => {
  const doc = createDoc();
  doc.layers.push({ ...createFillLayer('#123456'), id: 'A', blend: 'multiply' }, { ...createFillLayer('#123456'), id: 'B', blend: 'screen' });
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  assert.deepEqual(back.layers.map(l => l.blend), ['multiply', null]);
});

test('a repeat keeps its settings through save and load, cleaned; an old pattern loads as the plain shape', async () => {
  const doc = createDoc();
  const repeat = { way: 'scatter', count: 9999, space: 12, colors: ['#FF0000', 'nope'], shapes: [{ kind: 'star' }, { kind: 'nope' }], mix: 'random', seed: 7, fadeOut: true };
  doc.layers.push({ ...createFillLayer('#123456'), id: 'A', repeat }, { ...createFillLayer('#123456'), id: 'B', motif: { kind: 'star', size: 80, gap: 40 } });
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  const r = back.layers[0].repeat;
  assert.deepEqual([r.way, r.count, r.space, r.colors, r.shapes, r.mix, r.seed, r.fadeOut, r.shrink], ['scatter', 500, 12, ['#ff0000'], [{ kind: 'star' }], 'random', 7, true, false]);
  assert.equal(back.layers[1].motif, undefined);
  assert.equal(back.layers[1].repeat, undefined);
});

test('pit box swatches keep their place and colour through save and load, cleaned', async () => {
  const doc = createDoc();
  doc.pitbox = [{ x: 1986, y: 2021, w: 27, h: 24, color: '#ff0000', ref: 'gone' }, { x: 9999, y: -5, w: 27, h: 24, color: '#03ff32', ref: null }, { x: 0, y: 0, w: 1, h: 1, color: 'red' }];
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  assert.deepEqual(back.pitbox, [{ x: 1986, y: 2021, w: 27, h: 24, color: '#ff0000', ref: null }, { x: 2048, y: 0, w: 27, h: 24, color: '#03ff32', ref: null }]);
});

test('createFillLayer initializes colorMid/midPos and serializeDoc keeps them', () => {
  const fill = createFillLayer('#123456');
  assert.equal(fill.colorMid, null);
  assert.equal(fill.midPos, 0.5);
  fill.colorMid = '#00ff00';
  fill.midPos = 0.25;
  const doc = createDoc();
  doc.layers.push(fill);
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].colorMid, '#00ff00');
  assert.equal(out.layers[0].midPos, 0.25);
});

test('a fade keeps the colours it passes through, in order along it', async () => {
  const fill = createFillLayer('#123456');
  fill.stops = [{ color: '#00ff00', at: 0.7 }, { color: '#ff0000', at: 0.2 }];
  const doc = createDoc();
  doc.layers.push(fill);
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  assert.deepEqual(fadeStops(back.layers[0]).map(o => o.color), ['#ff0000', '#00ff00']);
  assert.deepEqual(fadeStops({ colorMid: '#abcdef', midPos: 0.3 }), [{ color: '#abcdef', at: 0.3 }]); // an older save's middle colour
});

test('a car gradient: solid blocks, gaps fade, touching blocks meet sharp, the later one wins an overlap', async () => {
  assert.deepEqual(carStops([{ color: '#0000ff', from: 0.5, to: 0.6 }, { color: '#000000', from: 0, to: 0.2 }, { color: '#ff0000', from: 0.55, to: 0.8 }]), [
    { at: 0, color: '#000000' }, { at: 0.2, color: '#000000' },
    { at: 0.5, color: '#0000ff' }, { at: 0.6, color: '#0000ff' },
    { at: 0.6, color: '#ff0000' }, { at: 0.8, color: '#ff0000' },
  ]);
  const fill = createFillLayer('#000000');
  fill.car = { blocks: [{ color: '#000000', from: 0, to: 0.2 }] };
  const doc = createDoc();
  doc.layers.push(fill, createFillLayer('#ffffff'));
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  assert.deepEqual(back.layers[0].car, fill.car);
  assert.equal(back.layers[1].car, null);
});

test('deserializeDoc restores fill colorMid/midPos with defaults', async () => {
  const doc = await deserializeDoc({
    format: 'overspray/1',
    layers: [
      { type: 'fill', color: '#112233', fillType: 'linear', colorMid: '#abcdef', midPos: 0.7 },
      { type: 'fill', color: '#112233', fillType: 'linear' }, // pre-feature save
    ],
  });
  assert.equal(doc.layers[0].colorMid, '#abcdef');
  assert.equal(doc.layers[0].midPos, 0.7);
  assert.equal(doc.layers[1].colorMid, null);
  assert.equal(doc.layers[1].midPos, 0.5);
});

test('deserializeDoc keeps a shadow and fills in what it leaves out', async () => {
  const doc = await deserializeDoc({
    format: 'overspray/1',
    layers: [{ type: 'image', src: 'data:x', fx: { shadow: 12 } }, { type: 'image', src: 'data:x' }],
  });
  assert.deepEqual(doc.layers[0].fx, { shadow: 12, shadowDX: 8, shadowDY: 8, shadowColor: '#000000' });
  assert.equal(doc.layers[1].fx, null);
});

test('resolveParams overlays matParams on material defaults', () => {
  assert.deepEqual(defaultParams('gloss'), { met: 0, rough: 40, clear: 255 });
  assert.deepEqual(resolveParams('gloss', { rough: 99 }), { met: 0, rough: 99, clear: 255 });
});

// ---------- luminance-driven spec (weathering) ----------

test('deserializeDoc restores scaleY on image layers (stretch survived reload)', async () => {
  const doc = await deserializeDoc({
    format: 'overspray/1',
    layers: [
      { type: 'image', src: 'data:x', scale: 1, scaleY: 2.5 },
      { type: 'image', src: 'data:x', scale: 1 }, // uniform — stays null
    ],
  });
  assert.equal(doc.layers[0].scaleY, 2.5);
  assert.equal(doc.layers[1].scaleY, null);
});

test('readPalettes: one palette, a list of them, or just colours', () => {
  const one = { overspray: 'palette', name: 'Team', colors: [{ name: 'Main', color: '#FF0000' }, { name: 'Bad', color: 'red' }, { color: 'abc' }] };
  assert.deepEqual(readPalettes(one), [{ name: 'Team', colors: [{ name: 'Main', color: '#ff0000' }, { name: 'Colour 3', color: '#aabbcc' }] }]);
  assert.equal(readPalettes([one, { name: 'Empty', colors: [] }]).length, 1); // a palette with no colour is left out
  assert.deepEqual(readPalettes({ palettes: [one] })[0].name, 'Team');
  assert.deepEqual(readPalettes(['#000000', '#fff'], 'gulf'), [{ name: 'gulf', colors: [{ name: 'Colour 1', color: '#000000' }, { name: 'Colour 2', color: '#ffffff' }] }]);
  assert.deepEqual(readPalettes(null), []);
  assert.deepEqual(readPalettes('nonsense'), []);
});

test('readPalettes: fonts travel with a palette, cleaned, and a fonts-only palette is kept', () => {
  const [p] = readPalettes({ name: 'Team', colors: ['#ff0000'], fonts: { google: ['Oswald', ' Oswald ', 3], custom: [{ name: 'Mine', data: 'AAAA' }, { name: 'Bad' }] } });
  assert.deepEqual(p.fonts, { google: ['Oswald'], custom: [{ name: 'Mine', data: 'AAAA' }] });
  assert.equal('fonts' in readPalettes({ colors: ['#ff0000'], fonts: { google: [] } })[0], false); // none: left out
  assert.equal(readPalettes({ name: 'Just fonts', colors: [], fonts: { google: ['Oswald'] } }).length, 1);
});
