// PSD template import — extracts the wireframe from official iRacing template PSDs
// so users never need Photoshop. Uses ag-psd, vendored locally (js/vendor/ag-psd.min.js)
// and lazy-loaded only when a .psd is actually opened (keeps the core app load lean,
// with zero runtime CDN dependencies).

import { SIZE } from './engine.js';
import { detectPieces } from './regions.js';
import { alphaComponents } from './zones.js';

let agPsdPromise = null;

function loadAgPsd() {
  if (window.agPsd) return Promise.resolve(window.agPsd);
  if (!agPsdPromise) {
    agPsdPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/ag-psd.min.js';
      s.onload = () => window.agPsd ? resolve(window.agPsd) : reject(new Error('PSD reader failed to initialize'));
      s.onerror = () => { agPsdPromise = null; reject(new Error('Could not load the PSD reader')); };
      document.head.appendChild(s);
    });
  }
  return agPsdPromise;
}

// Layer/group names that look like wireframe linework in iRacing template PSDs.
const WIRE_RE = /(wire|outline|line\s?art|\blines?\b|contour|panel\s?lines|template\s?lines)/i;
// Names that are clearly not reference linework even if a parent group matched.
const SKIP_RE = /(background|bkg|paint\s?here|fill|color|colour|sample|example)/i;

// NOTE: official iRacing templates ship the wireframe layer ("Wire") hidden,
// so hidden layers are still collected — visibility only matters for the
// non-wireframe fallback composite.
function collectLayers(children, parentMatched, parentHidden, out) {
  for (const layer of children || []) {
    const name = layer.name || '';
    if (SKIP_RE.test(name)) continue;
    const matched = parentMatched || WIRE_RE.test(name);
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) {
      collectLayers(layer.children, matched, hidden, out);
    } else if (layer.canvas) {
      out.push({ layer, matched, hidden });
    }
  }
}

// every raster layer with its effective hidden state — no name filtering
function collectAllLayers(children, parentHidden, out) {
  for (const layer of children || []) {
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) collectAllLayers(layer.children, hidden, out);
    else if (layer.canvas) out.push({ layer, hidden });
  }
}

function drawLayers(ctx, entries) {
  for (const { layer } of entries) {
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
  ctx.globalAlpha = 1;
}

// Every wireframe layer at full strength on a clear canvas, colours as drawn.
// `src` above puts the same layers on white, where a kit's white mesh lines
// vanish; a caller that wants those too reads them from here.
function wireCanvas(psd, wires) {
  const c = document.createElement('canvas');
  c.width = psd.width;
  c.height = psd.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const { layer } of wires) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  return c;
}

// Outlines of the sheet's pieces, read from the wireframe layers and scaled to
// 2048-sheet space (see detectPieces). Empty when the wireframe does not split
// into separate pieces, e.g. linework flattened onto an opaque background.
function wirePieces(psd, wires) {
  const c = document.createElement('canvas');
  c.width = psd.width;
  c.height = psd.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // full strength, whatever the layer's opacity — only the line shapes matter
  for (const { layer } of wires) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const mask = new Uint8Array(c.width * c.height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  const pieces = detectPieces(mask, c.width, c.height);
  if (pieces.length < 2) return [];
  const kx = SIZE / c.width, ky = SIZE / c.height;
  return pieces.map(pts => pts.map(q => ({ x: q.x * kx, y: q.y * ky })));
}

// ---------- template intelligence (zones / decals) ----------
// Official kits ship hidden helper layers: "Sponsor"/"Sponsor Blocks" and
// "Numbers"/"Number Blocks" are solid rectangles marking the official decal
// zones; "Car_decal" /
// "Color Change Logos" / "IMSA LOGOS" hold the kit's stock decals, whose
// orientation reveals how each panel reads. Hidden layers still carry a
// canvas in ag-psd; every layer is positioned by its left/top offset.

const SPONSOR_RE = /sponsor/i;
const NUMBER_RE = /number/i;
const NUMBER_SKIP_RE = /leaderboard|official/i; // alt-series variants of the same blocks
const DECAL_RE = /(decal|logos?)\b/i;

function zoneKind(name) {
  if (SPONSOR_RE.test(name)) return 'sponsor';
  if (NUMBER_RE.test(name) && !NUMBER_SKIP_RE.test(name)) return 'number';
  return null;
}

// one positioned composite of several layers (full opacity, alpha-over)
function composeLayers(layers, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const layer of layers) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  return c;
}

