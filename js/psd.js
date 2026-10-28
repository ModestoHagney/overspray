// Reading iRacing's template PSDs (and GIMP files) without Photoshop: the
// wireframe, the panels it outlines, the sponsor and number boxes, the stock
// decals. The PSD reader (ag-psd, kept in js/vendor so nothing comes from a
// CDN) is big, so it is only fetched the first time a .psd is opened.

import { SIZE } from './engine.js';
import { detectPieces } from './regions.js';
import { alphaComponents } from './zones.js';
import { readXcf } from './xcf.js';

let reader = null; // a promise of the PSD reader, once it has been asked for
function psdReader() {
  if (window.agPsd) return Promise.resolve(window.agPsd);
  reader ??= new Promise((resolve, reject) => {
    const tag = Object.assign(document.createElement('script'), { src: 'js/vendor/ag-psd.min.js' });
    tag.onload = () => (window.agPsd ? resolve(window.agPsd) : reject(new Error('PSD reader failed to initialize')));
    tag.onerror = () => { reader = null; reject(new Error('Could not load the PSD reader')); }; // the next open tries again
    document.head.append(tag);
  });
  return reader;
}

const blank = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// Names kits give their wireframe layers or groups, and names that are never
// linework, even inside a wireframe group.
const WIRE_RE = /wire|outline|line\s?art|contour|\blines?\b|(panel|template)\s?lines/i;
const SKIP_RE = /background|bkg|paint\s?here|fill|colou?r|sample|example/i;

// Every pixel layer under `children`, as a flat list of { layer, wire: its
// name or a group's says wireframe, hidden: it or a group it is in is turned
// off, kit: it is in the kit's "Turn Off Before Exporting TGA" group }. Kits
// ship the wireframe turned off, so hidden layers are listed too.
// With skipNamed, anything named as not linework (SKIP_RE) is left out, with
// all it holds.
function flatLayers(children, skipNamed, wire = false, hidden = false, kit = false, out = []) {
  for (const layer of children ?? []) {
    const name = layer.name || '';
    if (skipNamed && SKIP_RE.test(name)) continue;
    const w = wire || WIRE_RE.test(name), h = hidden || !!layer.hidden;
    if (layer.children) flatLayers(layer.children, skipNamed, w, h, kit || SKIP_GROUP_RE.test(name), out);
    else if (layer.canvas) out.push({ layer, wire: w, hidden: h, kit });
  }
  return out;
}

