// Overspray's engine: the livery document, painting it, and its spec map.

import { parseRegionMap } from './regions.js';
import { SHAPES, placed, flatten, contains } from './shapes.js';

export const SIZE = 2048; // iRacing paints are 2048 px square

// Finishes as iRacing's spec map stores them: red says how metallic, green how
// rough, blue how much clearcoat (iRacing's own docs: keep blue at 255 unless
// less clearcoat is meant). These are where each finish starts; a layer's
// matParams can change any of its numbers. A finish with tex has a sparkle
// pattern in it (see sparklePattern), with knobs of its own.
export const MATERIALS = {
  gloss:    { label: 'Gloss',    met: 0,   rough: 40,  clear: 255 },
  matte:    { label: 'Matte',    met: 0,   rough: 230, clear: 60  },
  satin:    { label: 'Satin',    met: 0,   rough: 120, clear: 150 },
  metallic: { label: 'Metallic', met: 180, rough: 70,  clear: 255 },
  chrome:   { label: 'Chrome',   met: 255, rough: 10,  clear: 255 },
  pearl:    { label: 'Pearl',    met: 190, rough: 60,  clear: 255 },
  flake:    { label: 'Flake',    met: 160, rough: 45,  clear: 255, tex: 'flake', density: 18, contrast: 100 },
  glitter:  { label: 'Glitter',  met: 170, rough: 60,  clear: 255, tex: 'glitter', density: 30, scale: 4, contrast: 100 },
};
const SPARKLE_KNOBS = ['density', 'scale', 'contrast'];

// a finish's numbers, as a new object a layer can change
export function defaultParams(key) {
  const finish = MATERIALS[key] ?? MATERIALS.gloss;
  const own = { met: finish.met, rough: finish.rough, clear: finish.clear };
  SPARKLE_KNOBS.filter(k => k in finish).forEach(k => { own[k] = finish[k]; });
  return own;
}

// a finish's numbers with a layer's own changes over them
export const resolveParams = (key, own) => ({ ...defaultParams(key), ...own });

// ---------- sparkle ----------

// Mulberry32, a small public-domain random number generator: from the same
// seed it gives the same numbers every time, so a sparkle comes out the same
// in every export.
const SEED = 0xC0FFEE;
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v) => Math.min(255, Math.max(0, v));
// Sparkle is one pattern for the whole livery (finish.js oneSparkle): each
// pixel says how far a fleck there pushes the finish under it toward full
// metal (a), how much it cuts the roughness (b) and adds back (n). Kept apart
// from the finish's own three numbers, the one pattern serves every finish it
// lies over: 12 MB, made again only when the sparkle itself changes.
let sparkle = null; // { key, a, b, n, light }
// Glitter: square chips a few pixels wide, laid at random. Each flashes metal
// by an amount of its own and adds roughness of its own, so the chips catch
// the light at different angles, as tumbling glitter does.
// each(x, y, side, flash, roughness added), in the order they are laid
function glitterChips(p, each) {
  const rand = mulberry32(SEED);
  const strength = (p.contrast ?? 100) / 100;
  const side = Math.max(2, Math.round(p.scale ?? 4));
  const cover = Math.max(1, Math.min(80, p.density ?? 30)) / 100; // of the sheet, were the chips laid edge to edge
  const count = Math.round(SIZE * SIZE * cover / (side * side));
  for (let c = 0; c < count; c++) {
    const x = Math.floor(rand() * SIZE), y = Math.floor(rand() * SIZE);
    const flash = rand() * strength;
    const n = Math.round(rand() * 30);
    each(x, y, Math.max(1, Math.round(side * (0.7 + rand() * 0.6))), flash, n);
  }
}
function sparklePattern(kind, p) {
  const key = `${kind}|${p.scale || 0}|${p.density || 0}|${p.contrast ?? 100}`;
  if (sparkle && sparkle.key === key) return sparkle;
  sparkle = null; // the old one goes before the new one is made
  const N = SIZE * SIZE, a = new Uint8Array(N), b = new Uint8Array(N).fill(255), n = new Uint8Array(N);
  if (kind === 'flake') {
    // Flake: single pixels at random, pushed toward full metal and smoothed
    const rand = mulberry32(SEED), strength = (p.contrast ?? 100) / 100;
    const share = Math.max(0.01, (p.density ?? 18) / 100), cut = 1 - share; // of the pixels
    for (let i = 0; i < N; i++) {
      const r = rand();
      const s = r > cut ? (r - cut) / share * strength : 0;
      a[i] = Math.round(255 * s);
      b[i] = Math.round(255 * (1 - 0.85 * s));
    }
  } else {
    glitterChips(p, (x, y, s, flash, cn) => {
      const ca = Math.round(255 * (0.4 + 0.6 * flash)), cb = Math.round(255 * (1 - 0.9 * flash));
      for (let yy = y; yy < Math.min(SIZE, y + s); yy++) for (let xx = x; xx < Math.min(SIZE, x + s); xx++) {
        const i = yy * SIZE + xx; a[i] = ca; b[i] = cb; n[i] = cn;
      }
    });
  }
  sparkle = { key, a, b, n, light: null };
  return sparkle;
}
// The sparkle over a finish of these three numbers, written into the pixels of
// ctx's box (x, y, w, h: sheet coordinates from ctx's own 0, 0) that are not
// see-through; those keep their alpha.
export function paintSparkle(ctx, kind, p, x, y, w, h) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(SIZE, Math.ceil(x + w), ctx.canvas.width) - x; h = Math.min(SIZE, Math.ceil(y + h), ctx.canvas.height) - y;
  if (w <= 0 || h <= 0) return;
  const { a, b, n } = sparklePattern(kind, p), img = ctx.getImageData(x, y, w, h), d = img.data;
  for (let j = 0; j < h; j++) for (let i = 0, o = (j * w) * 4, q = (y + j) * SIZE + x; i < w; i++, o += 4, q++) {
    if (!d[o + 3]) continue;
    d[o] = p.met + (255 - p.met) * a[q] / 255;
    d[o + 1] = clamp255(p.rough * b[q] / 255 + n[q]);
    d[o + 2] = p.clear;
  }
  ctx.putImageData(img, x, y);
}
// How much each fleck lightens the paint under it at full Brightness (0 to
// 255 a pixel): a fleck reads bright even with nothing to mirror. A fleck of
// full mirror metal with nothing bright to reflect is otherwise a dark speck.
// Flake's are its metal amounts; glitter's chips add up where they overlap.
// Made only for a sparkle with Brightness.
export function sparkleLights(kind, p) {
  const pat = sparklePattern(kind, p);
  if (kind !== 'glitter') return pat.a;
  if (!pat.light) {
    const l = new Uint8Array(SIZE * SIZE);
    glitterChips(p, (x, y, s, flash) => {
      const t = 1 - Math.round(255 * (0.4 + 0.6 * flash)) / 255;
      for (let yy = y; yy < Math.min(SIZE, y + s); yy++) for (let xx = x; xx < Math.min(SIZE, x + s); xx++) {
        const i = yy * SIZE + xx; l[i] = Math.round(255 - (255 - l[i]) * t);
      }
    });
    pat.light = l;
  }
  return pat.light;
}

