// Minimal TGA encoder — uncompressed BGR(A), top-left origin.
// Paints export as 24-bit; spec maps as 32-bit with the alpha channel forced
// to 255: iRacing reads spec alpha as "what percentage of metallic/roughness
// applies", so it must be explicit, not left to chance.

// Encode top-left-origin RGBA bytes as an uncompressed (type 2) truecolor
// TGA. Alpha is forced to 255 in 32-bit output (full spec effect everywhere).
// Pure: no canvas, safe under node.
export function encodeTGA(rgba, w, h, { alpha = false } = {}) {
  const bpp = alpha ? 4 : 3;

  // one buffer, header then body: a 2048 paint is 12 MB, a spec map 16 MB, so no second copy
  const out = new Uint8Array(18 + w * h * bpp);
  out[2] = 2;                          // uncompressed true-color
  out[12] = w & 0xff;
  out[13] = (w >> 8) & 0xff;
  out[14] = h & 0xff;
  out[15] = (h >> 8) & 0xff;
  out[16] = bpp * 8;                   // bits per pixel
  out[17] = alpha ? 0x28 : 0x20;       // top-left origin (+8 alpha bits)

  let o = 18;
  for (let i = 0; i < rgba.length; i += 4) {
    out[o++] = rgba[i + 2]; // B
    out[o++] = rgba[i + 1]; // G
    out[o++] = rgba[i];     // R
    if (alpha) out[o++] = 255; // full effect everywhere
  }
  return out;
}

export function canvasToTGA(canvas, { alpha = false } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return new Blob([encodeTGA(rgba, w, h, { alpha })], { type: 'image/x-tga' });
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
