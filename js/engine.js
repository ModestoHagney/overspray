// Overspray render engine — document model, paint compositing, spec map generation.

import { parseRegionMap } from './regions.js';
import { SHAPES, placed, flatten, contains } from './shapes.js';

export const SIZE = 2048;

// iRacing PBR spec map convention (per official template PSDs):
// R = metallic, G = roughness, B = clearcoat strength.
// `tex` materials bake a procedural per-pixel micro-texture into the spec
// channels instead of flat values.
// Per iRacing's docs the blue (clearcoat) channel should stay white unless
// deliberately reduced. Every material is a *starting recipe* — per-layer
// matParams (met/rough/clear + texture knobs) override these defaults.
export const MATERIALS = {
  gloss:    { label: 'Gloss',    met: 0,   rough: 40,  clear: 255 },
  matte:    { label: 'Matte',    met: 0,   rough: 230, clear: 60  },
  satin:    { label: 'Satin',    met: 0,   rough: 120, clear: 150 },
  metallic: { label: 'Metallic', met: 180, rough: 70,  clear: 255 },
  chrome:   { label: 'Chrome',   met: 255, rough: 10,  clear: 255 },
  pearl:    { label: 'Pearl',    met: 190, rough: 60,  clear: 255 },
  flake:    { label: 'Flake',    tex: 'flake',   met: 160, rough: 45,  clear: 255, density: 18, contrast: 100 },
  glitter:  { label: 'Glitter',  tex: 'glitter', met: 170, rough: 60,  clear: 255, density: 30, scale: 4, contrast: 100 },
};

// fresh copy of a material's editable parameters
export function defaultParams(key) {
  const m = MATERIALS[key] || MATERIALS.gloss;
  const p = { met: m.met, rough: m.rough, clear: m.clear };
  if (m.density !== undefined) p.density = m.density;
  if (m.scale !== undefined) p.scale = m.scale;
  if (m.contrast !== undefined) p.contrast = m.contrast;
  return p;
}

export function resolveParams(materialKey, matParams) {
  return { ...defaultParams(materialKey), ...(matParams || {}) };
}

// ---------- procedural spec micro-textures ----------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const texCache = new Map();

export function specTexture(key, p) {
  const cacheKey = `${key}|${p.met}|${p.rough}|${p.clear}|${p.scale || 0}|${p.density || 0}|${p.contrast || 0}`;
  if (texCache.has(cacheKey)) return texCache.get(cacheKey);
  if (texCache.size > 8) texCache.clear(); // slider scrubbing — keep memory flat

  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(SIZE, SIZE);
  const d = id.data;
  const rand = mulberry32(0xC0FFEE); // seeded — identical output every export
  const k = (p.contrast ?? 100) / 100;
  // Sparkle also comes as `canvas.light`: the same flecks in white, each as
  // see-through as it is weak. Laid over the paint (see sparkleLight) it
  // lightens the colour under every fleck, so a fleck reads bright even with
  // nothing to mirror. A fleck of full mirror metal with nothing bright to
  // reflect is otherwise a dark speck.
  const light = key === 'flake' || key === 'glitter' ? document.createElement('canvas') : null;
  if (light) { light.width = light.height = SIZE; c.light = light; }

  if (key === 'flake') {
    // sparkle speckle: random pixels spike metallic and drop roughness
    const density = Math.max(0.01, (p.density ?? 18) / 100);
    const thr = 1 - density;
    const lid = light.getContext('2d').createImageData(SIZE, SIZE), ld = lid.data;
    for (let i = 0; i < d.length; i += 4) {
      const f = rand();
      const s = (f > thr ? (f - thr) / density : 0) * k;
      d[i]     = clamp255(p.met + (255 - p.met) * s);
      d[i + 1] = clamp255(p.rough * (1 - 0.85 * s));
      d[i + 2] = p.clear;
      d[i + 3] = 255;
      ld[i] = ld[i + 1] = ld[i + 2] = 255;
      ld[i + 3] = clamp255(255 * s);
    }
    light.getContext('2d').putImageData(lid, 0, 0);
  } else if (key === 'glitter') {
    // coarse sparkle: multi-pixel chips (flake's loud cousin). Each chip
    // spikes metallic and carries its OWN roughness, so different chips
    // catch the light at different angles — the tumbling-glitter look.
    ctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const size = Math.max(2, Math.round(p.scale ?? 4));
    const density = Math.max(1, Math.min(80, p.density ?? 30));
    const count = Math.round((SIZE * SIZE * (density / 100)) / (size * size));
    const lctx = light.getContext('2d');
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rand() * SIZE);
      const y = Math.floor(rand() * SIZE);
      const flash = rand() * k;                       // how hard this chip flashes
      const met = clamp255(p.met + (255 - p.met) * (0.4 + 0.6 * flash));
      const rough = clamp255(p.rough * (1 - 0.9 * flash) + rand() * 30);
      const s = Math.max(1, Math.round(size * (0.7 + rand() * 0.6)));
      ctx.fillStyle = `rgb(${met},${rough},${p.clear})`;
      ctx.fillRect(x, y, s, s);
      lctx.fillStyle = `rgba(255,255,255,${(0.4 + 0.6 * flash).toFixed(3)})`;
      lctx.fillRect(x, y, s, s);
    }
    texCache.set(cacheKey, c);
    return c; // drawn with fillRect — skip the ImageData path below
  }
  ctx.putImageData(id, 0, 0);
  texCache.set(cacheKey, c);
  return c;
}

let nextId = 1;
export function newId() { return 'L' + (nextId++) + '-' + Date.now().toString(36); }

export function createDoc() {
  return {
    name: 'untitled livery',
    target: 'car',       // what this project paints: 'car' | 'helmet' | 'suit'
    customNumber: false, // iRacing Custom Number paints export car_num_<id>.tga
    car: null,           // the car's folder inside the iRacing paints folder
    baseColor: '#1a6cff',
    baseMaterial: 'gloss',
    baseMatParams: null,
    layers: [],          // bottom → top: shapes (fills), text and pictures
    groups: [],          // flat layer groups: { id, name, collapsed, turn }; members carry layer.groupId; turn: the angle its box stands at, in degrees
    template: null,      // { img, src } — viewport reference only
    customFonts: [],            // { name, data (base64) } — uploaded fonts travel with the project
    googleFonts: [],            // names of Google fonts added by name, beyond the built-in list
    finishRules: [],            // { color, material, params? }: every shape or text of that colour gets that finish (see finish.js)
    regionMap: null,            // parsed overspray-regions/1 map (see regions.js)
    palette: [],                // the livery's saved colours { id, name, color }; a layer's colorRef (or baseRef) points at one
    baseRef: null,              // palette id the base coat follows, if any
    swatches: [],               // the car's extra colours (pit box, cockpit) as squares from the template: { name, x, y, w, h, color, ref } (ref: palette id it follows)
  };
}

export function createImageLayer(img, src, name) {
  // start centered, scaled to fit within half the sheet
  const fit = Math.min(1, (SIZE / 2) / Math.max(img.width, img.height));
  return {
    id: newId(),
    type: 'image',
    name: name || 'image',
    visible: true,
    opacity: 1,
    material: 'gloss',
    fx: null,          // a shadow, when it has one: { shadow, shadowDX, shadowDY, shadowColor }
    img, src,
    x: SIZE / 2,
    y: SIZE / 2,
    scale: fit,
    scaleY: null,  // non-uniform Y scale; null = follow scale (uniform)
    rotation: 0,   // degrees
    flipH: false,
    flipV: false,
  };
}

// full local→doc transform for a picture or text layer; scaleY = null means
// "follow scale"
export function layerMatrix(l) {
  return new DOMMatrix()
    .translate(l.x, l.y)
    .rotate(l.rotation)
    .scale(l.scale * (l.flipH ? -1 : 1), (l.scaleY ?? l.scale) * (l.flipV ? -1 : 1))
    .scale(1 / (l.img?.res || 1)); // text drawn at more pixels than its size, to stay sharp scaled up
}

export const TEXT_FONTS = ['Arial Black', 'Impact', 'Georgia', 'Courier New', 'Verdana', 'Trebuchet MS'];

// curated livery-friendly Google Fonts — loaded on demand
export const GOOGLE_FONTS = [
  'Anton', 'Archivo Black', 'Bebas Neue', 'Black Ops One', 'Bungee', 'Faster One',
  'Monoton', 'Orbitron', 'Oswald', 'Permanent Marker', 'Racing Sans One', 'Russo One',
];

// decode a stored custom font (base64) and register it with the page;
// throws if the data doesn't parse as a font
export async function registerCustomFont(name, base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const face = new FontFace(name, bytes.buffer);
  await face.load();
  document.fonts.add(face);
}