// ---------- the document ----------

let idCount = 0;
// a layer id no other has: L<count>-<the time in base 36>
export const newId = () => `L${++idCount}-${Date.now().toString(36)}`;

export function createDoc() {
  return {
    name: 'untitled livery',
    target: 'car',              // what it paints: 'car', 'helmet' or 'suit'
    customNumber: false,        // a Custom Number paint: exported as car_num_<id>.tga
    car: null,                  // the car's folder inside the iRacing paints folder
    baseColor: '#1a6cff',       // the base coat, and its finish
    baseMaterial: 'gloss',
    baseMatParams: null,
    layers: [],                 // bottom → top: shapes (fills), text and pictures
    groups: [],                 // flat layer groups: { id, name, collapsed, turn }; members carry layer.groupId; turn: the angle its box stands at, in degrees
    template: null,             // { img, src }: the car's template, shown on screen, never painted
    customFonts: [],            // fonts the user added, { name, data (base64) }, saved with the livery
    googleFonts: [],            // names of Google fonts added by name, beyond the built-in list
    finishRules: [],            // { color, material, params? }: every shape or text of that colour gets that finish (see finish.js)
    regionMap: null,            // parsed overspray-regions/1 map (see regions.js)
    palette: [],                // the livery's saved colours { id, name, color }; a layer's colorRef (or baseRef) points at one
    baseRef: null,              // palette id the base coat follows, if any
    swatches: [],               // the car's extra colours (pit box, cockpit, roll bar…) as squares from the template, and areas (pitboard, name plate) with points: { name, x, y, w, h, color, ref } (ref: palette id it follows)
  };
}

// what every new layer starts with
const layerBase = (type, name) => ({ id: newId(), type, name, visible: true, opacity: 1, material: 'gloss' });

// a picture layer in the middle of the sheet, made small enough to fit half of it
export function createImageLayer(img, src, name) {
  return {
    ...layerBase('image', name || 'image'),
    fx: null,          // a shadow, when it has one: { shadow, shadowDX, shadowDY, shadowColor }
    img, src,
    x: SIZE / 2, y: SIZE / 2,
    scale: Math.min(1, SIZE / 2 / Math.max(img.width, img.height)),
    scaleY: null,      // a height scale of its own; null: the same as scale
    rotation: 0,       // in degrees
    flipH: false, flipV: false,
  };
}

// full local→doc transform for a picture or text layer; scaleY = null means
// "follow scale"
export const layerMatrix = (l) => new DOMMatrix()
  .translate(l.x, l.y)
  .rotate(l.rotation)
  .scale(l.scale * (l.flipH ? -1 : 1), (l.scaleY ?? l.scale) * (l.flipV ? -1 : 1))
  .scale(1 / (l.img?.res || 1)); // text drawn at more pixels than its size, to stay sharp scaled up

// fonts every computer has, offered for text
export const TEXT_FONTS = ['Arial Black', 'Impact', 'Georgia', 'Courier New', 'Verdana', 'Trebuchet MS'];

// Google fonts offered for liveries, fetched the first time one is used
export const GOOGLE_FONTS = ['Anton', 'Archivo Black', 'Bebas Neue', 'Black Ops One', 'Bungee', 'Faster One',
  'Monoton', 'Orbitron', 'Oswald', 'Permanent Marker', 'Racing Sans One', 'Russo One'];

// Make a font saved with the livery (base64) usable on the page. Throws when
// the data is not a font.
export async function registerCustomFont(name, base64) {
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  document.fonts.add(await new FontFace(name, bytes.buffer).load());
}