// layers drawn over each other on a clear canvas the file's size, each at its
// place and at full strength
function stack(layers, w, h) {
  const c = blank(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  for (const l of layers) g.drawImage(l.canvas, l.left || 0, l.top || 0);
  return c;
}

// Every wireframe layer at full strength on a clear canvas, colours as drawn.
// `src` above puts the same layers on white, where a kit's white mesh lines
// vanish; a caller that wants those too reads them from here.
const wireCanvas = (psd, wires) => stack(wires.map(e => e.layer), psd.width, psd.height);

// Outlines of the sheet's pieces, read from the wireframe layers and scaled to
// 2048-sheet space (see detectPieces). Empty when the wireframe does not split
// into separate pieces, e.g. linework flattened onto an opaque background.
function wirePieces(psd, wires) {
  const c = wireCanvas(psd, wires); // full strength, whatever the layer's opacity: only the line shapes matter
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const mask = new Uint8Array(c.width * c.height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  const pieces = detectPieces(mask, c.width, c.height);
  if (pieces.length < 2) return [];
  const kx = SIZE / c.width, ky = SIZE / c.height;
  return pieces.map(pts => pts.map(q => ({ x: q.x * kx, y: q.y * ky })));
}

// ---------- template intelligence (zones / decals) ----------
// Kits also carry turned-off helper layers. "Sponsor Blocks" and "Number
// Blocks" (or "Sponsor", "Numbers") are filled boxes where decals officially
// go. "Car_decal", "Color Change Logos" or "IMSA LOGOS" hold the kit's stock
// decals, and which way up those read says which way up each panel is.
// ag-psd gives turned-off layers their pixels too.

// 'sponsor', 'number' or null for a layer name; "leaderboard" and "official"
// layers are the same number boxes for other series
const zoneKind = (name) => (/sponsor/i.test(name) ? 'sponsor'
  : /number/i.test(name) && !/leaderboard|official/i.test(name) ? 'number' : null);
const DECAL_RE = /(decal|logos?)\b/i;

// the sponsor and number boxes: one per separate block on those layers,
// blocks under 300 px² dropped as crumbs
function extractZones(entries, w, h) {
  return ['sponsor', 'number'].flatMap((kind) => {
    const layers = entries.map(e => e.layer).filter(l => zoneKind(l.name || '') === kind);
    if (!layers.length) return [];
    const img = stack(layers, w, h).getContext('2d').getImageData(0, 0, w, h);
    return alphaComponents(img, 300).map(r => ({ kind, x: r.x, y: r.y, w: r.w, h: r.h }));
  });
}

// The car's extra colours: iRacing colours parts beyond the paint from small
// solid squares on the sheet, each on a layer named for the part: "Pitbox
// Colors", the MX5's "Cockpit Color", "Rollbar Color", the IndyCar's wraps.
// The pit box is found by name, as some kits turn it off; any other layer
// that is showing, outside the kit's "Turn Off" group, and holds nothing but
// such squares counts too. One per square, its colour from its middle pixel,
// in 2048-sheet space, named for its layer.
const SQUARE_MAX = 72; // longest side, in sheet px: pit box strips run to 66 x 24; the Mustang's 108 x 561 "Cockpit Banner" is a panel
const PITBOX_RE = /pit\s*box/i;
const NOT_SQUARES_RE = /pit\s*board|name\s*plate|mandatory|licen[cs]e/i;
// areas iRacing shows in, by outline, under the livery: the pitboard (where the
// board's picture goes; the Mustang's is four blocks round the windscreen) and
// the Mustang's windscreen name plate. One per block; colour null: the kit's.
const AREA_KINDS = [[/pit\s*board/i, 'Pitboard', '#ffffff'], [/name\s*plate/i, 'Name plate', null]];
// "Rollbar Color" → "Rollbar", "Wheel Rings (Garage Option)" → "Wheel Rings"
const partName = (name) => name.replace(/\(.*?\)|\bcolou?rs?\b/ig, '').replace(/[_\s]+/g, ' ').trim() || 'Colour';
const hex = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
function extractSwatches(entries, w, h) {
  const kx = SIZE / w, ky = SIZE / h;
  const out = [];
  const add = (img, found, name, dx = 0, dy = 0) => found.forEach((r, k) => out.push({
    name: found.length > 1 ? `${name} ${k + 1}` : name,
    x: Math.round((r.x + dx) * kx), y: Math.round((r.y + dy) * ky), w: Math.round(r.w * kx), h: Math.round(r.h * ky),
    color: hex(img.data, ((r.y + (r.h >> 1)) * img.width + r.x + (r.w >> 1)) * 4),
  }));
  const pit = entries.filter(e => PITBOX_RE.test(e.layer.name || '')).map(e => e.layer);
  if (pit.length) {
    const img = stack(pit, w, h).getContext('2d').getImageData(0, 0, w, h);
    add(img, alphaComponents(img, 4, 127), 'Pit box');
  }
  for (const e of entries) {
    const name = e.layer.name || '', c = e.layer.canvas;
    if (e.hidden || e.kit || e.wire || !c.width || !c.height || PITBOX_RE.test(name) || NOT_SQUARES_RE.test(name) || zoneKind(name) || DECAL_RE.test(name)) continue;
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const found = alphaComponents(img, 4, 127);
    if (found.length && found.every(r => Math.max(r.w * kx, r.h * ky) <= SQUARE_MAX && r.area >= 0.8 * r.w * r.h)) add(img, found, partName(name), e.layer.left || 0, e.layer.top || 0);
  }
  for (const [re, name, color] of AREA_KINDS) {
    const layers = entries.filter(e => re.test(e.layer.name || '')).map(e => e.layer);
    if (!layers.length) continue;
    const px = stack(layers, w, h).getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    const found = detectPieces(mask, w, h);
    found.forEach((pts, k) => {
      const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
      const mid = (Math.round((Math.min(...ys) + Math.max(...ys)) / 2) * w + Math.round((Math.min(...xs) + Math.max(...xs)) / 2)) * 4;
      const points = pts.map(q => ({ x: Math.round(q.x * kx), y: Math.round(q.y * ky) }));
      const x = Math.round(Math.min(...xs) * kx), y = Math.round(Math.min(...ys) * ky);
      out.push({ name: found.length > 1 ? `${name} ${k + 1}` : name, x, y, w: Math.round(Math.max(...xs) * kx) - x, h: Math.round(Math.max(...ys) * ky) - y, points, color: color || hex(px, mid) });
    });
  }
  return out;
}

// the stock decals that are showing, in place; the turned-off ones are the
// same decals for other series and would count each decal twice
function extractDecals(entries, w, h) {
  const shown = entries.filter(e => !e.hidden && DECAL_RE.test(e.layer.name || '') && !zoneKind(e.layer.name || ''));
  return shown.length ? stack(shown.map(e => e.layer), w, h) : null;
}

// A template file → {
//   src: the wireframe on white as a PNG data URL (the whole picture when no
//     layer is named as wireframe; usedWireframe says which),
//   pieces: outlines of the sheet's pieces, from the wireframe ([] without one),
//   wire: the wireframe layers on a clear canvas (only with a wireframe),
//   zones: [{ kind: 'sponsor' | 'number', x, y, w, h }] ([] without block layers),
//   decals: the stock decals on a canvas, to read which way panels face (or null),
//   swatches: [{ name, x, y, w, h, color, points? }]: the car's extra colour
//     squares, and the pitboard by its outline ([] when the kit has none) }
export async function psdToTemplate(arrayBuffer) {
  return templateOf((await psdReader()).readPsd(arrayBuffer));
}
// The same from a GIMP file, reading the pixels of only the layers a template
// uses (or, with no wireframe, of what is shown, for the flattened picture)
export async function xcfToTemplate(buf) {
  const wire = hasWire((await readXcf(buf, { keep: () => false })).children);
  // a layer small enough to hold only colour squares is read too (see extractSwatches)
  const used = (x) => WIRE_RE.test(x.name) || zoneKind(x.name) || /pit\s*box|pit\s*board|name\s*plate/i.test(x.name) || DECAL_RE.test(x.name) || (!x.hidden && x.w * x.h <= 512 * 512);
  return templateOf(withCanvases(await readXcf(buf, { keep: (n, up) => {
    const all = [n, ...up];
    return !all.some(x => PATTERN_RE.test(x.name)) && (wire ? all.some(used) : !all.some(x => x.hidden));
  } })));
}
function templateOf(psd) {
  const { width: w, height: h } = psd;
  const sheet = blank(w, h);
  const g = sheet.getContext('2d');
  g.fillStyle = '#fff'; // white, so laid over the livery in multiply only the lines show
  g.fillRect(0, 0, w, h);
  const named = flatLayers(psd.children, true);
  const wires = named.filter(e => e.wire);
  // the helper layers are looked for without the name skip, which would drop "Color Change Logos"
  const every = flatLayers(psd.children, false);
  let extras = { zones: [], decals: null, swatches: [] };
  try {
    extras = { zones: extractZones(every, w, h), decals: extractDecals(every, w, h), swatches: extractSwatches(every, w, h) };
  } catch { /* extras only: the template opens without them */ }
  const png = () => sheet.toDataURL('image/png');
  if (wires.length) {
    paint(g, wires);
    return { src: png(), usedWireframe: true, pieces: wirePieces(psd, wires), wire: wireCanvas(psd, wires), ...extras };
  }
  // nothing named as wireframe: the whole picture, as it shows
  if (psd.canvas) g.drawImage(psd.canvas, 0, 0);
  else paint(g, named.filter(e => !e.hidden));
  return { src: png(), usedWireframe: false, pieces: [], ...extras };
}

// layers drawn at their place and opacity
function paint(g, entries) {
  for (const { layer } of entries) {
    g.globalAlpha = layer.opacity ?? 1;
    g.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
  g.globalAlpha = 1;
}

// ---------- a livery PSD as layers ----------
// Someone's finished livery in Photoshop, as picture layers: every pixel
// layer, in order (hidden ones come in hidden: a layer left on or off by
// mistake can then be put right here), with its opacity, its layer mask and its clipping
// baked into its pixels. The kit's own helper layers are left out (Overspray
// makes the pit box and pitboard itself). The spec map comes as one picture.
const SKIP_GROUP_RE = /turn\s*off/i;
const SPEC_RE = /spec\s*map/i; // the kit's "Custom Spec Map" group
const PATTERN_RE = /car[\s_]*patterns?/i; // iRacing's stock designs (a group of them, or one): never painted in, so left out
const SKIP_LAYER_RE = /pit\s*box|pit\s*board|^(wire|mask)$|(sponsor|number)\s*blocks|car[\s_]*mandatory/i;
// hidden kit extras, as a template import leaves them: alt-series decals
const KIT_HIDDEN_RE = /decal|logos?\b/i;
// what the import leaves out: a layer, or a group with all in it (hidden: it, or a group it is in, is turned off)
const leftOut = (name, hidden, group) => (group ? SKIP_GROUP_RE : SKIP_LAYER_RE).test(name) || (hidden && KIT_HIDDEN_RE.test(name));

// a layer's pixels with its mask's grey as their alpha
function masked(c, l, m) {
  const out = blank(c.width, c.height);
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
  const out = blank(c.width, c.height);
  const g = out.getContext('2d');
  g.drawImage(c, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(base.canvas, base.left - (l.left || 0), base.top - (l.top || 0));
  return out;
}

// → { layers: [{ name, canvas, x, y, scale, scaleY, opacity, blend, group }]
//     bottom first, x/y the centre in 2048-sheet space, visible as in the PSD; group: the PSD group
//     it was in (not the kit's "Paintable Area"), or null,
//     lost: { fx, blend, text, hidden, patterns }: how many came in without effects, with a
//     blend Overspray does not have (as normal), as a picture of their text, or turned off;
//     patterns: a stock pattern that was showing was left out },
//     kit: it has the kit's wireframe, so it can be the template too,
//     spec: the spec map group's shown layers as one canvas the file's size, or null }
export async function psdToLayers(arrayBuffer) {
  return layersOf((await psdReader()).readPsd(arrayBuffer));
}
// The same from a GIMP file: only the layers that come in have their pixels read
export async function xcfToLayers(buf) {
  return layersOf(withCanvases(await readXcf(buf, { keep: (n, up) => {
    let off = false;
    for (const g of [...up, n]) {
      if (g !== n && SPEC_RE.test(g.name)) return !n.hidden; // the spec map is read, though its group is hidden
      off = off || g.hidden;
      if (PATTERN_RE.test(g.name) || leftOut(g.name, off, g !== n)) return false;
    }
    return true;
  } })));
}
function layersOf(psd) {
  const kx = SIZE / psd.width, ky = SIZE / psd.height;
  const layers = [], lost = { fx: 0, blend: 0, text: 0, hidden: 0, patterns: false };
  const shownIn = (ls) => ls.some(c => !c.hidden && (c.children ? shownIn(c.children) : true));
  const showing = (ls) => ls.flatMap(c => c.hidden ? [] : c.children ? showing(c.children) : c.canvas ? [c] : []);
  const specs = [];
  const walk = (children, group, opacity, off) => {
    let base = null; // what a clipping layer clips to: { canvas, left, top, hidden }, or 'off' when it was left out
    for (const l of children || []) {
      const name = l.name || '';
      const hidden = off || !!l.hidden;
      if (!l.clipping) base = 'off';
      if (l.clipping && base === 'off') continue;
      if (PATTERN_RE.test(name)) { if (!hidden && shownIn([l])) lost.patterns = true; continue; }
      if (l.children && SPEC_RE.test(name)) { specs.push(...showing(l.children)); continue; } // ponytail: masks and blends in it are not applied
      if (l.children) {
        base = null; // what clips to a group comes in unclipped
        if (!leftOut(name, hidden, true)) walk(l.children, /paintable/i.test(name) ? group : name, opacity * (l.opacity ?? 1), hidden);
        continue;
      }
      if (!l.canvas || leftOut(name, hidden, false)) continue;
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
        const s = blank(Math.max(1, Math.round(c.width * kx)), Math.max(1, Math.round(c.height * ky)));
        const g = s.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(c, 0, 0, s.width, s.height);
        c = s; scale = 1; scaleY = null;
      }
      layers.push({ name: name || 'Layer', canvas: c, x, y, scale, scaleY, opacity: opacity * (l.opacity ?? 1), blend, group, visible: shown });
    }
  };
  walk(psd.children, null, 1, false);
  let spec = null;
  if (specs.length) {
    spec = blank(psd.width, psd.height);
    const g = spec.getContext('2d');
    for (const l of specs) { g.globalAlpha = l.opacity ?? 1; g.drawImage(l.canvas, l.left || 0, l.top || 0); }
  }
  return { layers, lost, kit: hasWire(psd.children), spec };
}

// made from a kit: it has the kit's wireframe layer (named as flatLayers finds it)
function hasWire(ls, under = false) {
  return (ls || []).some(l => !SKIP_RE.test(l.name || '') && (l.children ? hasWire(l.children, under || WIRE_RE.test(l.name || '')) : under || WIRE_RE.test(l.name || '')));
}

// readXcf's tree as ag-psd has its own: pixels and masks on canvases
function canvasOf(w, h, rgba) {
  const c = blank(w, h);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return c;
}
function withCanvases(n) {
  for (const l of n.children || []) {
    if (l.image) l.canvas = canvasOf(l.image.w, l.image.h, l.image.rgba);
    delete l.image; // its bytes are on the canvas now
    if (l.mask) {
      const { w, h, data } = l.mask, g = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) { g[i * 4] = g[i * 4 + 1] = g[i * 4 + 2] = data[i]; g[i * 4 + 3] = 255; }
      l.mask.canvas = canvasOf(w, h, g);
    }
    withCanvases(l);
  }
  return n;
}
