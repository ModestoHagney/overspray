import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js makes its canvases when loaded; nothing here draws, so a stand-in will do
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
// …and pictures are placed with DOMMatrix, which Node lacks: the four calls used, in 2D
globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } };
globalThis.DOMMatrix = class M {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
  mul(a, b, c, d, e, f) { const m = this; return new M(m.a * a + m.c * b, m.b * a + m.d * b, m.a * c + m.c * d, m.b * c + m.d * d, m.a * e + m.c * f + m.e, m.b * e + m.d * f + m.f); }
  translate(x, y) { return this.mul(1, 0, 0, 1, x, y); }
  scale(x, y = x) { return this.mul(x, 0, 0, y, 0, 0); }
  rotate(deg) { const r = deg * Math.PI / 180; return this.mul(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0); }
  transformPoint(p) { return new DOMPoint(this.a * p.x + this.c * p.y + this.e, this.b * p.x + this.d * p.y + this.f); }
};
const { initTools } = await import('../next/tools.js');

test('Flip turns the selection over as one, and twice puts it back', () => {
  const tri = { id: 'a', type: 'fill', shape: 'triangle', rx: 0, ry: 0, rw: 100, rh: 50, visible: true, fillType: 'solid' };
  const box = { id: 'b', type: 'fill', shape: 'rect', rx: 200, ry: 0, rw: 100, rh: 50, visible: true, fillType: 'linear', gradAngle: 30 };
  const pic = { id: 'c', type: 'image', img: { width: 100, height: 20 }, x: 150, y: 100, scale: 1, rotation: 20, flipH: false, flipV: false, visible: true };
  const app = { doc: { layers: [tri, box, pic], groups: [] }, sel: 'a', mode: 'paint', tool: 'select', view: { zoom: 1 } };
  const tools = initTools(app, { selectedLayers: () => app.doc.layers, screenToDoc: (p) => p, docToScreen: (p) => p, change() {}, requestDraw() {} });
  const tip = () => tri.pts.reduce((a, q) => (q.y < a.y ? q : a)); // the triangle's point
  assert.equal(tools.flip(true), 3);
  assert.equal(tri.shape, 'path'); // a triangle becomes an outline
  assert.equal(box.shape, 'rect'); // a box looks the same flipped: it stays one
  assert.equal(box.rx, 0); // it swapped ends with the triangle
  assert.equal(box.gradAngle, 150); // its fade runs the other way
  assert.deepEqual([pic.flipH, pic.rotation, Math.round(pic.x)], [true, -20, 150]); // in the middle, it stays put
  tools.flip(true);
  assert.deepEqual([Math.round(box.rx), box.gradAngle, pic.flipH, pic.rotation, Math.round(pic.x)], [200, 30, false, 20, 150]);
  const up = tip().y;
  tools.flip(false);
  assert.ok(tip().y > up); // upside down: its point is at the bottom now
  tools.flip(false);
  assert.deepEqual([Math.round(tip().y), Math.round(pic.y), pic.flipV, box.gradAngle], [Math.round(up), 100, false, 30]);
});