// A text layer. Its letters are drawn into a picture (img, src), so moving,
// picking, finishes and thumbnails treat it just as they treat a picture.
export function createTextLayer() {
  const layer = {
    ...layerBase('text', 'text'),
    img: null, src: null,
    text: 'TEXT', font: 'Arial Black', fontSize: 160, italic: false, letterSpacing: 0,
    textColor: '#ffffff', outlineColor: '#000000', outlineWidth: 0,
    curve: 0,          // bent along an arc of this many degrees: 0 straight, above 0 arching up, below 0 down
    fx: null,          // a shadow, when it has one: { shadow, shadowDX, shadowDY, shadowColor }
    x: SIZE / 2, y: SIZE / 2, scale: 1, scaleY: null, rotation: 0, flipH: false, flipV: false,
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
  const within = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lines = String(layer.text ?? '').split('\n');
  const size = within(layer.fontSize || 160, 40, 400);
  const outline = within(layer.outlineWidth || 0, 0, 30);
  const gap = within(layer.letterSpacing || 0, -40, 40);
  const fontStr = textFont(layer, size);
  const lineH = size * within(layer.lineSpacing || 120, 60, 300) / 100;
  const align = layer.align === 'left' || layer.align === 'right' ? layer.align : 'center'; // lines of different lengths: which side they share
  const curve = within(Number(layer.curve) || 0, -180, 180);
  const margin = Math.ceil(outline) + Math.ceil(size * 0.15); // room for the outline and for slanted letters
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  let W, k; // the text's width, and the pixels it is drawn at per unit of its size
  const size2 = (w, h) => { W = w; k = textRes(layer, w, h); c.width = Math.ceil(w * k); c.height = Math.ceil(h * k); ctx.scale(k, k); };
  const measuring = (spacing) => {
    ctx.font = fontStr;
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = spacing;
  };
  // the drawing settings, set once the canvas is sized (sizing clears them)
  const pen = (spacing, textAlign) => {
    measuring(spacing);
    Object.assign(ctx, {
      textAlign, textBaseline: 'middle', lineJoin: 'round',
      fillStyle: layer.textColor || '#ffffff', strokeStyle: layer.outlineColor || '#000000',
      lineWidth: outline * 2, // the stroke is centred on the letters' edge: half of it shows
    });
  };
  const ink = (str, x, y) => {
    if (outline > 0) ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };
  if (!curve) {
    measuring(`${gap}px`);
    const widest = Math.max(1, ...lines.map(t => ctx.measureText(t).width));
    size2(Math.ceil(widest) + margin * 2, Math.ceil(lineH * lines.length) + margin * 2);
    pen(`${gap}px`, align);
    const x = align === 'left' ? margin : align === 'right' ? W - margin : W / 2;
    lines.forEach((line, i) => ink(line, x, margin + lineH * (i + 0.5)));
  } else {
    // Each letter is placed by itself along an arc spanning `curve` degrees,
    // bowing up for a curve above 0 and down below it. The letter spacing is
    // added by hand between letters, so each letter's measured width holds.
    const arc = Math.abs(curve) * Math.PI / 180, dir = Math.sign(curve);
    measuring(null);
    const rows = lines.map((text) => {
      const chars = [...text];
      const widths = chars.map(ch => ctx.measureText(ch).width);
      const length = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
      return { chars, widths, length, R: Math.max(length, 1) / arc };
    });
    // how far an arc of radius R bows from the straight line across its ends
    const bow = (R) => R * (1 - Math.cos(Math.min(arc / 2, Math.PI)));
    let widest = 1, deepest = 0;
    for (const { R } of rows) {
      const across = arc / 2 >= Math.PI / 2 ? R : R * Math.sin(arc / 2); // half the arc's width
      widest = Math.max(widest, (across + size) * 2);
      deepest = Math.max(deepest, bow(R));
    }
    size2(Math.ceil(widest) + margin * 2, Math.ceil(lineH * lines.length + deepest) + margin * 2);
    pen('0px', 'center');
    rows.forEach(({ chars, widths, length, R }, i) => {
      if (!chars.length) return;
      const y0 = margin + deepest / 2 + lineH * (i + 0.5) - dir * bow(R) / 2; // each arc centred on its line
      let along = -length / 2; // distance along the arc, from its middle
      chars.forEach((ch, j) => {
        const a = (along + widths[j] / 2) / R; // the letter's angle from the arc's middle
        ctx.save();
        ctx.translate(W / 2 + R * Math.sin(a), y0 + dir * R * (1 - Math.cos(a)));
        ctx.rotate(dir * a);
        ink(ch, 0, 0);
        ctx.restore();
        along += widths[j] + gap;
      });
    });
  }
  c.res = k; // layerMatrix shrinks it back by this
  layer.img = c;
  layer.src = c.toDataURL('image/png');
}

// A shape layer: an outline filled with a colour (or a fade) and a finish of
// its own, in the box rx, ry, rw, rh, so a finish can go down without a picture.
export function createFillLayer(color = '#e8e6e1') {
  return {
    ...layerBase('fill', 'fill'),
    color,
    shape: 'rect',         // rect | ellipse | triangle | path
    pts: null,             // shape 'path': the outline, [{ x, y, c? }] in doc space (see shapes.js)
    fillType: 'solid',     // or a fade: 'linear' (straight) or 'radial' (round)
    color2: '#101114',     // the colour a fade ends in
    colorMid: null,        // older saves: one colour on the way, at midPos (0–1) along
    midPos: 0.5,
    stops: [],             // colours it fades through on the way, [{ color, at: 0–1 }]; these replace colorMid
    gradAngle: 0,          // which way a straight fade runs, in degrees: 0 is left to right
    x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false,
    rx: SIZE / 2 - 300, ry: SIZE / 2 - 200, rw: 600, rh: 400, // its box, 600 × 400 in the middle
  };
}

// A shape's outline as a Path2D, made to fill the box rx, ry, rw, rh (the
// layer's own, or a thumbnail's). A 'path' shape is drawn from its own
// points instead (doc space; the rect is then just its bounding box): each
// point may carry `c`, the bend handle of the line leaving it.
export function fillShapePath(shape, rx, ry, rw, rh, pts) {
  const p = new Path2D();
  const corners = (...q) => { q.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); };
  const at = (u, v) => [rx + u * rw, ry + v * rh]; // u, v: 0–1 across and down the box
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
  if (shape === 'ellipse') p.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
  else if (shape === 'triangle') corners(at(0.5, 0), at(1, 1), at(0, 1)); // pointing up
  else if (shape === 'diamond') corners(at(0.5, 0), at(1, 0.5), at(0.5, 1), at(0, 0.5));
  else if (shape === 'stripe') { // leaning at 45°, kept inside the box
    const lean = Math.min(rw, rh);
    corners([rx + lean, ry], [rx + rw, ry], [rx + rw - lean, ry + rh], [rx, ry + rh]);
  } else p.rect(rx, ry, rw, rh);
  return p;
}

