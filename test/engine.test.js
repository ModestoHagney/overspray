import test from 'node:test';
import assert from 'node:assert/strict';

// Just enough of a browser for engine.js to load under node: it makes its
// canvases when loaded, and image layers need an Image that "loads".
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
globalThis.Image = class { set src(_) { queueMicrotask(() => this.onload?.()); } };

const { createDoc, createFillLayer, serializeDoc, deserializeDoc, fadeStops, carStops, resolveParams, defaultParams, readPalettes, MATERIALS } = await import('../js/engine.js');

// a text layer made by hand (createTextLayer needs a real canvas to draw on)
const handText = (extra = {}) => ({
  id: 'T1', type: 'text', name: 'text', visible: true, opacity: 1, material: 'gloss', img: {}, src: 'data:image/png;base64,x',
  text: 'GO', font: 'Impact', fontSize: 120, textColor: '#ff0000', outlineColor: '#ffffff', outlineWidth: 2,
  italic: true, letterSpacing: 3, curve: 0, fx: null, x: 300, y: 400, scale: 2, rotation: 10, flipH: false, flipV: false,
  ...extra,
});
const saveAndLoad = (doc) => deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));

test('saving text keeps its bend (0 when it has none) and its shadow (null when none)', () => {
  const shadow = { shadow: 15, shadowDX: -4, shadowDY: 10, shadowColor: '#202020' };
  const doc = createDoc();
  doc.layers.push(handText({ curve: 120, fx: shadow }), handText({ id: 'T2', curve: undefined }));
  const [bent, flat] = serializeDoc(doc).layers;
  assert.deepEqual([bent.curve, bent.fx], [120, shadow]);
  assert.deepEqual([flat.curve, flat.fx], [0, null]);
  assert.deepEqual([bent.font, bent.fontSize, bent.italic, bent.letterSpacing, bent.outlineWidth], ['Impact', 120, true, 3, 2]);
});

test('a layer keeps a Multiply blend through save and load; anything else is Normal', async () => {
  const doc = createDoc();
  doc.layers.push({ ...createFillLayer('#123456'), id: 'A', blend: 'multiply' }, { ...createFillLayer('#123456'), id: 'B', blend: 'screen' });
  const back = await saveAndLoad(doc);
  assert.deepEqual(back.layers.map(l => l.blend), ['multiply', null]);
});

test('a repeat keeps its settings through save and load, cleaned; an old pattern loads as the plain shape', async () => {
  const doc = createDoc();
  const repeat = { way: 'scatter', count: 9999, space: 12, colors: ['#FF0000', 'nope'], shapes: [{ kind: 'star' }, { kind: 'nope' }], mix: 'random', seed: 7, fadeOut: true };
  doc.layers.push({ ...createFillLayer('#123456'), id: 'A', repeat }, { ...createFillLayer('#123456'), id: 'B', motif: { kind: 'star', size: 80, gap: 40 } });
  const back = await saveAndLoad(doc);
  const r = back.layers[0].repeat;
  assert.deepEqual([r.way, r.count, r.space, r.colors, r.shapes, r.mix, r.seed, r.fadeOut, r.shrink], ['scatter', 500, 12, ['#ff0000'], [{ kind: 'star' }], 'random', 7, true, false]);
  assert.equal(back.layers[1].motif, undefined);
  assert.equal(back.layers[1].repeat, undefined);
});

test('extra colour squares keep their name, place and colour through save and load, cleaned; an older save\'s pitbox loads too', async () => {
  const doc = createDoc();
  doc.swatches = [{ name: 'Cockpit', x: 1986, y: 2021, w: 27, h: 24, color: '#ff0000', ref: 'gone' }, { name: 'Pit box', x: 9999, y: -5, w: 27, h: 24, color: '#03ff32', ref: null }, { x: 0, y: 0, w: 1, h: 1, color: 'red' }];
  const back = await saveAndLoad(doc);
  assert.deepEqual(back.swatches, [{ name: 'Cockpit', x: 1986, y: 2021, w: 27, h: 24, color: '#ff0000', ref: null }, { name: 'Pit box', x: 2048, y: 0, w: 27, h: 24, color: '#03ff32', ref: null }]);
  const board = await deserializeDoc({ swatches: [{ name: 'Pitboard', x: 0, y: 0, w: 10, h: 10, color: '#ffffff', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 99999, y: 10 }] }] });
  assert.deepEqual(board.swatches[0].points, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2048, y: 10 }]);
  const old = await deserializeDoc({ pitbox: [{ x: 1, y: 2, w: 3, h: 4, color: '#ff0000' }, { x: 5, y: 2, w: 3, h: 4, color: '#00ff00' }] });
  assert.deepEqual(old.swatches.map(p => p.name), ['Pit box 1', 'Pit box 2']);
});