// text layer — rasterized into img/src so the whole image pipeline
// (transform, hit-test, materials, thumbnails) treats it like any image
export function createTextLayer() {
  const layer = {
    id: newId(),
    type: 'text',
    name: 'text',
    visible: true,
    opacity: 1,
    material: 'gloss',
    img: null, src: null,
    text: 'TEXT',
    font: 'Arial Black',
    fontSize: 160,
    textColor: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 0,
    italic: false,
    letterSpacing: 0,
    curve: 0,          // arc bend in degrees; 0 = straight, + arches up, − arches down
    fx: null,          // a shadow, when it has one: { shadow, shadowDX, shadowDY, shadowColor }
    x: SIZE / 2,
    y: SIZE / 2,
    scale: 1,
    scaleY: null,
    rotation: 0,
    flipH: false,
    flipV: false,
  };
  regenerateText(layer);
  return layer;
}

// the font a text layer is drawn in, as the canvas wants it said. A weight is
// only named when the layer has one: a font drawn in its ordinary weight
// needs none.
export const textFont = (layer, size = 160) => `${layer.italic ? 'italic ' : ''}${layer.fontWeight ? layer.fontWeight + ' ' : ''}${size}px "${layer.font || 'Arial Black'}"`;

// how many pixels a text layer is drawn at per unit of its size: as many as
// it is scaled up by, so its letters stay sharp, within MAX_TEXT_PX a side
const MAX_TEXT_PX = 4096;
export const textRes = (layer, w, h) => Math.max(1, Math.min(Math.max(Math.abs(layer.scale || 1), Math.abs(layer.scaleY ?? layer.scale ?? 1)), MAX_TEXT_PX / Math.max(w, h, 1)));

// re-rasterize after any text property change, or after it is scaled; the
// canvas is sized to the text so the layer's center (x, y) stays put
export function regenerateText(layer) {
  const lines = String(layer.text ?? '').split('\n');
  const size = Math.max(40, Math.min(400, layer.fontSize || 160));
  const outline = Math.max(0, Math.min(30, layer.outlineWidth || 0));
  const fontStr = textFont(layer, size);
  const spacing = `${Math.max(-40, Math.min(40, layer.letterSpacing || 0))}px`;
  const lineH = size * Math.max(60, Math.min(300, layer.lineSpacing || 120)) / 100;
  const align = layer.align === 'left' || layer.align === 'right' ? layer.align : 'center'; // lines of different lengths: which side they share
  const curve = Math.max(-180, Math.min(180, Number(layer.curve) || 0));
  const margin = Math.ceil(outline) + Math.ceil(size * 0.15); // outline + italic overhang
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  let W, k; // the text's width, and the pixels it is drawn at per unit of its size
  const size2 = (w, h) => { W = w; k = textRes(layer, w, h); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k); ctx.scale(k, k); };
  if (!curve) {
    // straight text — original rendering path
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing;
    const maxW = Math.max(1, ...lines.map(t => ctx.measureText(t).width));
    size2(Math.ceil(maxW) + margin * 2, Math.ceil(lineH * lines.length) + margin * 2);
    // resizing reset the context — set everything again
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = layer.textColor || '#ffffff';
    ctx.strokeStyle = layer.outlineColor || '#000000';
    ctx.lineWidth = outline * 2; // half the stroke falls outside the glyph
    const x = align === 'left' ? margin : align === 'right' ? W - margin : W / 2;
    lines.forEach((line, i) => {
      const y = margin + lineH * (i + 0.5);
      if (outline > 0) ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
    });
  } else {
    // curved text — glyphs laid glyph-by-glyph along a circular arc whose
    // total angle is `curve` degrees. Positive arches upward (bends along the
    // top of a circle), negative arches downward. Letter-spacing gaps are
    // inserted manually between glyphs so measurement stays exact.
    const spacingPx = Math.max(-40, Math.min(40, layer.letterSpacing || 0));
    const theta = Math.abs(curve) * Math.PI / 180;
    const dir = curve > 0 ? 1 : -1;
    ctx.font = fontStr;
    const lineData = lines.map(text => {
      const chars = Array.from(text);
      const widths = chars.map(ch => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0) + spacingPx * Math.max(0, chars.length - 1);
      return { chars, widths, total };
    });
    // arc bounding box: chord extent horizontally, sagitta (arc rise) vertically
    let maxW = 1, maxSag = 0;
    for (const ld of lineData) {
      const R = Math.max(ld.total, 1) / theta;
      const half = theta / 2;
      const xExt = (half >= Math.PI / 2 ? R : R * Math.sin(half)) + size;
      const sag = R * (1 - Math.cos(Math.min(half, Math.PI)));
      maxW = Math.max(maxW, xExt * 2);
      maxSag = Math.max(maxSag, sag);
    }
    size2(Math.ceil(maxW) + margin * 2, Math.ceil(lineH * lines.length + maxSag) + margin * 2);
    // resizing reset the context — set everything again
    ctx.font = fontStr;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; // gaps applied manually
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.fillStyle = layer.textColor || '#ffffff';
    ctx.strokeStyle = layer.outlineColor || '#000000';
    ctx.lineWidth = outline * 2; // half the stroke falls outside the glyph
    lineData.forEach((ld, i) => {
      if (!ld.chars.length) return;
      const R = Math.max(ld.total, 1) / theta;
      const sag = R * (1 - Math.cos(Math.min(theta / 2, Math.PI)));
      // center each line's arc vertically on its nominal line slot
      const lineY = margin + maxSag / 2 + lineH * (i + 0.5) - dir * sag / 2;
      let s = -ld.total / 2; // arc-length cursor from the line's midpoint
      ld.chars.forEach((ch, j) => {
        const phi = (s + ld.widths[j] / 2) / R; // signed angle from arc midpoint
        ctx.save();
        ctx.translate(W / 2 + R * Math.sin(phi), lineY + dir * R * (1 - Math.cos(phi)));
        ctx.rotate(dir * phi);
        if (outline > 0) ctx.strokeText(ch, 0, 0);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        s += ld.widths[j] + spacingPx;
      });
    });
  }
  c.res = k; // layerMatrix shrinks it back by this
  layer.img = c;
  layer.src = c.toDataURL('image/png');
  delete layer._albedo; // shader-ball albedo cache is stale now
}

// solid-color material patch — a resizable shape carrying its own color
// and material, so finishes (pearl, flake…) can be placed without an image
export function createFillLayer(color = '#e8e6e1') {
  return {
    id: newId(),
    type: 'fill',
    name: 'fill',
    visible: true,
    opacity: 1,
    material: 'gloss',
    color,
    shape: 'rect',         // rect | ellipse | triangle | path
    pts: null,             // shape 'path': the outline, [{ x, y, c? }] in doc space (see shapes.js)
    fillType: 'solid',     // solid | linear | radial
    color2: '#101114',     // gradient end color
    colorMid: null,        // optional third gradient stop (hex) — null = two-stop
    midPos: 0.5,           // mid stop position 0–1
    stops: [],             // colours it fades through on the way, [{ color, at: 0–1 }]; these replace colorMid
    gradAngle: 0,          // linear gradient angle in degrees, 0 = left → right
    x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false,
    rx: SIZE / 2 - 300, ry: SIZE / 2 - 200, rw: 600, rh: 400,
  };
}

// shape silhouette for a fill layer, built inside an arbitrary rect (the
// layer's region, or a thumbnail box). A 'path' shape is drawn from its own
// points instead (doc space; the rect is then just its bounding box): each
// point may carry `c`, the bend handle of the line leaving it.
export function fillShapePath(shape, rx, ry, rw, rh, pts) {
  const p = new Path2D();
  if (shape === 'path' && Array.isArray(pts) && pts.length >= 3) {
    // a point marked `m` starts a separate piece of the same shape; each
    // piece closes on its own first point
    let start = 0;
    pts.forEach((a, i) => {
      if (i === 0 || a.m) { start = i; p.moveTo(a.x, a.y); }
      const last = i + 1 === pts.length || pts[i + 1].m, b = pts[last ? start : i + 1];
      if (a.c) p.quadraticCurveTo(a.c.x, a.c.y, b.x, b.y); else p.lineTo(b.x, b.y);
      if (last) p.closePath();
    });
    return p;
  }
  switch (shape) {
    case 'ellipse':
      p.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle': // isoceles, pointing up
      p.moveTo(rx + rw / 2, ry);
      p.lineTo(rx + rw, ry + rh);
      p.lineTo(rx, ry + rh);
      p.closePath();
      break;
    case 'diamond':
      p.moveTo(rx + rw / 2, ry);
      p.lineTo(rx + rw, ry + rh / 2);
      p.lineTo(rx + rw / 2, ry + rh);
      p.lineTo(rx, ry + rh / 2);
      p.closePath();
      break;
    case 'stripe': { // parallelogram slanted 45°, clamped to stay in the region
      const sh = Math.min(rh, rw);
      p.moveTo(rx + sh, ry);
      p.lineTo(rx + rw, ry);
      p.lineTo(rx + rw - sh, ry + rh);
      p.lineTo(rx, ry + rh);
      p.closePath();
      break;
    }
    default:
      p.rect(rx, ry, rw, rh);
  }
  return p;
}