// zones from the sponsor/number block layers: one rectangle per connected
// component, crumbs under 300 px² dropped
function extractZones(entries, w, h) {
  const byKind = { sponsor: [], number: [] };
  for (const { layer } of entries) {
    const k = zoneKind(layer.name || '');
    if (k) byKind[k].push(layer);
  }
  const zones = [];
  for (const kind of ['sponsor', 'number']) {
    if (!byKind[kind].length) continue;
    const img = composeLayers(byKind[kind], w, h).getContext('2d').getImageData(0, 0, w, h);
    for (const r of alphaComponents(img, 300)) zones.push({ kind, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  return zones;
}

// The car's extra colours: iRacing colours parts beyond the paint from small
// squares on the sheet, on layers such as "Pitbox Colors" (one to two squares)
// and "Cockpit Color" (the MX5's roll cage). One per connected block, its
// colour from its middle pixel, in 2048-sheet space, named for what it colours.
const SWATCH_KINDS = [[/pit\s*box/i, 'Pit box'], [/cockpit/i, 'Cockpit']];
function extractSwatches(entries, w, h) {
  const kx = SIZE / w, ky = SIZE / h, hex = (v) => v.toString(16).padStart(2, '0');
  const out = [];
  for (const [re, name] of SWATCH_KINDS) {
    const layers = entries.filter(e => re.test(e.layer.name || '')).map(e => e.layer);
    if (!layers.length) continue;
    const img = composeLayers(layers, w, h).getContext('2d').getImageData(0, 0, w, h), d = img.data;
    const found = alphaComponents(img, 4, 127);
    found.forEach((r, k) => {
      const i = ((r.y + (r.h >> 1)) * w + r.x + (r.w >> 1)) * 4;
      out.push({ name: found.length > 1 ? `${name} ${k + 1}` : name, x: Math.round(r.x * kx), y: Math.round(r.y * ky), w: Math.round(r.w * kx), h: Math.round(r.h * ky), color: '#' + hex(d[i]) + hex(d[i + 1]) + hex(d[i + 2]) });
    });
  }
  // the pitboard (oval cars and some others): an area on a "Pitboard" layer
  // where the board's picture goes; its outline, with a colour of its own
  const boards = entries.filter(e => /pit\s*board/i.test(e.layer.name || '')).map(e => e.layer);
  if (boards.length) {
    const px = composeLayers(boards, w, h).getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    const [pts] = detectPieces(mask, w, h);
    if (pts) {
      const points = pts.map(q => ({ x: Math.round(q.x * kx), y: Math.round(q.y * ky) }));
      const xs = points.map(q => q.x), ys = points.map(q => q.y), x = Math.min(...xs), y = Math.min(...ys);
      out.push({ name: 'Pitboard', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, points, color: '#ffffff' });
    }
  }
  return out;
}

// visible stock-decal layers composed in place (hidden alt-series variants
// would double every blob, so they stay out)
function extractDecals(entries, w, h) {
  const decals = entries.filter(e => !e.hidden && DECAL_RE.test(e.layer.name || '') && !zoneKind(e.layer.name || ''));
  return decals.length ? composeLayers(decals.map(e => e.layer), w, h) : null;
}

// Returns { src (PNG dataURL), usedWireframe (bool), pieces, zones, decals, swatches }
//   pieces    — outlines of the sheet's pieces from the wireframe ([] when there are none)
//   zones     — [{ kind: 'sponsor'|'number', x, y, w, h }] ([] when the kit has no block layers)
//   decals    — RGBA canvas of the stock decals, for orientation probing (null if none)
//   swatches  — [{ name, x, y, w, h, color, points? }]: the car's extra colour squares, and the pitboard by its outline ([] when the kit has none)
export async function psdToTemplate(arrayBuffer) {
  const agPsd = await loadAgPsd();
  const psd = agPsd.readPsd(arrayBuffer);

  const out = document.createElement('canvas');
  out.width = psd.width;
  out.height = psd.height;
  const ctx = out.getContext('2d');
  // white base so the multiply overlay shows only the linework
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  const entries = [];
  collectLayers(psd.children, false, false, entries);
  const wires = entries.filter(e => e.matched);

  // helper layers are walked without SKIP_RE (it drops "Color Change Logos")
  const all = [];
  collectAllLayers(psd.children, false, all);
  let intel = { zones: [], decals: null, swatches: [] };
  try {
    intel = {
      zones: extractZones(all, psd.width, psd.height),
      decals: extractDecals(all, psd.width, psd.height),
      swatches: extractSwatches(all, psd.width, psd.height),
    };
  } catch { /* intelligence is a bonus — the wireframe still loads */ }

  if (wires.length) {
    drawLayers(ctx, wires);
    return { src: out.toDataURL('image/png'), usedWireframe: true, pieces: wirePieces(psd, wires), wire: wireCanvas(psd, wires), ...intel };
  }
  // no wireframe-named layers — fall back to the flattened composite
  if (psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0);
  } else {
    drawLayers(ctx, entries.filter(e => !e.hidden));
  }
  return { src: out.toDataURL('image/png'), usedWireframe: false, pieces: [], ...intel };
}
