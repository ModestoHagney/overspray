// GIMP's own file (.xcf), read into the same shape of layer tree that the
// PSD reader gives (ag-psd's), so a GIMP livery or kit goes through the same
// import as a PSD. No page elements in here: pixels come back as RGBA bytes.
//
// What is read: GIMP 2.x and later files (any version), RGB, grey or indexed,
// at any precision (brought down to 8-bit sRGB), uncompressed, RLE or zlib
// tiles; layer groups, visibility, opacity, offsets, layer masks, the blend
// mode (as normal, multiply or other) and whether a layer is text. Channels,
// paths, the selection and GIMP 3's layer effects are not.

const PROP = { END: 0, COLORMAP: 1, FLOATING: 5, OPACITY: 6, MODE: 7, VISIBLE: 8, APPLY_MASK: 11, OFFSETS: 15, COMPRESSION: 17, PARASITES: 21, TEXT: 26, GROUP: 29, PATH: 30, FLOAT_OPACITY: 33 };
const NORMAL = new Set([0, 28]), MULTIPLY = new Set([3, 30]), PASS_THROUGH = 61;

// precision (the image header's, version 4 on) → bytes per component, kind, linear light
function precisionOf(v, p) {
  if (v < 4) return { bpc: 1, kind: 'u', linear: false };
  if (v === 4) return [{ bpc: 1, kind: 'u', linear: false }, { bpc: 2, kind: 'u', linear: false }, { bpc: 4, kind: 'u', linear: true }, { bpc: 2, kind: 'h', linear: true }, { bpc: 4, kind: 'f', linear: true }][p];
  const linear = p % 100 === 0;
  const table = v < 7 ? { 1: [1, 'u'], 2: [2, 'u'], 3: [4, 'u'], 4: [2, 'h'], 5: [4, 'f'] }
    : { 1: [1, 'u'], 2: [2, 'u'], 3: [4, 'u'], 5: [2, 'h'], 6: [4, 'f'], 7: [8, 'd'] };
  const t = table[Math.floor(p / 100)];
  return t && { bpc: t[0], kind: t[1], linear };
}

const toSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
function half(h) {
  const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}

// tile bytes (bpp streams for RLE) back to interleaved pixels
function unRLE(b, p, n, bpp) {
  const out = new Uint8Array(n * bpp);
  for (let c = 0; c < bpp; c++) {
    for (let i = 0; i < n;) {
      const op = b[p++];
      if (op <= 127) { // a run of one byte: short (op+1) or long (two bytes of count)
        const count = op < 127 ? op + 1 : (b[p++] << 8) | b[p++], v = b[p++];
        for (let k = 0; k < count && i < n; k++, i++) out[i * bpp + c] = v;
      } else { // bytes as they are: long (128, two bytes of count) or short (256 - op)
        const count = op === 128 ? (b[p++] << 8) | b[p++] : 256 - op;
        for (let k = 0; k < count && i < n; k++, i++) out[i * bpp + c] = b[p++];
      }
    }
  }
  return out;
}

async function inflate(src, n) {
  const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(), r = ds.readable.getReader();
  w.write(src).catch(() => {}); w.close().catch(() => {});
  const out = new Uint8Array(n);
  let o = 0;
  try {
    while (o < n) {
      const { done, value } = await r.read();
      if (done) break;
      const k = Math.min(value.length, n - o);
      out.set(value.subarray(0, k), o); o += k;
    }
  } catch (e) { if (o < n) throw e; } // bytes after the tile's own stream (the last tile's end is not written down)
  r.cancel().catch(() => {});
  if (o < n) throw new Error('A tile in this XCF is cut short');
  return out;
}