// solid color or a color → color2 gradient spanning the given rect
export function fillPaintStyle(ctx, layer, rx, ry, rw, rh) {
  const color = layer.color || '#ffffff';
  if ((layer.fillType || 'solid') === 'solid') return color;
  const cx = rx + rw / 2, cy = ry + rh / 2;
  let g;
  const A = layer.fadeFrom, B = layer.fadeTo;
  if (A && B) {
    // the fade runs between two points placed on the sheet: from the first to
    // the second, or (radial) out from the first as far as the second
    g = layer.fillType === 'radial'
      ? ctx.createRadialGradient(A.x, A.y, 0, A.x, A.y, Math.max(1, Math.hypot(B.x - A.x, B.y - A.y)))
      : ctx.createLinearGradient(A.x, A.y, B.x, B.y);
  } else if (layer.fillType === 'radial') {
    // region center out to the farthest corner
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(rw, rh) / 2);
  } else {
    const a = (layer.gradAngle || 0) * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(dx) * rw + Math.abs(dy) * rh) / 2;
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  g.addColorStop(0, color);
  const mids = fadeStops(layer);
  for (const s of mids) g.addColorStop(Math.max(0.01, Math.min(0.99, s.at)), s.color);
  // fading to nothing ends in the last colour it passed through, see-through
  const end = layer.color2 || '#101114';
  g.addColorStop(1, mids.length && /^#[0-9a-f]{6}00$/i.test(end) ? mids[mids.length - 1].color + '00' : end);
  return g;
}

// the colours a fade passes through between its two ends, in order along it
export function fadeStops(layer) {
  const list = Array.isArray(layer.stops) && layer.stops.length ? layer.stops
    : layer.colorMid ? [{ color: layer.colorMid, at: layer.midPos ?? 0.5 }] : [];
  return list.filter(s => s && typeof s.color === 'string' && Number.isFinite(s.at)).sort((a, b) => a.at - b.at);
}

// A car gradient's colour blocks [{ color, from, to }] (0-1 along the car, front
// to back) as gradient stops: each block is solid from its start to its end,
// the gap to the next fades, and blocks that touch meet at a sharp edge. Where
// two overlap, the later-starting one wins from its start.
export function carStops(blocks) {
  const out = [];
  let last = 0;
  for (const b of [...(blocks || [])].sort((x, y) => x.from - y.from)) {
    const from = Math.max(last, Math.min(1, b.from)), to = Math.max(from, Math.min(1, b.to));
    out.push({ at: from, color: b.color }, { at: to, color: b.color });
    last = to;
  }
  return out;
}
export const cleanCar = (c) => {
  const blocks = c && Array.isArray(c.blocks) ? c.blocks.filter(b => b && typeof b.color === 'string' && Number.isFinite(b.from) && Number.isFinite(b.to)).slice(0, 12) : [];
  return blocks.length ? { blocks: blocks.map(b => ({ color: b.color, from: b.from, to: b.to })) } : null;
};

// which way a layer's fade line runs: its fill's own style while that fades,
// else the one kept for it
export const fadeStyleOf = (layer) => (layer.fillType === 'radial' || layer.fillType === 'linear' ? layer.fillType : layer.fadeStyle === 'radial' ? 'radial' : 'linear');
const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
// Who drew what a layer (or a repeat's shape) was made from: an icon from an
// open set asks to be credited. [{ icon, name, set, author, licence, url }]
const CREDIT_KEYS = ['icon', 'name', 'set', 'author', 'licence', 'url'];
export function cleanCredits(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(c => c && typeof c === 'object' && typeof c.icon === 'string' && c.icon && !seen.has(c.icon) && seen.add(c.icon)).slice(0, 40)
    .map(c => Object.fromEntries(CREDIT_KEYS.map(k => [k, typeof c[k] === 'string' ? c[k].slice(0, 200) : ''])));
}
// what repeats: a ready-made shape by name, or an outline of its own
function cleanMotifShape(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.kind !== 'own') return SHAPES[m.kind] ? { kind: m.kind } : null;
  const pts = shapePts(m.pts);
  if (!pts || !(m.w > 0) || !(m.h > 0)) return null;
  const credits = cleanCredits(m.credits);
  return { kind: 'own', pts, w: +m.w, h: +m.h, id: typeof m.id === 'string' ? m.id : undefined, name: typeof m.name === 'string' ? m.name : 'Shape', ...(credits.length ? { credits } : {}) };
}

export const isRegionLayer = (l) => l.type === 'fill';

