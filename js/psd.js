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

// ---------- a livery PSD as layers ----------
// Someone's finished livery in Photoshop, as picture layers: every pixel
// layer, in order (hidden ones come in hidden: a layer left on or off by
// mistake can then be put right here), with its opacity, its layer mask and its clipping
// baked into its pixels. The kit's own helper layers are left out (Overspray
// makes the pit box and pitboard itself), and so is the spec map.
const SKIP_GROUP_RE = /turn\s*off|spec\s*map/i;
const SKIP_LAYER_RE = /pit\s*box|pit\s*board|^(wire|mask)$|(sponsor|number)\s*blocks|car[\s_]*mandatory/i;
// hidden kit extras, as a template import leaves them: the pattern library and alt-series decals
const KIT_HIDDEN_RE = /car\s*patterns?|decal|logos?\b/i;

// a layer's pixels with its mask's grey as their alpha
function masked(c, l, m) {
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const g = out.getContext('2d');
  if (m.defaultColor) { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); } // outside the mask's box: shown
  const mw = m.canvas.width, mh = m.canvas.height;
  if (mw && mh) {
    const id = m.canvas.getContext('2d').getImageData(0, 0, mw, mh), p = id.data;
    for (let i = 0; i < p.length; i += 4) p[i + 3] = p[i];
    const mx = (m.left || 0) - (m.positionRelativeToLayer ? 0 : l.left || 0), my = (m.top || 0) - (m.positionRelativeToLayer ? 0 : l.top || 0);
    g.clearRect(mx, my, mw, mh);
    g.putImageData(id, mx, my);
  }
  g.globalCompositeOperation = 'source-in';
  g.drawImage(c, 0, 0);
  return out;
}

// a clipped layer cut to the alpha of the layer it clips to
function clipped(c, l, base) {
  const out = document.createElement('canvas');
  out.width = c.width; out.height = c.height;
  const g = out.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(base.canvas, base.left - (l.left || 0), base.top - (l.top || 0));
  return out;
}

// → { layers: [{ name, canvas, x, y, scale, scaleY, opacity, blend, group }]
//     bottom first, x/y the centre in 2048-sheet space, visible as in the PSD; group: the PSD group
//     it was in (not the kit's "Paintable Area"), or null,
//     lost: { fx, blend, text, hidden }: how many came in without effects, with a
//     blend Overspray does not have (as normal), as a picture of their text, or turned off },
//     kit: it has the kit's wireframe, so it can be the template too }
export async function psdToLayers(arrayBuffer) {
  const agPsd = await loadAgPsd();
  const psd = agPsd.readPsd(arrayBuffer);
  const kx = SIZE / psd.width, ky = SIZE / psd.height;
  const layers = [], lost = { fx: 0, blend: 0, text: 0, hidden: 0 };
  const walk = (children, group, opacity, off) => {
    let base = null; // what a clipping layer clips to: { canvas, left, top, hidden }, or 'off' when it was left out
    for (const l of children || []) {
      const name = l.name || '';
      const hidden = off || !!l.hidden;
      if (!l.clipping) base = 'off';
      if (l.clipping && base === 'off') continue;
      if (l.children) {
        base = null; // what clips to a group comes in unclipped
        if (!SKIP_GROUP_RE.test(name) && !(hidden && KIT_HIDDEN_RE.test(name))) walk(l.children, /paintable/i.test(name) ? group : name, opacity * (l.opacity ?? 1), hidden);
        continue;
      }
      if (!l.canvas || SKIP_LAYER_RE.test(name) || (hidden && KIT_HIDDEN_RE.test(name))) continue;
      let c = l.canvas;
      if (l.mask && !l.mask.disabled && l.mask.canvas) c = masked(c, l, l.mask);
      if (l.clipping && base) c = clipped(c, l, base);
      else base = { canvas: c, left: l.left || 0, top: l.top || 0, hidden };
      const shown = !hidden && !(l.clipping && base && base.hidden); // clipped to a hidden layer: hidden with it
      if (l.effects && !l.effects.disabled) lost.fx++;
      if (l.text) lost.text++;
      if (!shown) lost.hidden++;
      const blend = l.blendMode === 'multiply' ? 'multiply' : null;
      if (!blend && l.blendMode && l.blendMode !== 'normal') lost.blend++;
      const x = ((l.left || 0) + c.width / 2) * kx, y = ((l.top || 0) + c.height / 2) * ky;
      let scale = kx, scaleY = ky === kx ? null : ky;
      if (kx < 1 || ky < 1) { // a bigger PSD's layers brought down to the sheet, as pictures are
        const s = document.createElement('canvas');
        s.width = Math.max(1, Math.round(c.width * kx)); s.height = Math.max(1, Math.round(c.height * ky));
        const g = s.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(c, 0, 0, s.width, s.height);
        c = s; scale = 1; scaleY = null;
      }
      layers.push({ name: name || 'Layer', canvas: c, x, y, scale, scaleY, opacity: opacity * (l.opacity ?? 1), blend, group, visible: shown });
    }
  };
  walk(psd.children, null, 1, false);
  const all = [];
  collectLayers(psd.children, false, false, all);
  return { layers, lost, kit: all.some(e => e.matched) };
}
