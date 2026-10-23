import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXcf } from '../js/xcf.js';

// Fixtures saved by GIMP 2.10 (gimp-console, script-fu): a 100x70 sheet with,
// bottom to top, "bottom" (grey, no alpha), group "Sponsors" ("red box" 40x30
// at 5,6 with a mask hiding its left half; "shade", blue, multiply, 50%),
// "hidden one" (green, turned off), "mostly empty" (a sheet-size layer with
// one 7x5 yellow block at 80,50) and a text layer "Hi". zlib.xcf is rgb.xcf
// with its tiles packed as zlib (GIMP's "better but slower compression").
const read = (f, o) => readXcf(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)), o);
const px = (l, x, y) => { const i = ((y - l.top) * l.image.w + (x - l.left)) * 4; return [...l.image.rgba.slice(i, i + 4)]; };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);

for (const f of ['rgb.xcf', 'zlib.xcf', 'u16linear.xcf', 'float.xcf']) {
  test(`readXcf ${f}: tree, settings and pixels`, async () => {
    const doc = await read(f);
    assert.equal(doc.width, 100); assert.equal(doc.height, 70);
    assert.deepEqual(doc.children.map(l => l.name), ['bottom', 'Sponsors', 'hidden one', 'mostly empty', 'Hi']);
    const [bottom, group, hidden, empty, text] = doc.children;
    assert.deepEqual(group.children.map(l => l.name), ['red box', 'shade']);
    const [red, shade] = group.children;
    assert.ok(near(px(bottom, 50, 30), [128, 128, 128, 255]));
    assert.deepEqual([red.left, red.top, red.image.w, red.image.h], [5, 6, 40, 30]);
    assert.ok(near(px(red, 30, 20), [255, 0, 0, 255]));
    assert.equal(red.mask.data[0], 0); // left half hidden
    assert.equal(red.mask.data[39], 255);
    assert.equal(red.mask.disabled, false);
    assert.equal(shade.blendMode, 'multiply');
    assert.ok(Math.abs(shade.opacity - 0.5) < 0.01);
    assert.equal(hidden.hidden, true);
    assert.equal(bottom.hidden, false);
    assert.deepEqual([empty.left, empty.top, empty.image.w, empty.image.h], [80, 50, 7, 5]); // trimmed to what shows
    assert.equal(text.text, true);
    assert.equal(bottom.text, false);
  });
}

test('readXcf: grey and indexed images come back as RGBA', async () => {
  const grey = await read('grey.xcf');
  const g = px(grey.children[0], 0, 0);
  assert.equal(g[0], g[1]); assert.equal(g[1], g[2]);
  const indexed = await read('indexed.xcf');
  assert.deepEqual(indexed.children.map(l => l.name), ['back', 'dot']);
  assert.deepEqual(px(indexed.children[0], 1, 1), [200, 30, 40, 255]);
  assert.deepEqual(px(indexed.children[1], 66, 4), [10, 20, 250, 255]);
});

test('readXcf: keep reads only the pixels asked for', async () => {
  const seen = [];
  const doc = await read('rgb.xcf', { keep: (n, up) => { seen.push([...up.map(g => g.name), n.name].join('/')); return n.name === 'shade'; } });
  assert.ok(seen.includes('Sponsors/red box'));
  assert.equal(doc.children[0].image, undefined);
  assert.ok(doc.children[1].children[1].image);
});

test('readXcf refuses what is not a GIMP file', async () => {
  await assert.rejects(readXcf(new Uint8Array(64)));
});
