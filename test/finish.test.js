import test from 'node:test';
import assert from 'node:assert/strict';

// finish.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { finishSpec, baseSpec, layerColour, withFinishes, setRule, clearRule, finishList, ruleFor, readFinish, writeFinish, finishLabel, presetOf, SPARKLE, oneSparkle, liverySparkle } = await import('../js/finish.js');
const finishOf = (doc, layer) => finishSpec(doc, layer).material;
const baseFinish = (doc) => baseSpec(doc).material;
const { createDoc, createFillLayer, serializeDoc, deserializeDoc, cleanFinishRules } = await import('../js/engine.js');

function doc() {
  const d = createDoc();
  d.baseColor = '#ffffff';
  const black = createFillLayer('#111214'); black.name = 'Black one';
  const black2 = createFillLayer('#111214'); black2.name = 'Black two';
  const red = createFillLayer('#D7263D'); red.name = 'Red';
  const logo = { id: 'pic', type: 'image', name: 'Logo', material: 'gloss', visible: true };
  d.layers.push(black, black2, red, logo);
  return d;
}

test('a colour rule gives every layer of that colour the finish, and nothing else', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  assert.deepEqual(d.layers.map(l => finishOf(d, l)), ['matte', 'matte', 'gloss', 'gloss']);
  assert.equal(baseFinish(d), 'gloss');
  setRule(d, '#FFFFFF', 'pearl'); // case does not matter; the base coat follows too
  assert.equal(baseFinish(d), 'pearl');
});

test('a layer\'s own finish beats its colour\'s rule, plain gloss included', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  d.layers[1].material = 'chrome'; d.layers[1].finishOwn = true;
  assert.equal(finishOf(d, d.layers[1]), 'chrome');
  d.layers[0].material = 'gloss'; d.layers[0].finishOwn = true;
  assert.equal(finishOf(d, d.layers[0]), 'gloss');
});

test('the finish follows the colour when a shape is recoloured', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  d.layers[2].color = '#111214';
  assert.equal(finishOf(d, d.layers[2]), 'matte');
  d.layers[0].color = '#00a651';
  assert.equal(finishOf(d, d.layers[0]), 'gloss');
});

test('withFinishes hands the engine layers carrying their finish, without touching the doc', () => {
  const d = doc();
  assert.equal(withFinishes(d), d, 'no rules: the doc itself');
  setRule(d, '#111214', 'matte');
  const shown = withFinishes(d);
  assert.deepEqual(shown.layers.map(l => l.material), ['matte', 'matte', 'gloss', 'gloss']);
  assert.equal(d.layers[0].material, 'gloss');
  assert.equal(shown.layers[2], d.layers[2], 'unchanged layers are the same objects');
});

test('setRule replaces a colour\'s rule in place; gloss is kept as a choice; clearRule removes it', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  setRule(d, '#d7263d', 'pearl');
  setRule(d, '#111214', 'satin');
  assert.deepEqual(d.finishRules, [{ color: '#111214', material: 'satin' }, { color: '#d7263d', material: 'pearl' }]);
  setRule(d, '#111214', 'gloss');
  assert.deepEqual(d.finishRules[0], { color: '#111214', material: 'gloss' });
  assert.equal(finishList(d).find(f => f.colour === '#111214').material, 'gloss');
  assert.deepEqual(d.layers.map(l => finishOf(d, l)), ['gloss', 'gloss', 'pearl', 'gloss']);
  clearRule(d, '#111214');
  assert.equal(ruleFor(d, '#111214'), null);
  assert.equal(d.finishRules.length, 1);
});