// ---------- Repeat: copies of a layer in a line, a grid, or scattered ----------
// layer.repeat = { way: across | down | grid | scatter, count, rows, fill,
// gapX, gapY, angle, space, colors, shapes, mix, rSize, rTurn, seed, fadeOut, shrink, aim, mirrorX, mirrorY }.
// The layer itself is the first copy; the rest step on from it along its own
// axes (so a turned layer repeats the way it is turned), tilted by angle.
// A step is the item's own size, so copies sit snug, plus the gap. Scattered
// copies land anywhere on its trimmed panels (or the sheet), `space` apart.
// Copies are drawn from the layer each time, so they follow every change to it.
const REPEAT_WAYS = ['across', 'down', 'grid', 'scatter'];
const REPEAT_MAX = 4000; // copies drawn at most, however small the step
export function cleanRepeat(r) {
  if (!r || typeof r !== 'object') return null;
  const colors = (Array.isArray(r.colors) ? r.colors : []).filter(c => /^#[0-9a-f]{6}$/i.test(c || '')).slice(0, 6).map(c => c.toLowerCase());
  const shapes = (Array.isArray(r.shapes) ? r.shapes : []).map(cleanMotifShape).filter(Boolean).slice(0, 6);
  return {
    way: REPEAT_WAYS.includes(r.way) ? r.way : 'across',
    count: num(r.count, 1, 500, 5) | 0, rows: num(r.rows, 1, 200, 3) | 0, // copies across (or scattered), and down
    fill: !!r.fill, // as many as reach the edge of the sheet (Trim keeps them to a panel)
    gapX: num(r.gapX, -2048, 2048, 0), gapY: num(r.gapY, -2048, 2048, 0),
    angle: num(r.angle, -180, 180, 0), // tilt from the layer's own turn, in degrees
    space: num(r.space, -2048, 2048, 0), // scattered: room kept between copies' boxes; below 0 they may overlap by that much
    colors, shapes, // more colours, and (for a shape) more outlines, for the copies to take
    mix: r.mix === 'random' ? 'random' : 'turn', // in turn, or each by its roll
    rSize: num(r.rSize, 0, 100, 0), rTurn: num(r.rTurn, 0, 100, 0), // how much each copy's size and turn vary
    seed: Number.isFinite(+r.seed) ? +r.seed | 0 : 1,
    fadeOut: !!r.fadeOut, shrink: !!r.shrink, // the copies fade, or get smaller, the further they are from the layer
    aim: cleanAim(r.aim), // where that runs from and to, as offsets from the layer's middle; none: out from the layer to its furthest copy
    mirrorX: !!r.mirrorX, mirrorY: !!r.mirrorY, // a mirrored side's: its copies run back along its own across, or down (see mirror.js)
  };
}
const isPt = (q) => !!q && Number.isFinite(+q.x) && Number.isFinite(+q.y);
const cleanAim = (a) => (a && isPt(a.a) && isPt(a.b) ? { a: { x: +a.a.x, y: +a.a.y }, b: { x: +a.b.x, y: +a.b.y } } : null);
// → { a, b } on the sheet: copies fade (or shrink) to nothing as they get as far from a as b is
function aimOf(r, cx, cy, list) {
  if (r.aim) return { a: { x: cx + r.aim.a.x, y: cy + r.aim.a.y }, b: { x: cx + r.aim.b.x, y: cy + r.aim.b.y } };
  let b = { x: 1, y: 0 };
  for (const o of list) if (Math.hypot(o.x, o.y) > Math.hypot(b.x, b.y)) b = o;
  return { a: { x: cx, y: cy }, b: { x: cx + b.x, y: cy + b.y } };
}
export function repeatAim(layer) {
  const { cx, cy, list } = repeatOffsets(layer);
  return aimOf(layer.repeat, cx, cy, list);
}
// the item's own across and down on the sheet, as unit vectors: what its
// copies step along. A shape stands at the angle it was last turned to
// (layer.turn); text and pictures at their rotation.
export function repeatAxes(layer) {
  const t = (isRegionLayer(layer) ? layer.turn || 0 : layer.rotation || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const fh = layer.flipH ? -1 : 1, fv = layer.flipV ? -1 : 1;
  return { ex: { x: c * fh, y: s * fh }, ey: { x: -s * fv, y: c * fv } };
}
// where a picture's own pixels are, as fractions of it: text and logos carry
// see-through margins that would leave gaps between copies
const inks = new WeakMap();
function inkBox(img) {
  if (inks.has(img)) return inks.get(img);
  // ponytail: read at 256px at most, so the box is a pixel or two generous on a big picture
  const k = Math.min(1, 256 / Math.max(img.width, img.height, 1));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] < 16) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const box = x1 < 0 ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  inks.set(img, box);
  return box;
}
// → { cx, cy, W, H, list }: the layer's middle and size, and where each copy
// goes as { x, y } offsets on the sheet; the first is the layer itself
export function repeatOffsets(layer) {
  const r = layer.repeat;
  // the item's own axes on the sheet, and its size along them
  let { ex, ey } = repeatAxes(layer), W, H, cx, cy;
  if (isRegionLayer(layer)) {
    // a shape's box is taken at the angle it stands at, as its frame on screen is
    const t = (layer.turn || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    if (t && Array.isArray(layer.pts) && layer.pts.length >= 3) {
      let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
      for (const q of flatten(layer.pts)) {
        const u = q.x * c + q.y * s, v = q.y * c - q.x * s;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      W = u1 - u0; H = v1 - v0;
    } else { W = layer.rw; H = layer.rh; }
    cx = layer.rx + layer.rw / 2; cy = layer.ry + layer.rh / 2;
  } else {
    const m = layerMatrix(layer), o = m.transformPoint(new DOMPoint(0, 0));
    const a = m.transformPoint(new DOMPoint(1, 0)), b = m.transformPoint(new DOMPoint(0, 1));
    const la = Math.hypot(a.x - o.x, a.y - o.y) || 1, lb = Math.hypot(b.x - o.x, b.y - o.y) || 1;
    ex = { x: (a.x - o.x) / la, y: (a.y - o.y) / la }; ey = { x: (b.x - o.x) / lb, y: (b.y - o.y) / lb }; // skew and all
    const ink = inkBox(layer.img);
    W = (ink.x1 - ink.x0) * layer.img.width * la; H = (ink.y1 - ink.y0) * layer.img.height * lb;
    cx = layer.x; cy = layer.y;
  }
  if (r.mirrorX) ex = { x: -ex.x, y: -ex.y };
  if (r.mirrorY) ey = { x: -ey.x, y: -ey.y };
  // r.at: a Mirrored side's scatter, the original's spots carried across (mirror.js)
  if (r.way === 'scatter') return { cx, cy, W, H, list: r.at || scattered(layer, r, cx, cy, W, H, ex, ey) };
  const t = r.angle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  // one step in the direction (dc, ds) of the item's axes: as far as the box reaches that way, plus the gap
  const step = (dc, ds, gap) => {
    const k = Math.max(2, Math.min(Math.abs(dc) > 1e-6 ? W / Math.abs(dc) : Infinity, Math.abs(ds) > 1e-6 ? H / Math.abs(ds) : Infinity) + gap);
    return { x: (ex.x * dc + ey.x * ds) * k, y: (ex.y * dc + ey.y * ds) * k };
  };
  const u = step(c, s, r.gapX), v = step(-s, c, r.gapY);
  const reach = SIZE * 1.5 + W + H; // from anywhere on the sheet, past its far edge
  const fit = (w) => Math.ceil(reach / Math.hypot(w.x, w.y));
  const n = r.way === 'down' ? 1 : r.fill ? fit(u) : r.count;
  const m = r.way === 'across' ? 1 : r.fill ? fit(v) : r.rows;
  const out = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n && out.length < REPEAT_MAX; i++) {
      const x = u.x * i + v.x * j, y = u.y * i + v.y * j;
      const px = cx + x, py = cy + y, edge = W + H; // copies wholly off the sheet are left out
      if (px < -edge || py < -edge || px > SIZE + edge || py > SIZE + edge) continue;
      out.push({ x, y });
    }
  }
  return { cx, cy, W, H, list: out };
}
// Scattered: the layer, then copies dropped at random (by the seed) on its
// trimmed panels, or anywhere on the sheet, each box at least `space` clear of
// the others. Darts that land too close are thrown again, up to a limit, so
// a crowded panel gets fewer than asked for.
function scattered(layer, r, cx, cy, W, H, ex, ey) {
  const wins = clipPolys(layer);
  let x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE;
  if (wins.length) {
    const all = wins.flat();
    x0 = Math.min(...all.map(q => q.x)); y0 = Math.min(...all.map(q => q.y));
    x1 = Math.max(...all.map(q => q.x)); y1 = Math.max(...all.map(q => q.y));
  }
  const rand = mulberry32(r.seed);
  // two copies clash when their boxes (along the item's own axes) come closer
  // than `space`; a space below minus the item's size lets them sit anywhere
  // ponytail: by the item's own box, so a randomly turned or sized copy is only roughly kept clear
  const aw = W + r.space, ah = H + r.space, apart = aw > 0 && ah > 0;
  const clash = (q, x, y) => { const dx = x - q.x, dy = y - q.y; return Math.abs(dx * ex.x + dy * ex.y) < aw && Math.abs(dx * ey.x + dy * ey.y) < ah; };
  const pts = [{ x: cx, y: cy }];
  for (let tries = 0; pts.length < r.count && tries < r.count * 30; tries++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    if (wins.length && !wins.some(w => contains(w, x, y))) continue;
    if (apart && pts.some(q => clash(q, x, y))) continue; // ponytail: checks every copy, fine to a few hundred
    pts.push({ x, y });
  }
  return pts.map(q => ({ x: q.x - cx, y: q.y - cy }));
}
// The layer as one copy draws it: in another of the colours, or (a shape)
// as another of the outlines, set on its middle at its size.
const recoloured = new WeakMap(); // a picture → Map(colour → it in that colour)
function lookOf(layer, colour, shape, cx, cy, size) {
  let v = layer;
  if (shape) v = { ...v, shape: 'path', pts: placed(shape, cx, cy, size, layer.turn || 0, { x: layer.repeat.mirrorX, y: layer.repeat.mirrorY }) };
  if (colour && layer.type === 'fill') v = { ...v, color: colour };
  else if (colour) {
    const byColour = recoloured.get(layer.img) || new Map();
    recoloured.set(layer.img, byColour);
    if (!byColour.has(colour)) {
      if (layer.type === 'text') { const t = { ...layer, textColor: colour }; regenerateText(t); byColour.set(colour, t.img); }
      else { // a picture: its outline filled with the colour
        const c = document.createElement('canvas');
        c.width = layer.img.width; c.height = layer.img.height;
        const g = c.getContext('2d');
        g.drawImage(layer.img, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = colour;
        g.fillRect(0, 0, c.width, c.height);
        byColour.set(colour, c);
      }
    }
    v = { ...v, img: byColour.get(colour) };
  }
  return v;
}
// copy k's colour and outline (0 the layer's own, n the nth extra), and its
// roll for what else varies; the layer itself (k 0) is as it is
export function copyLook(r, k, ns = 1) {
  const roll = mulberry32((r.seed ^ Math.imul(k + 1, 0x9E3779B1)) | 0);
  const pick = (n) => (!k ? 0 : r.mix === 'random' ? Math.floor(roll() * n) : k % n);
  const c = pick(1 + r.colors.length), s = pick(ns);
  return { c, s, roll };
}
// the layer and its copies, each varied as its settings say
function drawCopies(ctx, layer) {
  const r = layer.repeat;
  if (!r) return drawLayerContent(ctx, layer);
  const { cx, cy, W, H, list } = repeatOffsets(layer);
  const aim = aimOf(r, cx, cy, list), far = Math.max(1, Math.hypot(aim.b.x - aim.a.x, aim.b.y - aim.a.y));
  const ns = isRegionLayer(layer) ? 1 + r.shapes.length : 1;
  const looks = new Map();
  const look = (c, s) => {
    const key = c * 8 + s;
    if (!looks.has(key)) looks.set(key, lookOf(layer, c ? r.colors[c - 1] : null, s ? r.shapes[s - 1] : null, cx, cy, Math.max(W, H)));
    return looks.get(key);
  };
  const alpha = ctx.globalAlpha, from = layer.carry && layer.carry.from; // carried from one panel: only the copies on it
  list.forEach((o, k) => {
    if (from && !contains(from, cx + o.x, cy + o.y)) return;
    const { c, s, roll } = copyLook(r, k, ns);
    if (layer.only && !layer.only.has(c)) return; // the finish map stamps each colour's copies with that colour's finish
    let size = 1, turn = 0;
    if (k && r.rSize) size += (roll() * 2 - 1) * 0.75 * r.rSize / 100;
    if (k && r.rTurn) turn = (roll() * 2 - 1) * Math.PI * r.rTurn / 100 * (r.mirrorX !== r.mirrorY ? -1 : 1); // a mirror image turns each the other way
    const t = Math.min(1, Math.hypot(cx + o.x - aim.a.x, cy + o.y - aim.a.y) / far); // 0 at the aim's start, 1 at its end and beyond
    if (r.shrink) size *= 1 - t;
    const a = r.fadeOut ? 1 - t : 1;
    if (size <= 0.01 || a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha * a;
    ctx.translate(cx + o.x, cy + o.y);
    if (turn) ctx.rotate(turn);
    if (size !== 1) ctx.scale(size, size);
    ctx.translate(-cx, -cy);
    drawLayerContent(ctx, look(c, s));
    ctx.restore();
  });
}

// ---------- compositing ----------

const paintCanvas = document.createElement('canvas');
paintCanvas.width = paintCanvas.height = SIZE;
const specCanvas = document.createElement('canvas');
specCanvas.width = specCanvas.height = SIZE;
const scratch = document.createElement('canvas');
scratch.width = scratch.height = SIZE;
// The paint sheet and the scratch are read back many times for one picture
// (the linear-light mix reads both for every layer). Told so up front, the
// browser keeps them where reading is cheap, instead of fetching each read
// from the graphics card. The first getContext call settles it for good.
paintCanvas.getContext('2d', { willReadFrequently: true });
scratch.getContext('2d', { willReadFrequently: true });
specCanvas.getContext('2d', { willReadFrequently: true });
// the shadow's own buffer: drawLayer is itself called with `scratch` as the target
const fxScratch = document.createElement('canvas');
fxScratch.width = fxScratch.height = SIZE;

// the layer's own pixels, without opacity, trim or shadow
function drawLayerContent(ctx, layer) {
  if (layer.carPaint) { // a car gradient: on each panel with a car line, the strip's colours along that line (mirror.js withCarLines)
    const stops = carStops(layer.car.blocks);
    for (const { clip, p0, p1 } of layer.carPaint) {
      ctx.save();
      ctx.beginPath();
      for (const poly of clip) poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.clip();
      const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      for (const s of stops) g.addColorStop(s.at, s.color);
      ctx.fillStyle = stops.length ? g : 'transparent';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();
    }
    return;
  }
  if (layer.type === 'fill') {
    const rx = layer.rx ?? 0, ry = layer.ry ?? 0, rw = layer.rw ?? SIZE, rh = layer.rh ?? SIZE;
    ctx.save();
    if (layer.flipH || layer.flipV) {
      // flip the shape and its gradient within the layer's own rect, so a
      // mirrored triangle or stripe really is a mirror image
      ctx.translate(rx + rw / 2, ry + rh / 2);
      ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
      ctx.translate(-(rx + rw / 2), -(ry + rh / 2));
    }
    ctx.fillStyle = fillPaintStyle(ctx, layer, rx, ry, rw, rh);
    const outline = fillShapePath(layer.shape, rx, ry, rw, rh, layer.pts);
    ctx.fill(outline);
    ctx.restore();
  } else {
    ctx.save();
    const m = layerMatrix(layer);
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(layer.img, -layer.img.width / 2, -layer.img.height / 2);
    ctx.restore();
  }
}

// A layer's trim as a list of windows, each a list of { x, y }
export const clipPolys = (layer) => (Array.isArray(layer.clip) ? layer.clip.filter(p => Array.isArray(p) && p.length >= 3) : []);

export function drawLayer(ctx, layer, forSpec = false) {
  // a shadow is for text and pictures, and for the paint only: it is not part of the design's own outline
  const fx = layer.fx;
  const doShadow = !forSpec && fx && fx.shadow > 0 && layer.img && (layer.type === 'image' || layer.type === 'text');
  ctx.save();
  // a copy carried across a seam is trimmed to the panel it is carried onto
  // (carry.clip); its own clip still lays out its scattered copies
  const k = layer.carry;
  const windows = k ? k.clip : clipPolys(layer);
  if (windows.length) {
    // trim: windows fixed on the sheet, one per piece. The layer keeps all of
    // its artwork and can still be moved or scaled underneath; only what
    // falls inside a window shows, in the paint and the spec map alike.
    ctx.beginPath();
    for (const poly of windows) {
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
    }
    ctx.clip();
  }
  if (k && k.strip) { // and to the strip beside its own stretch of the edge
    ctx.beginPath();
    k.strip.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.clip();
  }
  // carried across a seam onto another panel (mirror.js withSeams): the
  // trim above stays where it is on the sheet, the artwork goes through this
  if (k) ctx.transform(k.a, k.b, k.c, k.d, k.e, k.f);
  ctx.globalAlpha = layer.opacity;
  if (layer.blend === 'multiply' && !forSpec) ctx.globalCompositeOperation = 'multiply'; // darkens what is under it: a texture over the paint
  if (doShadow) {
    // the layer is drawn once into a buffer; drawn fully off-canvas from
    // there, only its shadow lands in view, beneath the layer itself
    const rctx = fxScratch.getContext('2d');
    rctx.clearRect(0, 0, SIZE, SIZE);
    drawCopies(rctx, layer);
    ctx.save();
    ctx.shadowColor = fx.shadowColor || '#000000';
    ctx.shadowBlur = Math.max(0, Math.min(60, fx.shadow));
    ctx.shadowOffsetX = SIZE + (fx.shadowDX ?? 8);
    ctx.shadowOffsetY = fx.shadowDY ?? 8;
    ctx.drawImage(fxScratch, -SIZE, 0);
    ctx.restore();
    ctx.drawImage(fxScratch, 0, 0);
  } else {
    drawCopies(ctx, layer);
  }
  ctx.restore();
}

// a Finish-mode area exists solely in the finish map
function inPaintMap(layer) {
  return layer.visible && !layer.specOnly;
}

// the extra colours' squares go over everything, so iRacing reads the colours set for them
function paintSwatches(ctx, doc) {
  for (const p of doc.swatches || []) { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.w, p.h); }
}

function paintBase(ctx, doc) {
  ctx.fillStyle = doc.baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const light = sparkleLight(doc.baseMaterial, doc.baseMatParams);
  if (light) { ctx.save(); ctx.globalAlpha = light.amount; ctx.drawImage(light.canvas, 0, 0); ctx.restore(); }
}

// A sparkle finish whose flecks also lighten the paint (params.bright, 0 to
// 100): → { canvas, amount } to lay over that paint, or null.
function sparkleLight(material, params) {
  const mat = MATERIALS[material];
  if (!mat || (mat.tex !== 'flake' && mat.tex !== 'glitter')) return null;
  const p = resolveParams(material, params), amount = Math.max(0, Math.min(1, (p.bright || 0) / 100));
  return amount ? { canvas: specTexture(mat.tex, p).light, amount } : null;
}
let lightScratch = null; // made when first needed: most liveries never do

// ---------- soft edges mixed in linear light ----------
// A shape's edge is smoothed by mixing its colour with what is underneath in
// the pixels the edge cuts through. Mixing the stored (sRGB) numbers, as the
// canvas does, makes that in-between colour too dark — a grey fringe between
// opposite colours such as red on cyan. Mixing the light the numbers stand
// for, then storing the result, gives the in-between colour the eye expects.
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const SRGB = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) { const l = i / 4096; SRGB[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)); }