// → { width, height, children }: nodes { name, hidden, opacity (0..1),
//   blendMode ('normal' | 'multiply' | 'pass through' | 'other'), left, top,
//   text, children (a group, bottom first) | image: { w, h, rgba } (trimmed
//   to what is not see-through; none when nothing is), mask: { left, top, w,
//   h, data (grey bytes), disabled } }.
// keep(node, ancestors): whether to read a layer's pixels (the rest come back
// without, which is quicker and keeps memory down).
export async function readXcf(buf, { keep = () => true } = {}) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(...b.subarray(0, 9)) !== 'gimp xcf ') throw new Error('This is not a GIMP file');
  const tag = String.fromCharCode(...b.subarray(9, 13));
  const v = tag === 'file' ? 0 : parseInt(tag.slice(1), 10);
  let p = 14;
  const u32 = () => { const x = dv.getUint32(p); p += 4; return x; };
  const ptr = v >= 11 ? () => { const x = Number(dv.getBigUint64(p)); p += 8; return x; } : u32;
  const width = u32(), height = u32(), base = u32();
  const prec = precisionOf(v, v >= 4 ? u32() : 0);
  if (!prec) throw new Error('This XCF uses a colour precision that cannot be read');
  const props = () => {
    const out = {};
    for (;;) {
      const t = u32(), n = u32();
      if (t === PROP.END) return out;
      if (t === PROP.COLORMAP) { const k = dv.getUint32(p); out[t] = b.subarray(p + 4, p + 4 + 3 * k); p += 4 + 3 * k; continue; } // old GIMPs wrote its length wrong
      out[t] = { at: p, n }; p += n;
    }
  };
  const img = props();
  const compression = img[PROP.COMPRESSION] ? b[img[PROP.COMPRESSION].at] : 0;
  const colormap = img[PROP.COLORMAP] || null;
  const tops = [];
  for (let q; (q = ptr());) tops.push(q);

  const str = () => { const n = u32(), s = new TextDecoder().decode(b.subarray(p, p + Math.max(0, n - 1))); p += n; return s; };
  // one hierarchy (a layer's or a mask's pixels) → { w, h, bpp, px } at 8 bits a component
  const pixels = async (at) => {
    p = at;
    const w = u32(), h = u32(), bpp = u32(), level = ptr();
    p = level;
    const lw = u32(), lh = u32(), tiles = [];
    for (let q; (q = ptr());) tiles.push(q);
    const tx = Math.ceil(lw / 64), comps = bpp / prec.bpc, out = new Uint8ClampedArray(lw * lh * comps);
    for (let i = 0; i < tiles.length; i++) {
      const x0 = (i % tx) * 64, y0 = Math.floor(i / tx) * 64, tw = Math.min(64, lw - x0), th = Math.min(64, lh - y0), n = tw * th;
      const end = Math.min(b.length, tiles[i] + n * bpp + 1024); // zlib never grows a tile by that much; what is past its stream is not read
      const raw = compression === 1 ? unRLE(b, tiles[i], n, bpp) : compression === 2 ? await inflate(b.subarray(tiles[i], end), n * bpp) : b.subarray(tiles[i], tiles[i] + n * bpp);
      const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let k = 0; k < n; k++) {
        const o = ((y0 + Math.floor(k / tw)) * lw + x0 + (k % tw)) * comps;
        for (let c = 0; c < comps; c++) {
          const s = (k * comps + c) * prec.bpc;
          if (prec.bpc === 1 && !prec.linear) { out[o + c] = raw[s]; continue; }
          let x = prec.kind === 'u' ? (prec.bpc === 1 ? raw[s] / 255 : prec.bpc === 2 ? rv.getUint16(s) / 65535 : rv.getUint32(s) / 4294967295)
            : prec.kind === 'h' ? half(rv.getUint16(s)) : prec.kind === 'f' ? rv.getFloat32(s) : rv.getFloat64(s);
          const alpha = (comps === 2 || comps === 4) && c === comps - 1;
          if (prec.linear && !alpha) x = toSrgb(Math.max(0, x));
          out[o + c] = Math.round(x * 255);
        }
      }
    }
    return { w: lw, h: lh, comps, px: out };
  };

  // the layers, top first, each with its place in the tree
  const flat = [];
  let topIndex = 0;
  for (const at of tops) {
    p = at;
    const w = u32(), h = u32(), type = u32(), name = str(), pr = props();
    const hier = ptr(), maskAt = ptr();
    if (pr[PROP.FLOATING]) continue; // a floating selection is not a layer
    const get = (t, f) => (pr[t] ? f(pr[t].at) : undefined);
    const isText = (q) => !!q && new TextDecoder().decode(b.subarray(q.at, q.at + q.n)).includes('gimp-text-layer'); // GIMP marks a text layer with a parasite
    const path = pr[PROP.PATH] ? Array.from({ length: pr[PROP.PATH].n / 4 }, (_, k) => dv.getUint32(pr[PROP.PATH].at + 4 * k)) : [topIndex++];
    const mode = get(PROP.MODE, (q) => dv.getUint32(q)) ?? 0;
    const [left, top] = get(PROP.OFFSETS, (q) => [dv.getInt32(q), dv.getInt32(q + 4)]) || [0, 0];
    flat.push({
      node: {
        name, hidden: get(PROP.VISIBLE, (q) => dv.getUint32(q)) === 0,
        opacity: get(PROP.FLOAT_OPACITY, (q) => dv.getFloat32(q)) ?? (get(PROP.OPACITY, (q) => dv.getUint32(q)) ?? 255) / 255,
        blendMode: mode === PASS_THROUGH ? 'pass through' : NORMAL.has(mode) ? 'normal' : MULTIPLY.has(mode) ? 'multiply' : 'other',
        left, top, text: !!pr[PROP.TEXT] || isText(pr[PROP.PARASITES]), ...(pr[PROP.GROUP] ? { children: [] } : {}),
      },
      path, w, h, type, hier, maskAt, applyMask: get(PROP.APPLY_MASK, (q) => dv.getUint32(q)) !== 0,
    });
  }
  const root = { width, height, children: [] }, byPath = new Map();
  for (const f of flat) {
    byPath.set(f.path.join('/'), f.node);
    const parent = f.path.length > 1 ? byPath.get(f.path.slice(0, -1).join('/')) : root;
    if (parent && parent.children) parent.children[f.path[f.path.length - 1]] = f.node; // GIMP saves a group before what is in it
  }
  const tidy = (n) => { n.children = n.children.filter(Boolean).reverse(); n.children.forEach(c => c.children && tidy(c)); }; // bottom first, as ag-psd has them
  tidy(root);

  const ancestors = (f) => f.path.slice(1).map((_, k) => byPath.get(f.path.slice(0, k + 1).join('/')));
  for (const f of flat) {
    if (f.node.children || !keep(f.node, ancestors(f))) continue;
    const { w, h, comps, px } = await pixels(f.hier);
    const rgba = new Uint8ClampedArray(w * h * 4), hasAlpha = comps === 2 || comps === 4, indexed = base === 2;
    for (let i = 0, o = 0; i < w * h; i++, o += 4) {
      const s = i * comps;
      if (indexed) { const k = px[s] * 3; rgba[o] = colormap[k]; rgba[o + 1] = colormap[k + 1]; rgba[o + 2] = colormap[k + 2]; }
      else if (comps <= 2) rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s];
      else { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; }
      rgba[o + 3] = hasAlpha ? px[s + comps - 1] : 255;
    }
    if (f.maskAt) {
      p = f.maskAt;
      u32(); u32(); str(); props();
      const m = await pixels(ptr());
      f.node.mask = { left: f.node.left, top: f.node.top, w: m.w, h: m.h, data: m.px, disabled: !f.applyMask };
    }
    // trimmed to what shows: a GIMP layer is often the whole sheet with a logo in one corner
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue; // nothing in it
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    let cut = rgba;
    if (tw !== w || th !== h) {
      cut = new Uint8ClampedArray(tw * th * 4);
      for (let y = 0; y < th; y++) cut.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + tw) * 4), y * tw * 4);
    }
    f.node.left += x0; f.node.top += y0;
    f.node.image = { w: tw, h: th, rgba: cut };
  }
  return root;
}