test('finishList: every colour in the livery with its finish, then layers and areas with their own', () => {
  const d = doc();
  // nothing set yet: each colour is there already, as gloss
  assert.deepEqual(finishList(d).map(f => [f.kind, f.colour, f.material, f.used]),
    [['colour', '#ffffff', 'gloss', 1], ['colour', '#111214', 'gloss', 2], ['colour', '#d7263d', 'gloss', 1]]);
  setRule(d, '#111214', 'matte');
  setRule(d, '#00a651', 'chrome'); // a colour not in the livery: kept, not listed
  d.layers[2].material = 'candy'; d.layers[2].finishOwn = true; // Red is finished by itself now, so red is no longer a listed colour
  const area = createFillLayer('#000000'); area.name = 'Area 1'; area.specOnly = true; area.material = 'pearl';
  d.layers.push(area);
  assert.deepEqual(finishList(d), [
    { kind: 'colour', colour: '#ffffff', material: 'gloss', params: null, used: 1 },
    { kind: 'colour', colour: '#111214', material: 'matte', params: null, used: 2 },
    { kind: 'layer', id: d.layers[2].id, name: 'Red', material: 'candy', params: null },
    { kind: 'area', id: area.id, name: 'Area 1', material: 'pearl', params: null },
  ]);
  assert.equal(ruleFor(d, '#00a651').material, 'chrome');
});

test('rules and own-finish marks survive save and load; junk rules are dropped', async () => {
  const d = doc();
  d.layers.pop(); // the stub picture has no src to reload
  setRule(d, '#111214', 'matte');
  d.layers[0].finishOwn = true;
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
  assert.deepEqual(back.finishRules, [{ color: '#111214', material: 'matte' }]);
  assert.equal(back.layers[0].finishOwn, true);
  assert.equal(back.layers[1].finishOwn, undefined);
  assert.deepEqual(cleanFinishRules([{ color: 'red', material: 'matte' }, { color: '#000000', material: 'nope' }, { color: '#ABCDEF', material: 'satin' }, { color: '#abcdef', material: 'matte' }]),
    [{ color: '#abcdef', material: 'satin' }]);
});

test('a finish reads as three numbers and optional sparkle, and writes back to what the engine stamps', () => {
  assert.deepEqual(readFinish('matte', null), { met: 0, rough: 230, clear: 60, sparkle: null });
  assert.equal(presetOf(readFinish('matte', null)), 'matte');
  // untouched preset: its name, no params
  assert.deepEqual(writeFinish(readFinish('matte', null)), { material: 'matte', params: null });
  // a slider moved: still called by the finish it came from, with its own numbers
  assert.deepEqual(writeFinish({ met: 0, rough: 200, clear: 60, sparkle: null }, 'matte'), { material: 'matte', params: { met: 0, rough: 200, clear: 60 } });
  // moved onto another preset's numbers, it is that preset
  assert.deepEqual(writeFinish({ met: 0, rough: 120, clear: 150, sparkle: null }, 'matte'), { material: 'satin', params: null });
});

test('sparkle sits on top of any finish: specks at size 1, chips above', () => {
  const matte = readFinish('matte', null);
  const fine = writeFinish({ ...matte, sparkle: { ...SPARKLE } });
  assert.deepEqual(fine, { material: 'flake', params: { met: 0, rough: 230, clear: 60, density: 18, contrast: 100, bright: 50 } });
  const coarse = writeFinish({ ...matte, sparkle: { amount: 30, size: 5, strength: 60 } });
  assert.deepEqual(coarse, { material: 'glitter', params: { met: 0, rough: 230, clear: 60, density: 30, scale: 5, contrast: 60, bright: 0 } });
  // and reads back as the same finish with the same sparkle
  assert.deepEqual(readFinish(coarse.material, coarse.params), { ...matte, sparkle: { amount: 30, size: 5, strength: 60, bright: 0 } });
  assert.deepEqual(readFinish(fine.material, fine.params).sparkle, { amount: 18, size: 1, strength: 100, bright: 50 });
  // sparkle from before it had a brightness: its flecks did not lighten the paint, and still do not
  assert.equal(readFinish('flake', { met: 0, rough: 230, clear: 60, density: 18, contrast: 100 }).sparkle.bright, 0);
  // the brightness is kept with a colour's finish rule
  assert.equal(cleanFinishRules([{ color: '#ff0000', material: 'flake', params: { ...fine.params } }])[0].params.bright, 50);
});

test('labels: a preset, a preset with sparkle, tweaked numbers', () => {
  assert.equal(finishLabel('matte', null), 'Matte');
  const s = writeFinish({ ...readFinish('pearl', null), sparkle: { ...SPARKLE } });
  assert.equal(finishLabel(s.material, s.params), 'Pearl + sparkle');
  assert.equal(finishLabel('matte', { met: 10, rough: 200, clear: 60 }), 'Custom');
});