let linearEdges = false; // on for the length of one renderPaint that asked for it

// Only shapes and text at full strength: their see-through pixels are edges.
// A picture's own transparency, and a layer faded with Opacity, keep the
// ordinary mix people expect from every other paint program.
// (A picture made by merging such layers says so with linearMix, so that it
// keeps the look its parts had.)
function edgesInLinear(layer) {
  return (layer.type === 'fill' || layer.type === 'text' || layer.linearMix) && (layer.opacity ?? 1) === 1 && !layer.blend;
}

// where a layer can leave pixels, as whole-pixel bounds inside the sheet
function paintBox(layer) {
  let x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE;
  const fx = layer.fx;
  if (!(fx && fx.shadow > 0) && !layer.repeat) { // a shadow, or copies, fall outside the layer's own box
    try {
      const k = layer.carry;
      const cs = layerCorners(layer).map(q => (k ? { x: k.a * q.x + k.c * q.y + k.e, y: k.b * q.x + k.d * q.y + k.f } : q));
      const xs = cs.map(q => q.x), ys = cs.map(q => q.y);
      x0 = Math.max(0, Math.floor(Math.min(...xs)) - 3); y0 = Math.max(0, Math.floor(Math.min(...ys)) - 3);
      x1 = Math.min(SIZE, Math.ceil(Math.max(...xs)) + 3); y1 = Math.min(SIZE, Math.ceil(Math.max(...ys)) + 3);
    } catch { /* no box to be had: the whole sheet */ }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// src (the layer, alone on a clear canvas) laid over ctx within box. Solid
// pixels are copied as they are, so a chosen colour stays exact.
function mixLinearInto(ctx, src, box) {
  if (box.w <= 0 || box.h <= 0) return;
  const s = src.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data;
  const img = ctx.getImageData(box.x, box.y, box.w, box.h), d = img.data;
  let touched = false;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3];
    if (!a) continue;
    touched = true;
    if (a === 255) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 255; continue; }
    const da = d[i + 3], t = a / 255;
    if (da !== 255) {
      // onto a see-through sheet (Merge): the ordinary mix; there is no solid
      // colour underneath to mix light with
      const k = da / 255 * (1 - t), oa = t + k;
      d[i] = (s[i] * t + d[i] * k) / oa; d[i + 1] = (s[i + 1] * t + d[i + 1] * k) / oa; d[i + 2] = (s[i + 2] * t + d[i + 2] * k) / oa;
      d[i + 3] = Math.round(oa * 255);
      continue;
    }
    const u = 1 - t;
    d[i] = SRGB[(LIN[s[i]] * t + LIN[d[i]] * u) * 4096 + 0.5 | 0];
    d[i + 1] = SRGB[(LIN[s[i + 1]] * t + LIN[d[i + 1]] * u) * 4096 + 0.5 | 0];
    d[i + 2] = SRGB[(LIN[s[i + 2]] * t + LIN[d[i + 2]] * u) * 4096 + 0.5 | 0];
  }
  if (touched) ctx.putImageData(img, box.x, box.y);
}