// What a shape is filled with: its colour, or a fade across its box (or
// between the two points it was placed with).
export function fillPaintStyle(ctx, layer, rx, ry, rw, rh) {
  const first = layer.color || '#ffffff';
  if (!layer.fillType || layer.fillType === 'solid') return first;
  const mx = rx + rw / 2, my = ry + rh / 2;
  let g;
  const A = layer.fadeFrom, B = layer.fadeTo;
  if (A && B) {
    // the fade runs between two points placed on the sheet: from the first to
    // the second, or (radial) out from the first as far as the second
    g = layer.fillType === 'radial'
      ? ctx.createRadialGradient(A.x, A.y, 0, A.x, A.y, Math.max(1, Math.hypot(B.x - A.x, B.y - A.y)))
      : ctx.createLinearGradient(A.x, A.y, B.x, B.y);
  } else if (layer.fillType === 'radial') {
    g = ctx.createRadialGradient(mx, my, 0, mx, my, Math.hypot(rw, rh) / 2); // from the middle out to the corners
  } else {
    // straight across the box at gradAngle, reaching its far corners
    const rad = (layer.gradAngle || 0) * Math.PI / 180, ux = Math.cos(rad), uy = Math.sin(rad);
    const reach = (Math.abs(ux) * rw + Math.abs(uy) * rh) / 2;
    g = ctx.createLinearGradient(mx - ux * reach, my - uy * reach, mx + ux * reach, my + uy * reach);
  }
  g.addColorStop(0, first);
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

// ---------- painting ----------

const sheet = () => Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
const paintCanvas = sheet(), specCanvas = sheet(), scratch = sheet();
// The paint sheet and the scratch are read back many times for one picture
// (the linear-light mix reads both for every layer). Told so up front, the
// browser keeps them where reading is cheap, instead of fetching each read
// from the graphics card. The first getContext call settles it for good.
paintCanvas.getContext('2d', { willReadFrequently: true });
scratch.getContext('2d', { willReadFrequently: true });
specCanvas.getContext('2d', { willReadFrequently: true });
// the shadow's own buffer: drawLayer is itself called with `scratch` as the target.
// Made when first needed: most liveries have no shadow
let fxScratch = null;

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
  if (isRegionLayer(layer)) {
    const [rx, ry, rw, rh] = [layer.rx ?? 0, layer.ry ?? 0, layer.rw ?? SIZE, layer.rh ?? SIZE];
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
    return;
  }
  // a picture or text: placed by its matrix, about its middle
  const { a, b, c, d, e, f } = layerMatrix(layer), { img } = layer;
  ctx.save();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

// A layer's trim as a list of windows, each a list of { x, y }
export const clipPolys = (layer) => (Array.isArray(layer.clip) ? layer.clip.filter(p => Array.isArray(p) && p.length >= 3) : []);

// One layer drawn onto ctx: trimmed, carried, at its opacity and blend, with
// its shadow. forSpec: for the spec map, where only its outline matters.
export function drawLayer(ctx, layer, forSpec = false) {
  // a shadow is for text and pictures, and for the paint only: it is not part of the design's own outline
  const { fx } = layer;
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
    fxScratch ??= sheet();
    const buf = fxScratch.getContext('2d');
    buf.clearRect(0, 0, SIZE, SIZE);
    drawCopies(buf, layer);
    // drawn from the buffer a whole sheet off to the left, with the shadow
    // pushed a sheet back to the right: only the shadow lands on the sheet
    ctx.save();
    Object.assign(ctx, {
      shadowColor: fx.shadowColor || '#000000',
      shadowBlur: Math.max(0, Math.min(60, fx.shadow)),
      shadowOffsetX: SIZE + (fx.shadowDX ?? 8),
      shadowOffsetY: fx.shadowDY ?? 8,
    });
    ctx.drawImage(fxScratch, -SIZE, 0);
    ctx.restore();
    ctx.drawImage(fxScratch, 0, 0); // and the layer over it
  } else {
    drawCopies(ctx, layer);
  }
  ctx.restore();
}

