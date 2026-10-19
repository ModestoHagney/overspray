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