// a layer onto the sheet, with its sparkle's lighter flecks over it
function paintLayerInto(ctx, layer) {
  paintLayerPaint(ctx, layer);
  const light = sparkleLight(layer.material, layer.matParams);
  if (!light) return;
  // the flecks, only where the layer is: its own pixels say where
  if (!lightScratch) { lightScratch = document.createElement('canvas'); lightScratch.width = lightScratch.height = SIZE; }
  const sctx = lightScratch.getContext('2d');
  sctx.clearRect(0, 0, SIZE, SIZE);
  drawLayer(sctx, layer, false);
  sctx.save();
  sctx.globalCompositeOperation = 'source-in';
  sctx.globalAlpha = light.amount;
  sctx.drawImage(light.canvas, 0, 0);
  sctx.restore();
  ctx.drawImage(lightScratch, 0, 0);
}
function paintLayerPaint(ctx, layer) {
  if (linearEdges && edgesInLinear(layer)) {
    const sctx = scratch.getContext('2d');
    sctx.clearRect(0, 0, SIZE, SIZE);
    drawLayer(sctx, layer, false);
    mixLinearInto(ctx, scratch, paintBox(layer));
    return;
  }
  drawLayer(ctx, layer, false);
}

// The given layers painted in stack order over a transparent sheet, exactly
// as they appear in the paint (tint, opacity, effects and trim included) —
// what Merge bakes into one image. Material-only layers paint nothing.
export function paintLayers(layers, { linearEdges: lin = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  linearEdges = lin; // where one of them lies over another, as in renderPaint
  try {
    for (const l of layers) if (inPaintMap(l)) paintLayerInto(ctx, l);
  } finally { linearEdges = false; }
  return c;
}

// linearEdges: mix the soft edges of shapes and text in linear light (see
// mixLinearInto). Truer, and a good deal slower, so a caller asks for it —
// for what goes to the car, and for the screen once an edit has settled.
export function renderPaint(doc, { linearEdges: lin = false } = {}) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  paintBase(ctx, doc);
  linearEdges = lin;
  try {
    for (const layer of doc.layers) {
      if (inPaintMap(layer)) paintLayerInto(ctx, layer);
    }
  } finally { linearEdges = false; }
  paintSwatches(ctx, doc);
  return paintCanvas;
}

// ---------- drag composite cache ----------
// While layers are being dragged, everything beneath and above them is
// static. buildDragCache pre-renders those two slabs once; renderPaintWithDrag
// then draws slab → moving layers → slab per frame instead of recompositing
// the whole stack. Returns null (caller falls back to renderPaint) when the
// moving layers aren't a contiguous run of the paint-visible stack.

const dragBelow = document.createElement('canvas');
dragBelow.width = dragBelow.height = SIZE;
const dragAbove = document.createElement('canvas');
dragAbove.width = dragAbove.height = SIZE;
dragBelow.getContext('2d', { willReadFrequently: true }); // (they are mixed into by the same reads)
dragAbove.getContext('2d', { willReadFrequently: true });

export function buildDragCache(doc, movingIds) {
  const idxs = [];
  doc.layers.forEach((l, i) => { if (movingIds.has(l.id)) idxs.push(i); });
  if (!idxs.length) return null;
  const lo = idxs[0], hi = idxs[idxs.length - 1];
  for (let i = lo; i <= hi; i++) {
    const l = doc.layers[i];
    if (!movingIds.has(l.id) && inPaintMap(l)) return null; // static layer interleaved
  }

  const bctx = dragBelow.getContext('2d');
  bctx.clearRect(0, 0, SIZE, SIZE);
  paintBase(bctx, doc);
  for (let i = 0; i < lo; i++) {
    if (inPaintMap(doc.layers[i])) paintLayerInto(bctx, doc.layers[i]);
  }
  const actx = dragAbove.getContext('2d');
  actx.clearRect(0, 0, SIZE, SIZE);
  for (let i = hi + 1; i < doc.layers.length; i++) {
    if (doc.layers[i].blend) return null; // a blend above needs what is under it: no shortcut
    if (inPaintMap(doc.layers[i])) paintLayerInto(actx, doc.layers[i]);
  }
  paintSwatches(actx, doc);
  return { movingIds };
}

export function renderPaintWithDrag(doc, cache) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(dragBelow, 0, 0);
  for (const layer of doc.layers) {
    if (cache.movingIds.has(layer.id) && inPaintMap(layer)) paintLayerInto(ctx, layer);
  }
  ctx.drawImage(dragAbove, 0, 0);
  return paintCanvas;
}