// shown in the paint: visible, and not an area that is only in the spec map
const inPaintMap = (layer) => layer.visible && !layer.specOnly;

// the extra colours' squares go over everything, so iRacing reads the colours
// set for them; the pitboard's colour goes under the layers, as its background
function paintSwatches(ctx, doc, boards = false) {
  for (const p of doc.swatches || []) {
    if (!!p.points !== boards || p.clear) continue; // clear: "Transparent background", what is under it shows
    ctx.fillStyle = p.color;
    if (!boards) { ctx.fillRect(p.x, p.y, p.w, p.h); continue; }
    ctx.beginPath();
    p.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.fill();
  }
}

function paintBase(ctx, doc) {
  ctx.fillStyle = doc.baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const light = sparkleLight(doc.baseMaterial, doc.baseMatParams);
  if (light) lightenFlecks(ctx, light, { x: 0, y: 0, w: SIZE, h: SIZE }, null);
}

// A sparkle finish whose flecks also lighten the paint (params.bright, 0 to
// 100): → { lights, amount } (see sparkleLights), or null.
function sparkleLight(material, params) {
  const mat = MATERIALS[material];
  if (!mat || (mat.tex !== 'flake' && mat.tex !== 'glitter')) return null;
  const p = resolveParams(material, params), amount = Math.max(0, Math.min(1, (p.bright || 0) / 100));
  return amount ? { lights: sparkleLights(mat.tex, p), amount } : null;
}
// White laid over the paint in box, as strong at each pixel as its fleck's
// light times amount times mask (the layer's own alpha there, box-sized; null:
// everywhere), mixed as drawing it would
function lightenFlecks(ctx, { lights, amount }, box, mask) {
  if (box.w <= 0 || box.h <= 0) return;
  const img = ctx.getImageData(box.x, box.y, box.w, box.h), d = img.data;
  for (let j = 0, o = 0; j < box.h; j++) for (let i = 0, q = (box.y + j) * SIZE + box.x; i < box.w; i++, o += 4, q++) {
    const al = lights[q] / 255 * amount * (mask ? mask[o + 3] / 255 : 1);
    if (!al) continue;
    const da = d[o + 3] / 255, k = da * (1 - al), oa = al + k;
    d[o] = (255 * al + d[o] * k) / oa; d[o + 1] = (255 * al + d[o + 1] * k) / oa; d[o + 2] = (255 * al + d[o + 2] * k) / oa;
    d[o + 3] = oa * 255;
  }
  ctx.putImageData(img, box.x, box.y);
}

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
  const k = layer.carry;
  if (!(fx && fx.shadow > 0) && !layer.repeat) { // a shadow, or copies, fall outside the layer's own box
    try {
      const cs = layerCorners(layer).map(q => (k ? { x: k.a * q.x + k.c * q.y + k.e, y: k.b * q.x + k.d * q.y + k.f } : q));
      const xs = cs.map(q => q.x), ys = cs.map(q => q.y);
      x0 = Math.max(0, Math.floor(Math.min(...xs)) - 3); y0 = Math.max(0, Math.floor(Math.min(...ys)) - 3);
      x1 = Math.min(SIZE, Math.ceil(Math.max(...xs)) + 3); y1 = Math.min(SIZE, Math.ceil(Math.max(...ys)) + 3);
    } catch { /* no box to be had: the whole sheet */ }
  } else if (!(fx && fx.shadow > 0) && !k) {
    // copies: round each copy's middle, as far as the layer (or another of
    // its outlines, or a copy grown by Random size) can reach at any turn.
    // A whole-sheet box made every accurate redraw of a Repeat read the whole sheet back twice
    try {
      const { cx, cy, W, H, list } = repeatOffsets(layer), r = layer.repeat;
      const cs = isRegionLayer(layer) ? null : layerCorners(layer), own = cs ? Math.hypot(cs[0].x - cs[2].x, cs[0].y - cs[2].y) : Math.hypot(layer.rw, layer.rh);
      const reach = Math.max(own, Math.hypot(W, H)) / 2 * (1 + 0.75 * (r.rSize || 0) / 100) + 3;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const o of list) { a = Math.min(a, cx + o.x); b = Math.min(b, cy + o.y); c = Math.max(c, cx + o.x); d = Math.max(d, cy + o.y); }
      if (list.length) { x0 = Math.max(0, Math.floor(a - reach)); y0 = Math.max(0, Math.floor(b - reach)); x1 = Math.min(SIZE, Math.ceil(c + reach)); y1 = Math.min(SIZE, Math.ceil(d + reach)); }
    } catch { /* no box to be had: the whole sheet */ }
  }
  // nothing shows outside its trim, shadow included
  const windows = k ? k.clip : clipPolys(layer);
  if (windows.length) {
    const all = windows.flat();
    x0 = Math.max(x0, Math.floor(Math.min(...all.map(q => q.x))) - 1); y0 = Math.max(y0, Math.floor(Math.min(...all.map(q => q.y))) - 1);
    x1 = Math.min(x1, Math.ceil(Math.max(...all.map(q => q.x))) + 1); y1 = Math.min(y1, Math.ceil(Math.max(...all.map(q => q.y))) + 1);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
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
  // the flecks, only where the layer is: its own pixels, drawn alone on the
  // scratch (free again once the layer is painted), say where
  const box = paintBox(layer), sctx = scratch.getContext('2d');
  sctx.clearRect(box.x, box.y, box.w, box.h);
  drawLayer(sctx, layer, false);
  if (box.w > 0 && box.h > 0) lightenFlecks(ctx, light, box, sctx.getImageData(box.x, box.y, box.w, box.h).data);
  sctx.clearRect(0, 0, SIZE, SIZE);
}
function paintLayerPaint(ctx, layer) {
  if (!linearEdges || !edgesInLinear(layer)) return drawLayer(ctx, layer, false);
  const s = scratch.getContext('2d');
  s.clearRect(0, 0, SIZE, SIZE);
  drawLayer(s, layer, false);
  mixLinearInto(ctx, scratch, paintBox(layer));
}

