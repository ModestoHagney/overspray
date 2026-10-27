import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTGA, decodeTGA } from '../js/tga.js';

// a 2x2 picture: red, green on the top row; blue, white below
const RGBA_2x2 = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

// an 18-byte TGA header, for files made by hand in the decode tests
const header = ({ type = 2, w, h, bpp = 24, descriptor = 0x20, idLen = 0, cmapType = 0 }) =>
  Uint8Array.from([idLen, cmapType, type, 0, 0, 0, 0, 0, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, bpp, descriptor]);
const concat = (...parts) => new Uint8Array(parts.flatMap(p => [...p])).buffer;

test('encodeTGA 24-bit: plain header, pixels stored blue-green-red from the top', () => {
  const out = encodeTGA(RGBA_2x2, 2, 2);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out.slice(0, 18)], [...header({ w: 2, h: 2 })]);
  assert.deepEqual([...out.slice(18)], [0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255]);
});

test('encodeTGA 32-bit: alpha bits in the header, every alpha 255', () => {
  const see = Uint8ClampedArray.from(RGBA_2x2, (v, i) => i === 3 ? 17 : v); // a see-through pixel
  const out = encodeTGA(see, 2, 2, { alpha: true });
  assert.deepEqual([...out.slice(0, 18)], [...header({ w: 2, h: 2, bpp: 32, descriptor: 0x28 })]);
  assert.equal(out.length, 18 + 16);
  assert.deepEqual([...out.slice(18, 22)], [0, 0, 255, 255]);
  assert.ok(out.slice(18).every((v, i) => i % 4 !== 3 || v === 255));
});

test('decodeTGA reads what encodeTGA writes', () => {
  const { w, h, rgba } = decodeTGA(encodeTGA(RGBA_2x2, 2, 2).buffer);
  assert.equal(w, 2); assert.equal(h, 2);
  assert.deepEqual([...rgba], [...RGBA_2x2]);
});

test('decodeTGA: RLE, bottom-left origin, 32-bit alpha and opaque', () => {
  // bottom row first: blue, white (raw packet); then top row: red twice (run)
  const body = new Uint8Array([
    0x01, 255, 0, 0, 10,  255, 255, 255, 20,
    0x81, 0, 0, 255, 30,
  ]);
  const buf = concat(header({ type: 10, w: 2, h: 2, bpp: 32, descriptor: 0x08 }), body);
  const { rgba } = decodeTGA(buf);
  assert.deepEqual([...rgba], [255, 0, 0, 30, 255, 0, 0, 30, 0, 0, 255, 10, 255, 255, 255, 20]);
  assert.equal(decodeTGA(buf, { opaque: true }).rgba[3], 255);
});

test('decodeTGA refuses colour-mapped files', () => {
  assert.throws(() => decodeTGA(concat(header({ type: 1, w: 1, h: 1, bpp: 8, cmapType: 1 }), new Uint8Array(1))));
});