test('a new shape is a 600 x 400 gloss box in the middle with no fade colours, and saves its middle colour', () => {
  const s = createFillLayer('#abcdef');
  assert.deepEqual([s.type, s.color, s.material, s.shape, s.fillType], ['fill', '#abcdef', 'gloss', 'rect', 'solid']);
  assert.deepEqual([s.rx, s.ry, s.rw, s.rh], [724, 824, 600, 400]);
  assert.deepEqual([s.colorMid, s.midPos, s.stops], [null, 0.5, []]);
  assert.equal(createFillLayer().color, '#e8e6e1');
  const doc = createDoc();
  doc.layers.push({ ...s, colorMid: '#111111', midPos: 0.8 });
  const [saved] = serializeDoc(doc).layers;
  assert.deepEqual([saved.colorMid, saved.midPos], ['#111111', 0.8]);
});

test('a fade keeps the colours it passes through, in order along it', async () => {
  const fill = createFillLayer('#123456');
  fill.stops = [{ color: '#00ff00', at: 0.7 }, { color: '#ff0000', at: 0.2 }];
  const doc = createDoc();
  doc.layers.push(fill);
  const back = await saveAndLoad(doc);
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
  const back = await saveAndLoad(doc);
  assert.deepEqual(back.layers[0].car, fill.car);
  assert.equal(back.layers[1].car, null);
});

test('loading a shape fills in what an older save left out', async () => {
  const doc = await deserializeDoc({ layers: [
    { type: 'fill', color: '#445566', fillType: 'radial', colorMid: '#998877', midPos: 0.1 },
    { type: 'fill' },
  ] });
  const [a, b] = doc.layers;
  assert.deepEqual([a.colorMid, a.midPos, a.fillType], ['#998877', 0.1, 'radial']);
  assert.deepEqual([b.color, b.colorMid, b.midPos, b.fillType, b.color2, b.shape, b.material], ['#e8e6e1', null, 0.5, 'solid', '#101114', 'rect', 'gloss']);
  assert.deepEqual([b.rx, b.ry, b.rw, b.rh, b.visible, b.opacity], [0, 0, 2048, 2048, true, 1]);
});

test('loading a picture keeps its shadow (missing numbers filled in) and its own height scale', async () => {
  const doc = await deserializeDoc({ layers: [
    { type: 'image', src: 'data:a', fx: { shadow: 30, shadowColor: '#0000ff' }, scale: 0.5, scaleY: 1.5 },
    { type: 'image', src: 'data:b', scale: 0.5 },
  ] });
  const [a, b] = doc.layers;
  assert.deepEqual(a.fx, { shadow: 30, shadowDX: 8, shadowDY: 8, shadowColor: '#0000ff' });
  assert.deepEqual([a.scale, a.scaleY, b.scaleY, b.fx], [0.5, 1.5, null, null]);
  assert.deepEqual([b.x, b.y, b.rotation, b.flipH], [1024, 1024, 0, false]);
});

test('loading leaves out kinds of layer it does not know, and keeps the livery settings it does', async () => {
  const doc = await deserializeDoc({ name: 'Mine', target: 'suit', customNumber: 1, baseColor: '#000000', baseMaterial: 'chrome', layers: [{ type: 'hologram' }, { type: 'fill', id: 'keep' }] });
  assert.deepEqual([doc.name, doc.target, doc.customNumber, doc.baseColor, doc.baseMaterial], ['Mine', 'suit', true, '#000000', 'chrome']);
  assert.deepEqual(doc.layers.map(l => l.id), ['keep']);
  const odd = await deserializeDoc({ target: 'boat' });
  assert.deepEqual([odd.name, odd.target, odd.baseColor], ['untitled livery', 'car', '#1a6cff']);
});

test('a finish starts from its own numbers, and a layer\'s changes go over them', () => {
  assert.deepEqual(defaultParams('matte'), { met: 0, rough: 230, clear: 60 });
  assert.deepEqual(defaultParams('glitter'), { met: 170, rough: 60, clear: 255, density: 30, scale: 4, contrast: 100 });
  assert.deepEqual(defaultParams('no such finish'), defaultParams('gloss'));
  assert.deepEqual(resolveParams('chrome', { rough: 50 }), { met: 255, rough: 50, clear: 255 });
  assert.deepEqual(resolveParams('flake', null), defaultParams('flake'));
  assert.notEqual(defaultParams('gloss'), defaultParams('gloss')); // a new object each time
  assert.deepEqual(Object.keys(MATERIALS), ['gloss', 'matte', 'satin', 'metallic', 'chrome', 'pearl', 'flake', 'glitter']);
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