// The given layers painted in stack order over a transparent sheet, exactly
// as they appear in the paint (tint, opacity, effects and trim included) —
// what Merge bakes into one image. Material-only layers paint nothing.
export function paintLayers(layers, { linearEdges: lin = false } = {}) {
  const c = sheet(), ctx = c.getContext('2d');
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
  linearEdges = lin;
  try {
    paintUnder(ctx, doc, doc.layers);
  } finally { linearEdges = false; }
  paintSwatches(ctx, doc);
  return paintCanvas;
}

// a clear sheet, the base coat, the pitboard's colour, then those of `layers`
// shown in the paint
function paintUnder(ctx, doc, layers) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  paintBase(ctx, doc);
  paintSwatches(ctx, doc, true);
  for (const l of layers) if (inPaintMap(l)) paintLayerInto(ctx, l);
}

// ---------- painting while layers are dragged ----------
// The layers under and over the ones being dragged stay put, so they are
// painted once into two sheets, kept for the drag only (32 MB). Each frame is
// then those two sheets with the moving layers between them.

const slab = () => {
  const c = sheet();
  c.getContext('2d', { willReadFrequently: true }); // (they are mixed into by the same reads)
  return c;
};

// → { movingIds, below, above }, or null (paint the whole stack instead) when
// a layer that stays sits among the moving ones, or a blend above them needs
// what is under it
export function buildDragCache(doc, movingIds) {
  const at = doc.layers.flatMap((l, i) => (movingIds.has(l.id) ? [i] : []));
  if (!at.length) return null;
  const lo = at[0], hi = at[at.length - 1];
  if (doc.layers.slice(lo, hi + 1).some(l => !movingIds.has(l.id) && inPaintMap(l))) return null;
  const below = slab(), above = slab();
  paintUnder(below.getContext('2d'), doc, doc.layers.slice(0, lo));
  const actx = above.getContext('2d');
  for (const l of doc.layers.slice(hi + 1)) {
    if (l.blend) return null;
    if (inPaintMap(l)) paintLayerInto(actx, l);
  }
  paintSwatches(actx, doc);
  return { movingIds, below, above };
}

export function renderPaintWithDrag(doc, { movingIds, below, above }) {
  const ctx = paintCanvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(below, 0, 0);
  for (const l of doc.layers) if (movingIds.has(l.id) && inPaintMap(l)) paintLayerInto(ctx, l);
  ctx.drawImage(above, 0, 0);
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
// The spec map: the base coat's finish over the whole sheet, then each
// visible layer's finish in its outline.
export function renderSpec(doc) {
  const ctx = specCanvas.getContext('2d');
  const { tex } = MATERIALS[doc.baseMaterial] || MATERIALS.gloss;
  const base = resolveParams(doc.baseMaterial, doc.baseMatParams);
  ctx.fillStyle = `rgb(${base.met},${base.rough},${base.clear})`;
  ctx.fillRect(0, 0, SIZE, SIZE); // opaque: covers the last map
  if (tex) paintSparkle(ctx, tex, base, 0, 0, SIZE, SIZE);

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
    // the run's shapes in any colour, then their insides set to the finish's
    // three numbers, with sparkle laid on top for flake and glitter
    for (const l of run) drawLayer(sctx, l, true); // silhouette pass: no shadow
    sctx.save();
    sctx.globalCompositeOperation = 'source-in';
    // only inside the box: outside it there is nothing of this run to fill
    sctx.beginPath(); sctx.rect(x0, y0, w, h); sctx.clip();
    sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
    sctx.fillRect(x0, y0, w, h);
    sctx.restore();
    if (mat.tex) paintSparkle(sctx, mat.tex, p, x0, y0, w, h);
    ctx.drawImage(scratch, x0, y0, w, h, x0, y0, w, h);
    sctx.clearRect(x0, y0, w, h); // left clean for the next run
  }
  return specCanvas;
}

// ---------- picking ----------

// a sheet point in a picture or text layer's own pixels, from its middle
export function toLocal(layer, px, py) {
  const { x, y } = layerMatrix(layer).inverse().transformPoint(new DOMPoint(px, py));
  return { x, y };
}

// a layer's four corners on the sheet, clockwise from its top left (for the
// selection box and its handles)
export function layerCorners(layer) {
  if (isRegionLayer(layer)) {
    const { rx = 0, ry = 0, rw = SIZE, rh = SIZE } = layer;
    return [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]].map(([x, y]) => ({ x, y }));
  }
  const m = layerMatrix(layer), w = layer.img.width / 2, h = layer.img.height / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => {
    const q = m.transformPoint(new DOMPoint(x, y));
    return { x: q.x, y: q.y };
  });
}