test('a colour rule carries tweaked numbers and sparkle to its layers and the base coat', async () => {
  const d = doc();
  const f = writeFinish({ ...readFinish('matte', null), sparkle: { ...SPARKLE } });
  setRule(d, '#111214', f.material, f.params);
  setRule(d, '#ffffff', 'gloss', { met: 0, rough: 20, clear: 255 }); // gloss, made a little smoother
  const shown = withFinishes(d);
  assert.equal(shown.layers[0].material, 'flake');
  assert.deepEqual(shown.layers[0].matParams, f.params);
  assert.deepEqual([shown.baseMaterial, shown.baseMatParams], ['gloss', { met: 0, rough: 20, clear: 255 }]);
  d.layers.pop();
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
  assert.deepEqual(back.finishRules, d.finishRules);
  clearRule(d, '#ffffff');
  assert.equal(ruleFor(d, '#ffffff'), null);
});

test('a picture has a colour only once it is given one, and then follows that colour\'s finish', () => {
  const doc = { finishRules: [{ color: '#ff0000', material: 'matte' }], layers: [] };
  assert.equal(layerColour({ type: 'image' }), null);
  assert.equal(finishOf(doc, { type: 'image' }), 'gloss');
  assert.equal(finishOf(doc, { type: 'image', color: '#FF0000' }), 'matte');
});


test('a Repeat\'s extra colours are listed, and their copies take those colours\' finishes', () => {
  const d = doc();
  d.layers[2].repeat = { colors: ['#00A651', '#111214'] };
  assert.deepEqual(finishList(d).map(f => [f.colour, f.used]), [['#ffffff', 1], ['#111214', 3], ['#d7263d', 1], ['#00a651', 1]]);
  assert.equal(withFinishes(d).layers[2].copyFinishes, undefined, 'all gloss: nothing to split');
  setRule(d, '#00a651', 'chrome');
  assert.deepEqual(withFinishes(d).layers[2].copyFinishes.map(f => f.material), ['gloss', 'chrome', 'gloss']);
  d.layers[2].material = 'matte'; d.layers[2].finishOwn = true; // finished by itself: every copy with it
  assert.equal(withFinishes(d).layers[2].copyFinishes, undefined);
});

test('a car gradient has a finish of its own, not its first colour\'s', () => {
  const d = doc();
  const g = createFillLayer('#111214'); g.name = 'Car gradient';
  g.car = { blocks: [{ color: '#111214', from: 0, to: 0.5 }, { color: '#ffcc00', from: 0.6, to: 1 }] };
  d.layers.push(g);
  const list = finishList(d);
  assert.equal(list.find(f => f.colour === '#111214').used, 2); // only the two black layers
  assert.deepEqual(list.at(-1), { kind: 'layer', id: g.id, name: 'Car gradient', material: 'gloss', params: null });
  setRule(d, '#111214', 'matte');
  assert.equal(finishOf(d, g), 'gloss');
});

test('the livery has one sparkle: every sparkly finish takes the first one, each keeping its own three numbers', () => {
  const d = doc();
  const [a, b, c] = d.layers;
  ({ material: b.material, params: b.matParams } = writeFinish({ met: 255, rough: 10, clear: 255, sparkle: { amount: 40, size: 6, strength: 100, bright: 0 } }));
  ({ material: a.material, params: a.matParams } = writeFinish({ met: 0, rough: 230, clear: 60, sparkle: { amount: 10, size: 1, strength: 80, bright: 20 } }));
  setRule(d, '#d7263d', ...Object.values(writeFinish({ met: 180, rough: 70, clear: 255, sparkle: { amount: 55, size: 3, strength: 50, bright: 90 } })));
  oneSparkle(d);
  const want = { amount: 10, size: 1, strength: 80, bright: 20 };
  assert.deepEqual(liverySparkle(d), want);
  assert.deepEqual(readFinish(b.material, b.matParams), { met: 255, rough: 10, clear: 255, sparkle: want });
  assert.deepEqual(readFinish(d.finishRules[0].material, d.finishRules[0].params).sparkle, want);
  assert.equal(readFinish(c.material, c.matParams).sparkle, null); // no sparkle stays none
});