// a Repeat whose copies take other colours' finishes (finish.js): a stamp for
// each finish, of only the copies that have it
// ponytail: where copies of two finishes overlap, the later stamp wins, not the copy in front
function byCopyFinish(l) {
  if (!l.copyFinishes) return [l];
  const by = new Map();
  l.copyFinishes.forEach((f, c) => {
    const key = f.material + JSON.stringify(f.params);
    if (!by.has(key)) by.set(key, { ...l, material: f.material, matParams: f.params, only: new Set() });
    by.get(key).only.add(c);
  });
  return [...by.values()];
}
export function renderSpec(doc) {
  const ctx = specCanvas.getContext('2d');
  const base = MATERIALS[doc.baseMaterial] || MATERIALS.gloss;
  const baseP = resolveParams(doc.baseMaterial, doc.baseMatParams);
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (base.tex) {
    ctx.drawImage(specTexture(base.tex, baseP), 0, 0);
  } else {
    ctx.fillStyle = `rgb(${baseP.met},${baseP.rough},${baseP.clear})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // Layers are stamped in runs: neighbours in the stack that carry the very
  // same finish go down as one silhouette, filled once. A livery of many
  // shapes (every panel filled) is mostly one finish, so
  // it is a few stamps instead of one for each layer. Stamping the same
  // finish twice where shapes overlap gives the same result as stamping their
  // joined silhouette once, so nothing changes in what is made. Each stamp
  // touches only the box its layers lie in.
  const sctx = scratch.getContext('2d');
  sctx.clearRect(0, 0, SIZE, SIZE);
  const stamped = doc.layers.filter(l => l.visible).flatMap(byCopyFinish);
  const finishKey = (l) => (l.material || 'gloss') + '|' + JSON.stringify(l.matParams || null);
  for (let i = 0; i < stamped.length;) {
    const layer = stamped[i], key = finishKey(layer);
    let j = i + 1;
    while (j < stamped.length && finishKey(stamped[j]) === key) j++;
    const run = stamped.slice(i, j);
    i = j;
    const mat = MATERIALS[layer.material] || MATERIALS.gloss;
    const p = resolveParams(layer.material, layer.matParams);
    // the box round the run
    let x0 = SIZE, y0 = SIZE, x1 = 0, y1 = 0;
    for (const l of run) { const bx = paintBox(l); x0 = Math.min(x0, bx.x); y0 = Math.min(y0, bx.y); x1 = Math.max(x1, bx.x + bx.w); y1 = Math.max(y1, bx.y + bx.h); }
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    // paint the silhouettes, then fill them with the material —
    // flat channel values, or a procedural micro-texture for tex materials
    for (const l of run) drawLayer(sctx, l, true); // silhouette pass: no shadow
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    // only inside the box: outside it there is nothing of this run to fill
    sctx.beginPath(); sctx.rect(x0, y0, w, h); sctx.clip();
    if (mat.tex) {
      sctx.drawImage(specTexture(mat.tex, p), 0, 0);
    } else {
      sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
      sctx.fillRect(x0, y0, w, h);
    }
    sctx.restore();
    ctx.drawImage(scratch, x0, y0, w, h, x0, y0, w, h);
    sctx.clearRect(x0, y0, w, h); // left clean for the next run
  }
  return specCanvas;
}

// ---------- hit testing ----------

export function toLocal(layer, px, py) {
  const pt = layerMatrix(layer).inverse().transformPoint(new DOMPoint(px, py));
  return { x: pt.x, y: pt.y };
}

// corner positions of a layer in doc space (for selection box / handles)
export function layerCorners(layer) {
  if (isRegionLayer(layer)) {
    const { rx = 0, ry = 0, rw = SIZE, rh = SIZE } = layer;
    return [{ x: rx, y: ry }, { x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }];
  }
  const hw = layer.img.width / 2;
  const hh = layer.img.height / 2;
  const m = layerMatrix(layer);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
    const pt = m.transformPoint(new DOMPoint(x, y));
    return { x: pt.x, y: pt.y };
  });
}

// ---------- (de)serialization ----------

export function serializeDoc(doc) {
  return {
    format: 'overspray/1',
    name: doc.name,
    target: doc.target,
    customNumber: !!doc.customNumber,
    car: doc.car || null,
    baseColor: doc.baseColor,
    baseMaterial: doc.baseMaterial,
    baseMatParams: doc.baseMatParams || null,
    template: doc.template ? doc.template.src : null,
    customFonts: (doc.customFonts || []).map(f => ({ name: f.name, data: f.data })),
    regionMap: doc.regionMap || null,
    palette: cleanPalette(doc.palette),
    baseRef: doc.baseRef || null,
    swatches: doc.swatches || [],
    googleFonts: (doc.googleFonts || []).filter(f => typeof f === 'string' && f).slice(0, 60),
    finishRules: cleanFinishRules(doc.finishRules),
    groups: (doc.groups || []).map(g => ({ id: g.id, name: g.name, collapsed: !!g.collapsed, ...(g.turn ? { turn: g.turn } : {}) })),
    layers: doc.layers.map(l => ({
      id: l.id, type: l.type, name: l.name,
      groupId: l.groupId || null,
      visible: l.visible, locked: !!l.locked, opacity: l.opacity, blend: l.blend || null, material: l.material,
      matParams: l.matParams || null,
      specOnly: !!l.specOnly,
      fx: l.fx || null,
      color: l.color,
      shape: l.shape, fillType: l.fillType, color2: l.color2, gradAngle: l.gradAngle,
      colorRef: l.colorRef || undefined,
      // painted on its twin panel (or across its centreline) as well; the
      // mirror image is worked out when painting, see mirror.js withMirrors
      mirrored: l.mirrored ? true : undefined,
      // text and pictures keep reading the right way on the other side unless
      // this asks for a true mirror image
      mirrorFlip: l.mirrorFlip ? true : undefined,
      // what hangs over a linked edge of its panel is painted on the panel
      // that edge meets, see mirror.js withSeams
      continues: l.continues || undefined, // the id of the panel it belongs to
      // its finish was chosen for this layer itself, so it does not follow a
      // colour's finish rule (see finish.js)
      finishOwn: l.finishOwn ? true : undefined,
      credits: Array.isArray(l.credits) && l.credits.length ? l.credits : undefined, // see cleanCredits
      repeat: l.repeat || undefined, // copies in a line or a grid, see repeatOffsets
      linearMix: l.linearMix ? true : undefined, // a merged picture whose soft pixels mix as its parts' did
      pts: Array.isArray(l.pts) ? l.pts.map((q) => { const o = { x: q.x, y: q.y }; if (q.c) o.c = { x: q.c.x, y: q.c.y }; if (q.m) o.m = true; return o; }) : undefined,
      turn: l.type === 'fill' && l.turn ? l.turn : undefined, // the angle a shape's frame stands at, in degrees
      fadeFrom: l.fadeFrom ? { x: l.fadeFrom.x, y: l.fadeFrom.y } : undefined,
      fadeTo: l.fadeTo ? { x: l.fadeTo.x, y: l.fadeTo.y } : undefined,
      fadeStyle: l.fadeStyle === 'radial' || l.fadeStyle === 'linear' ? l.fadeStyle : undefined,
      colorMid: l.colorMid ?? null, midPos: l.midPos ?? 0.5,
      stops: Array.isArray(l.stops) && l.stops.length ? l.stops.map(o => ({ color: o.color, at: o.at })) : undefined,
      car: l.car ? cleanCar(l.car) : undefined, // a car gradient, see carStops
      src: l.src,
      text: l.text, font: l.font, fontSize: l.fontSize,
      textColor: l.textColor, outlineColor: l.outlineColor, outlineWidth: l.outlineWidth,
      italic: l.italic, letterSpacing: l.letterSpacing,
      fontWeight: l.fontWeight || undefined, lineSpacing: l.lineSpacing || undefined, align: l.align || undefined,
      curve: l.curve || 0,
      x: l.x, y: l.y, scale: l.scale, scaleY: l.scaleY ?? null, rotation: l.rotation,
      flipH: l.flipH, flipV: l.flipV,
      rx: l.rx, ry: l.ry, rw: l.rw, rh: l.rh,
      // trim window (see drawLayer), absolute doc space
      clip: clipPolys(l).length ? clipPolys(l).map(p => p.map(q => ({ x: q.x, y: q.y }))) : null,
      // the spot picked in each window: says which region (and half) it is
      clipAt: [].concat(l.clipAt || []).map(q => ({ x: q.x, y: q.y })),
    })),
  };
}

// finish rules, cleaned: a 6-digit hex and a material the engine knows
export function cleanFinishRules(rules) {
  if (!Array.isArray(rules)) return [];
  const seen = new Set();
  return rules
    .filter(r => r && /^#[0-9a-f]{6}$/i.test(r.color || '') && MATERIALS[r.material])
    .map(r => {
      const out = { color: r.color.toLowerCase(), material: r.material };
      // the finish's own numbers, when it has been tweaked or carries sparkle
      const p = {};
      for (const k of ['met', 'rough', 'clear', 'density', 'scale', 'contrast', 'bright']) if (r.params && Number.isFinite(r.params[k])) p[k] = r.params[k];
      if (Object.keys(p).length) out.params = p;
      return out;
    })
    .filter(r => !seen.has(r.color) && seen.add(r.color));
}

// the livery's saved colours, cleaned: { id, name, color } with a 6-digit hex
export function cleanPalette(palette) {
  if (!Array.isArray(palette)) return [];
  return palette
    .filter(c => c && typeof c.id === 'string' && /^#[0-9a-f]{6}$/i.test(c.color || ''))
    .map(c => ({ id: c.id, name: String(c.name || 'Colour').slice(0, 40), color: c.color.toLowerCase(), ...(typeof c.from === 'string' ? { from: c.from.slice(0, 40) } : {}) })); // from: the palette that added it
}

// A palette file, read: one palette { name, colors: [{ name, color }], fonts? },
// a list of them, or just a list of colours ('#ff0000' or { name, color }).
// fonts: { google: [names], custom: [{ name, data (base64) }] }, left out when none.
// → the palettes in it that have a colour or a font, each colour a 6-digit hex.
// `fallback`: the name for one that has none, such as the file's name.
export function readPalettes(data, fallback = 'Palette') {
  const hex = (v) => (typeof v === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? '#' + v.trim().replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3').toLowerCase() : null);
  const colours = (list) => (Array.isArray(list) ? list : [])
    .map((c, k) => ({ name: String((c && c.name) || 'Colour ' + (k + 1)).slice(0, 40), color: hex(typeof c === 'string' ? c : c && c.color) }))
    .filter((c) => c.color);
  const list2 = (v) => (Array.isArray(v) ? v : []);
  const fonts = (f) => ({
    google: [...new Set(list2(f && f.google).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)))],
    custom: list2(f && f.custom).filter((x) => x && typeof x.name === 'string' && x.name && typeof x.data === 'string' && x.data).map((x) => ({ name: x.name.slice(0, 60), data: x.data })),
  });
  const one = (p, k) => {
    const out = { name: String(p.name || (k ? fallback + ' ' + (k + 1) : fallback)).slice(0, 40), colors: colours(p.colors) }, f = fonts(p.fonts);
    return f.google.length || f.custom.length ? { ...out, fonts: f } : out;
  };
  const list = Array.isArray(data) ? (data.some((x) => x && Array.isArray(x.colors)) ? data : [{ colors: data }])
    : data && Array.isArray(data.palettes) ? data.palettes : data ? [data] : [];
  return list.filter((p) => p && typeof p === 'object').map(one).filter((p) => p.colors.length || p.fonts);
}

// a saved 'path' outline, cleaned: finite points only, and none if too few
function shapePts(pts) {
  if (!Array.isArray(pts)) return null;
  const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
  const out = pts.filter(ok).map((q) => { const o = { x: q.x, y: q.y }; if (ok(q.c)) o.c = { x: q.c.x, y: q.c.y }; if (q.m) o.m = true; return o; });
  if (out.length) delete out[0].m;
  return out.length >= 3 ? out : null;
}

// A picture already loaded is handed back, not decoded again: every undo and
// redo reloads the whole livery, and its template alone is 16 MB decoded, with
// more made from it (the line overlays are kept by which picture they came
// from). The last 60 different pictures are kept.
const imageCache = new Map(); // src → promise of its image, oldest first
export function loadImage(src) {
  const had = imageCache.get(src);
  if (had) { imageCache.delete(src); imageCache.set(src, had); return had; } // used again: it moves to the newest end
  const made = decodeImage(src);
  imageCache.set(src, made);
  made.catch(() => imageCache.delete(src));
  if (imageCache.size > 60) imageCache.delete(imageCache.keys().next().value);
  return made;
}
function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Remote artwork must be fetched with CORS or the paint canvas becomes
    // tainted and every export (getImageData/toBlob) throws. Same-origin,
    // blob: and data: sources are unaffected by the attribute.
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

// restore a saved fx block, coercing missing sub-fields to the UI defaults
function normalizeFx(fx) {
  if (!fx || typeof fx !== 'object') return null;
  return { shadow: fx.shadow ?? 0, shadowDX: fx.shadowDX ?? 8, shadowDY: fx.shadowDY ?? 8, shadowColor: fx.shadowColor || '#000000' };
}

export async function deserializeDoc(data) {
  const doc = createDoc();
  doc.name = data.name || doc.name;
  doc.target = ['car', 'helmet', 'suit'].includes(data.target) ? data.target : 'car';
  doc.customNumber = !!data.customNumber;
  doc.car = typeof data.car === 'string' && data.car ? data.car : null;
  doc.baseColor = data.baseColor || doc.baseColor;
  doc.baseMaterial = data.baseMaterial || doc.baseMaterial;
  doc.baseMatParams = data.baseMatParams || null;
  if (data.template) {
    try {
      doc.template = { img: await loadImage(data.template), src: data.template };
    } catch { /* template image failed — drop it */ }
  }
  if (data.regionMap) {
    try {
      doc.regionMap = parseRegionMap(data.regionMap);
    } catch { /* bad region map — drop it */ }
  }
  doc.palette = cleanPalette(data.palette);
  doc.finishRules = cleanFinishRules(data.finishRules);
  doc.googleFonts = Array.isArray(data.googleFonts) ? data.googleFonts.filter(f => typeof f === 'string' && f).slice(0, 60) : [];
  doc.baseRef = doc.palette.some(c => c.id === data.baseRef) ? data.baseRef : null;
  const n = (v) => Math.max(0, Math.min(SIZE, Math.round(+v) || 0));
  const sw = data.swatches || data.pitbox; // (saved as pitbox before the cockpit colour came)
  doc.swatches = (Array.isArray(sw) ? sw : []).slice(0, 8)
    .filter(p => p && /^#[0-9a-f]{6}$/i.test(p.color))
    .map((p, i, all) => ({ name: typeof p.name === 'string' && p.name ? p.name.slice(0, 40) : all.length > 1 ? `Pit box ${i + 1}` : 'Pit box', x: n(p.x), y: n(p.y), w: n(p.w), h: n(p.h), color: p.color, ref: doc.palette.some(c => c.id === p.ref) ? p.ref : null }));
  // custom fonts must be live before text layers regenerate below
  doc.fontWarnings = [];
  for (const f of (data.customFonts || [])) {
    if (!f || !f.name || !f.data) continue;
    doc.customFonts.push({ name: f.name, data: f.data }); // keep the data even if it fails — don't lose it on resave
    try {
      await registerCustomFont(f.name, f.data);
    } catch {
      doc.fontWarnings.push(f.name); // bad font — its text falls back to a default face
    }
  }
  for (const l of (data.layers || [])) {
    try {
      if (l.type === 'fill') {
        doc.layers.push({
          ...createFillLayer(l.color || '#e8e6e1'),
          id: l.id || newId(), name: l.name || 'fill',
          visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1, blend: l.blend === 'multiply' ? 'multiply' : null,
          material: l.material || 'gloss',
          matParams: l.matParams || null,
          specOnly: !!l.specOnly,
          shape: l.shape || 'rect',
          pts: shapePts(l.pts),
          turn: Number.isFinite(l.turn) ? l.turn : 0,
          colorRef: typeof l.colorRef === 'string' ? l.colorRef : null,
          fillType: l.fillType || 'solid',
          color2: l.color2 || '#101114',
          colorMid: l.colorMid || null,
          midPos: l.midPos ?? 0.5,
          stops: Array.isArray(l.stops) ? l.stops.filter(o => o && typeof o.color === 'string' && Number.isFinite(o.at)).slice(0, 8).map(o => ({ color: o.color, at: o.at })) : [],
          gradAngle: l.gradAngle ?? 0,
          car: cleanCar(l.car),
          rx: l.rx ?? 0, ry: l.ry ?? 0, rw: l.rw ?? SIZE, rh: l.rh ?? SIZE,
          flipH: !!l.flipH, flipV: !!l.flipV, // a ready-made shape separated from its mirror is flipped: it stays so
        });
        continue;
      }
      if (l.type === 'text') {
        const layer = {
          id: l.id || newId(), type: 'text', name: l.name || 'text',
          visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1, blend: l.blend === 'multiply' ? 'multiply' : null,
          material: l.material || 'gloss',
          matParams: l.matParams || null,
          specOnly: !!l.specOnly,
          img: null, src: l.src || null,
          text: l.text ?? 'TEXT', font: l.font || 'Arial Black',
          fontSize: l.fontSize ?? 160,
          textColor: l.textColor || '#ffffff',
          outlineColor: l.outlineColor || '#000000',
          outlineWidth: l.outlineWidth ?? 0,
          italic: !!l.italic, letterSpacing: l.letterSpacing ?? 0,
          fontWeight: Number.isFinite(l.fontWeight) ? l.fontWeight : null, lineSpacing: Number.isFinite(l.lineSpacing) ? l.lineSpacing : null,
          align: l.align === 'left' || l.align === 'right' ? l.align : null,
          curve: l.curve ?? 0,
          fx: normalizeFx(l.fx),
          x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
          scale: l.scale ?? 1, scaleY: Number.isFinite(l.scaleY) ? l.scaleY : null,
          rotation: l.rotation ?? 0,
          flipH: !!l.flipH, flipV: !!l.flipV,
        };
        try {
          regenerateText(layer);
          doc.layers.push(layer);
          continue;
        } catch { /* regeneration failed — fall through to the saved raster */ }
      }
      if (l.type !== 'image') continue; // a kind of layer this app does not make (one from the original screen): left out
      const img = await loadImage(l.src);
      doc.layers.push({
        id: l.id || newId(),
        type: 'image',
        name: l.name || 'image',
        visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1, blend: l.blend === 'multiply' ? 'multiply' : null,
        material: l.material || 'gloss',
        matParams: l.matParams || null,
        specOnly: !!l.specOnly,
        fx: normalizeFx(l.fx),
        img, src: l.src,
        x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
        scale: l.scale ?? 1, scaleY: Number.isFinite(l.scaleY) ? l.scaleY : null,
        rotation: l.rotation ?? 0,
        flipH: !!l.flipH, flipV: !!l.flipV,
      });
    } catch { /* skip broken layer */ }
  }
  // trim windows apply to every layer type, so they are restored in one place
  const loaded = new Map(doc.layers.map(l => [l.id, l]));
  for (const l of (data.layers || [])) {
    if (!l || !loaded.has(l.id)) continue;
    if (l.mirrored) loaded.get(l.id).mirrored = true; // any layer type, like the trim
    if (l.mirrorFlip) loaded.get(l.id).mirrorFlip = true;
    if (typeof l.continues === 'string') loaded.get(l.id).continues = l.continues;
    if (l.finishOwn) loaded.get(l.id).finishOwn = true;
    if (l.linearMix) loaded.get(l.id).linearMix = true;
    const at = (q) => (q && Number.isFinite(q.x) && Number.isFinite(q.y) ? { x: q.x, y: q.y } : null);
    if (at(l.fadeFrom) && at(l.fadeTo)) { loaded.get(l.id).fadeFrom = at(l.fadeFrom); loaded.get(l.id).fadeTo = at(l.fadeTo); }
    if (l.fadeStyle === 'radial' || l.fadeStyle === 'linear') loaded.get(l.id).fadeStyle = l.fadeStyle;
    if (typeof l.colorRef === 'string' && l.type !== 'fill') loaded.get(l.id).colorRef = l.colorRef; // text follows a saved colour too
    if (l.type === 'image' && /^#[0-9a-f]{6}$/i.test(l.color || '')) loaded.get(l.id).color = l.color; // a picture painted in one colour
    const credits = cleanCredits(l.credits);
    if (credits.length) loaded.get(l.id).credits = credits;
    const repeat = cleanRepeat(l.repeat);
    if (repeat) loaded.get(l.id).repeat = repeat;
    // (a pattern from before Repeat, l.motif, is left out: the shape loads plain)
    const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    const clip = clipPolys(l).map(p => p.filter(ok).map(q => ({ x: q.x, y: q.y }))).filter(p => p.length >= 3);
    if (!clip.length) continue;
    loaded.get(l.id).clip = clip;
    loaded.get(l.id).clipAt = [].concat(l.clipAt || []).filter(ok).map(q => ({ x: q.x, y: q.y }));
  }
  // groups are restored after the layers so broken/skipped layers can't leave
  // a group pointing at nothing: re-attach by id, then keep only groups that
  // still have members
  const savedGroupOf = new Map();
  for (const l of (data.layers || [])) {
    if (l && l.id && typeof l.groupId === 'string' && l.groupId) savedGroupOf.set(l.id, l.groupId);
  }
  const declared = new Set();
  const groups = [];
  for (const g of (Array.isArray(data.groups) ? data.groups : [])) {
    if (!g || typeof g.id !== 'string' || !g.id || declared.has(g.id)) continue;
    declared.add(g.id);
    groups.push({ id: g.id, name: typeof g.name === 'string' && g.name ? g.name : 'Group', collapsed: !!g.collapsed, ...(Number.isFinite(g.turn) && g.turn ? { turn: g.turn } : {}) });
  }
  const used = new Set();
  for (const l of doc.layers) {
    const gid = savedGroupOf.get(l.id);
    if (gid && declared.has(gid)) { l.groupId = gid; used.add(gid); }
    else l.groupId = null;
  }
  doc.groups = groups.filter(g => used.has(g.id));
  return doc;
}