// ---------- saving and loading ----------

// The livery as plain data, ready for JSON (format overspray/1). Pictures go
// as their data URLs, the template as its picture only.
export function serializeDoc(doc) {
  return {
    format: 'overspray/1',
    name: doc.name, target: doc.target, customNumber: !!doc.customNumber, car: doc.car || null,
    baseColor: doc.baseColor, baseMaterial: doc.baseMaterial, baseMatParams: doc.baseMatParams || null,
    template: doc.template ? doc.template.src : null,
    customFonts: (doc.customFonts || []).map(({ name, data }) => ({ name, data })),
    regionMap: doc.regionMap || null,
    palette: cleanPalette(doc.palette),
    baseRef: doc.baseRef || null,
    swatches: doc.swatches || [],
    googleFonts: (doc.googleFonts || []).filter(f => typeof f === 'string' && f).slice(0, 60),
    finishRules: cleanFinishRules(doc.finishRules),
    groups: (doc.groups || []).map(g => ({ id: g.id, name: g.name, collapsed: !!g.collapsed, ...(g.turn ? { turn: g.turn } : {}) })),
    // every field for every kind of layer: what a kind does not use is left
    // undefined (and so out of the JSON) or saved as its empty default
    layers: doc.layers.map(l => ({
      id: l.id, type: l.type, name: l.name, groupId: l.groupId || null,
      visible: l.visible, locked: !!l.locked, opacity: l.opacity, blend: l.blend || null,
      material: l.material, matParams: l.matParams || null, specOnly: !!l.specOnly,
      fx: l.fx || null,
      // a shape's fill
      color: l.color, shape: l.shape, fillType: l.fillType, color2: l.color2, gradAngle: l.gradAngle,
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
      src: l.src, // a picture's pixels, or text's as last drawn
      // text
      text: l.text, font: l.font, fontSize: l.fontSize, italic: l.italic, letterSpacing: l.letterSpacing,
      textColor: l.textColor, outlineColor: l.outlineColor, outlineWidth: l.outlineWidth,
      fontWeight: l.fontWeight || undefined, lineSpacing: l.lineSpacing || undefined, align: l.align || undefined,
      curve: l.curve || 0,
      // where it sits: a picture or text's middle, size, turn and flips; a shape's box
      x: l.x, y: l.y, scale: l.scale, scaleY: l.scaleY ?? null, rotation: l.rotation, flipH: l.flipH, flipV: l.flipV,
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
// from). Only pictures still in use are kept: one no layer holds any more (a
// deleted logo) is let go, and decoded again from its saved copy if an undo
// brings it back.
const imageCache = new Map(); // src → promise while it decodes, then a WeakRef to the image
export function loadImage(src) {
  for (const [k, v] of imageCache) if (v instanceof WeakRef && !v.deref()) imageCache.delete(k);
  const had = imageCache.get(src);
  if (had) return had instanceof WeakRef ? Promise.resolve(had.deref()) : had;
  const made = decodeImage(src);
  imageCache.set(src, made);
  made.then((img) => imageCache.set(src, new WeakRef(img)), () => imageCache.delete(src));
  return made;
}
function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    // a picture from another site must come with CORS, or drawing it taints
    // the paint canvas and every export fails; this site's own pictures, blob:
    // and data: URLs need nothing
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

// a saved shadow, its missing numbers filled in as the panel shows them
const normalizeFx = (fx) => (fx && typeof fx === 'object'
  ? { shadow: fx.shadow ?? 0, shadowDX: fx.shadowDX ?? 8, shadowDY: fx.shadowDY ?? 8, shadowColor: fx.shadowColor || '#000000' }
  : null);

// A saved livery (see serializeDoc) back as a document. Anything broken is
// left out rather than failing the whole load: a bad region map, a layer that
// will not load, a group with no layers left in it.
export async function deserializeDoc(data) {
  const doc = createDoc();
  Object.assign(doc, {
    name: data.name || doc.name,
    target: ['car', 'helmet', 'suit'].includes(data.target) ? data.target : 'car',
    customNumber: !!data.customNumber,
    car: typeof data.car === 'string' && data.car ? data.car : null,
    baseColor: data.baseColor || doc.baseColor,
    baseMaterial: data.baseMaterial || doc.baseMaterial,
    baseMatParams: data.baseMatParams || null,
  });
  // decoded only when its lines are drawn, and let go again after (app.js templateLines)
  if (typeof data.template === 'string' && data.template) doc.template = { img: null, src: data.template };
  try {
    if (data.regionMap) doc.regionMap = parseRegionMap(data.regionMap);
  } catch { /* a broken map is dropped */ }
  doc.palette = cleanPalette(data.palette);
  doc.finishRules = cleanFinishRules(data.finishRules);
  doc.googleFonts = Array.isArray(data.googleFonts) ? data.googleFonts.filter(f => typeof f === 'string' && f).slice(0, 60) : [];
  doc.baseRef = doc.palette.some(c => c.id === data.baseRef) ? data.baseRef : null;
  const n = (v) => Math.max(0, Math.min(SIZE, Math.round(+v) || 0));
  const sw = data.swatches || data.pitbox; // (saved as pitbox before the cockpit colour came)
  doc.swatches = (Array.isArray(sw) ? sw : []).slice(0, 24)
    .filter(p => p && /^#[0-9a-f]{6}$/i.test(p.color))
    .map((p, i, all) => ({ name: typeof p.name === 'string' && p.name ? p.name.slice(0, 40) : all.length > 1 ? `Pit box ${i + 1}` : 'Pit box', x: n(p.x), y: n(p.y), w: n(p.w), h: n(p.h), color: p.color, ref: doc.palette.some(c => c.id === p.ref) ? p.ref : null,
      ...(Array.isArray(p.points) && p.points.length >= 3 ? { points: p.points.slice(0, 2000).map(q => ({ x: n(q && q.x), y: n(q && q.y) })), ...(p.clear ? { clear: true } : {}) } : {}) }));
  // the livery's own fonts go live first, so its text is drawn in them
  doc.fontWarnings = []; // fonts that would not load: their text is drawn in a stand-in
  for (const f of data.customFonts || []) {
    if (!f?.name || !f.data) continue;
    doc.customFonts.push({ name: f.name, data: f.data }); // kept even if it fails, so saving again does not lose it
    await registerCustomFont(f.name, f.data).catch(() => doc.fontWarnings.push(f.name));
  }
  // what every kind of layer reads the same way, and where a picture or text sits
  const common = (l, type, name) => ({
    id: l.id || newId(), type, name: l.name || name,
    visible: l.visible !== false, locked: !!l.locked, opacity: l.opacity ?? 1, blend: l.blend === 'multiply' ? 'multiply' : null,
    material: l.material || 'gloss', matParams: l.matParams || null, specOnly: !!l.specOnly,
  });
  const placing = (l) => ({
    x: l.x ?? SIZE / 2, y: l.y ?? SIZE / 2,
    scale: l.scale ?? 1, scaleY: Number.isFinite(l.scaleY) ? l.scaleY : null,
    rotation: l.rotation ?? 0, flipH: !!l.flipH, flipV: !!l.flipV,
  });
  for (const l of data.layers || []) {
    try {
      if (l.type === 'fill') {
        doc.layers.push({
          ...createFillLayer(l.color || '#e8e6e1'),
          ...common(l, 'fill', 'fill'),
          shape: l.shape || 'rect',
          pts: shapePts(l.pts),
          turn: Number.isFinite(l.turn) ? l.turn : 0,
          colorRef: typeof l.colorRef === 'string' ? l.colorRef : null,
          fillType: l.fillType || 'solid', color2: l.color2 || '#101114',
          colorMid: l.colorMid || null, midPos: l.midPos ?? 0.5,
          stops: Array.isArray(l.stops) ? l.stops.filter(o => o && typeof o.color === 'string' && Number.isFinite(o.at)).slice(0, 8).map(o => ({ color: o.color, at: o.at })) : [],
          gradAngle: l.gradAngle ?? 0,
          car: cleanCar(l.car),
          rx: l.rx ?? 0, ry: l.ry ?? 0, rw: l.rw ?? SIZE, rh: l.rh ?? SIZE,
          flipH: !!l.flipH, flipV: !!l.flipV, // a ready-made shape separated from its mirror is flipped: it stays so
        });
      } else if (l.type === 'text') {
        const layer = {
          ...common(l, 'text', 'text'),
          img: null, src: l.src || null,
          text: l.text ?? 'TEXT', font: l.font || 'Arial Black', fontSize: l.fontSize ?? 160,
          italic: !!l.italic, letterSpacing: l.letterSpacing ?? 0,
          textColor: l.textColor || '#ffffff', outlineColor: l.outlineColor || '#000000', outlineWidth: l.outlineWidth ?? 0,
          fontWeight: Number.isFinite(l.fontWeight) ? l.fontWeight : null, lineSpacing: Number.isFinite(l.lineSpacing) ? l.lineSpacing : null,
          align: l.align === 'left' || l.align === 'right' ? l.align : null,
          curve: l.curve ?? 0,
          fx: normalizeFx(l.fx),
          ...placing(l),
        };
        regenerateText(layer); // text that cannot be drawn is left out
        doc.layers.push(layer);
      } else if (l.type === 'image') { // (any other kind, such as one from the original screen, is left out)
        doc.layers.push({ ...common(l, 'image', 'image'), fx: normalizeFx(l.fx), img: await loadImage(l.src), src: l.src, ...placing(l) });
      }
    } catch { /* a layer that will not load is left out */ }
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
  // Groups come back after the layers, so none is left pointing at a layer
  // that did not load: each layer rejoins the group saved with it, by id,
  // and only groups with a layer in them are kept.
  const savedGroup = new Map((data.layers || []).filter(l => l && l.id && typeof l.groupId === 'string' && l.groupId).map(l => [l.id, l.groupId]));
  const groups = new Map();
  for (const g of Array.isArray(data.groups) ? data.groups : []) {
    if (!g || typeof g.id !== 'string' || !g.id || groups.has(g.id)) continue;
    groups.set(g.id, { id: g.id, name: typeof g.name === 'string' && g.name ? g.name : 'Group', collapsed: !!g.collapsed, ...(Number.isFinite(g.turn) && g.turn ? { turn: g.turn } : {}) });
  }
  const used = new Set();
  for (const l of doc.layers) {
    const gid = savedGroup.get(l.id);
    l.groupId = groups.has(gid) ? gid : null;
    if (l.groupId) used.add(gid);
  }
  doc.groups = [...groups.values()].filter(g => used.has(g.id));
  return doc;
}
