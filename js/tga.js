// TGA files for iRacing, written and read without a canvas so the tests can
// run them under node. A paint is written as 24-bit; a spec map as 32-bit with
// every alpha byte 255, because iRacing scales the spec map's effect by alpha
// and a missing or random alpha would weaken it.

// Top-left-origin RGBA bytes → an uncompressed truecolour TGA (type 2), with
// alpha (32-bit) or without (24-bit).
export function encodeTGA(rgba, w, h, { alpha = false } = {}) {
  const size = alpha ? 4 : 3;
  // the header and the pixels share one buffer: a 2048 paint is 12 MB, a spec
  // map 16 MB, so they are not copied again
  const out = new Uint8Array(18 + w * h * size);
  out.set([2], 2);                            // image type: truecolour, no RLE
  out.set([w & 255, w >> 8, h & 255, h >> 8, size * 8, alpha ? 0x28 : 0x20], 12); // size, bits, top-left origin (+ 8 alpha bits)
  for (let i = 0, o = 18; i < rgba.length; i += 4) {
    out[o++] = rgba[i + 2];                   // stored blue, green, red
    out[o++] = rgba[i + 1];
    out[o++] = rgba[i];
    if (alpha) out[o++] = 255;
  }
  return out;
}

// a canvas as a TGA file
export function canvasToTGA(canvas, { alpha = false } = {}) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  return new Blob([encodeTGA(data, width, height, { alpha })], { type: 'image/x-tga' });
}

// Read a TGA (a paint from the iRacing folder or Trading Paints) into
// top-left-origin RGBA. Truecolour and greyscale, plain or RLE (types 2, 3,
// 10, 11); colour-mapped ones are refused. opaque: alpha set to 255, since a
// paint's alpha channel is not part of what iRacing shows.
export function decodeTGA(buf, { opaque = false } = {}) {
  const b = new Uint8Array(buf);
  const type = b[2], w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), bpp = b[16] >> 3, desc = b[17];
  if (b[1] || ![2, 3, 10, 11].includes(type) || !w || !h || ![1, 3, 4].includes(bpp) || (bpp === 1) !== (type === 3 || type === 11)) throw new Error('This TGA kind cannot be read');
  const rle = type > 8, n = w * h, out = new Uint8ClampedArray(n * 4);
  let p = 18 + b[0];
  const px = (o, s) => { // one source pixel at s into out at o
    if (bpp === 1) { out[o] = out[o + 1] = out[o + 2] = b[s]; out[o + 3] = 255; return; }
    out[o] = b[s + 2]; out[o + 1] = b[s + 1]; out[o + 2] = b[s];
    out[o + 3] = bpp === 4 && !opaque ? b[s + 3] : 255;
  };
  const top = desc & 0x20, right = desc & 0x10;
  const at = (i) => { // the i-th stored pixel's place in out
    let y = Math.floor(i / w), x = i % w;
    if (!top) y = h - 1 - y;
    if (right) x = w - 1 - x;
    return (y * w + x) * 4;
  };
  for (let i = 0; i < n;) {
    let count = 1, repeat = false;
    if (rle) { const c = b[p++]; count = (c & 0x7f) + 1; repeat = !!(c & 0x80); }
    for (let k = 0; k < count && i < n; k++, i++) {
      if (p + bpp > b.length) throw new Error('This TGA is cut short');
      px(at(i), p);
      if (!repeat) p += bpp;
    }
    if (repeat) p += bpp;
  }
  return { w, h, rgba: out };
}
