import test from 'node:test';
import assert from 'node:assert/strict';

// tools.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { initTools } = await import('../next/tools.js');
const { parseRegionMap } = await import('../js/regions.js');
const { pieces } = await import('../js/shapes.js');

const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

test('Fill panel: Shift+click adds the panel to the same layer', () => {
  const regionMap = parseRegionMap({
    format: 'overspray-regions/1', car: 'test',
    regions: [
      { id: 'door', name: 'Door', x: 0, y: 0, w: 400, h: 200, points: box(0, 0, 400, 200) },
      { id: 'roof', name: 'Roof', x: 1000, y: 0, w: 400, h: 400, points: box(1000, 0, 400, 400) },
    ],
  });
  const app = { tool: 'piece', mode: 'paint', colour: '#ff0000', doc: { regionMap, layers: [] }, sel: null };
  const tools = initTools(app, {
    screenToDoc: (x, y) => ({ x, y }), change() {}, requestDraw() {}, created() {}, say() {},
    selectedLayers: () => app.doc.layers.filter(l => l.id === app.sel),
  });
  tools.down({ shiftKey: false }, { x: 100, y: 100 });
  tools.down({ shiftKey: true }, { x: 1100, y: 100 });
  assert.equal(app.doc.layers.length, 1);
  assert.equal(app.doc.layers[0].name, 'door + roof'); // panel names are lowercase (see cleanName)
  assert.equal(pieces(app.doc.layers[0].pts).length, 2);
  tools.down({ shiftKey: false }, { x: 1100, y: 100 }); // a plain click is a new layer, as before
  assert.equal(app.doc.layers.length, 2);
});
