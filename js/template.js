// Reading an iRacing template into what a livery doc needs: the linework
// picture and a region map of the sheet's pieces and the
// kit's number / sponsor zones. No page elements in here.
//
// (It began as the page-free half of the original screen's template handler.)

import { loadImage, SIZE } from './engine.js';
import { psdToTemplate, xcfToTemplate } from './psd.js';
import { createRegionMap, piecesRegionMap, uniqueRegionId, mapFit } from './regions.js';
import { zonesToRegions, inferDecalPairs, applyOrientation } from './zones.js';

// What the kit knows, merged into a region map (made if there is none).
// Pieces go in once: a map that already has outlined regions keeps them, so
// reloading a template never disturbs pieces that have since been named,
// paired, linked or given a centreline. The kit's zones replace the previous
// kit's zones; hand-drawn regions stay.
// decalData: ImageData of the kit's stock decals, for zone orientation.
// → { map, pieces, zones } (counts of what was added)
export function templateRegions(map, { pieces = [], zones = [], decalData = null } = {}, carName) {
  let nPieces = 0;
  if (pieces.length && !(map && map.regions.some(r => r.points))) {
    if (!map) map = createRegionMap(carName || 'template car');
    const fresh = piecesRegionMap(carName, pieces).regions;
    for (const r of fresh) r.id = uniqueRegionId(r.id, map);
    map.regions.unshift(...fresh);
    nPieces = fresh.length;
  }
  if (!zones.length) return { map, pieces: nPieces, zones: 0 };
  if (!map) map = createRegionMap(carName || 'template car');
  const kept = map.regions.filter(r => !r.kind);
  for (const r of kept) {
    if (r.mirror && !kept.some(o => o.id === r.mirror)) { delete r.mirror; delete r.mirrorKind; }
  }
  // a map that was nothing but the previous kit's zones takes the new kit's name
  if (!kept.length && carName) map.car = carName;
  map.regions = kept;
  const { regions, axis } = zonesToRegions(zones, map);
  if (decalData) {
    try { applyOrientation(regions, inferDecalPairs(decalData, { axis }), axis); } catch { /* geometric default stays */ }
  }
  map.regions.push(...regions);
  return { map, pieces: nPieces, zones: regions.length };
}

// psd.js fetches its reader relative to the *page*, which only works from the
// site root. Load it relative to this file first so any page can read PSDs.
function ensurePsdReader() {
  if (window.agPsd) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/ag-psd.min.js', import.meta.url).href;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the PSD reader'));
    document.head.appendChild(s);
  });
}

// The wireframe as one picture on white, in two strengths: the kit's coloured
// lines (panel borders and seams; green in iRacing's kits) in black, and its
// white lines (the car's mesh, which also carries door gaps, handles and any
// panel edge the kit did not colour) in grey. Read back as "how far from
// white", that gives strong borders and a fainter mesh from a single picture.
export const MESH_GREY = 168;
function linesPicture(wire) {
  const ctx = wire.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, wire.width, wire.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i + 3] < 128 ? 255 : Math.min(px[i], px[i + 1], px[i + 2]) > 200 ? MESH_GREY : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = wire.width; c.height = wire.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const fileToDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// A kit picture as kept in the livery: cut to what is drawn on it and brought
// to sheet size, as a PNG with where it sits → { src, x, y, w, h }, or null
// when nothing is drawn
function kitPicture(c) {
  const k = SIZE / c.width, px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (px[(y * c.width + x) * 4 + 3] < 8) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const x = Math.floor(x0 * k), y = Math.floor(y0 * k), w = Math.ceil((x1 + 1) * k) - x, h = Math.ceil((y1 + 1) * k) - y;
  const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
  out.getContext('2d').drawImage(c, x0, y0, x1 + 1 - x0, y1 + 1 - y0, 0, 0, w, h);
  return { src: out.toDataURL('image/png'), x, y, w, h };
}
// the template's kit decals and boxes as the livery keeps them (see psd.js
// extractKit) → { sets: [{ name, src, x, y, w, h }], boxes } or null
function kitOf(kit) {
  if (!kit) return null;
  const sets = kit.sets.map(s => { const p = kitPicture(s.canvas); return p && { name: s.name.slice(0, 60), ...p }; }).filter(Boolean);
  const boxes = kit.boxes ? kitPicture(kit.boxes) : null;
  return sets.length || boxes ? { sets, boxes } : null;
}

// file: a template PSD or GIMP file (pieces and zones are read from it) or a plain
// picture (linework only). map: the doc's current region map, or null.
// fit: how well the map already there matches this template's panels (see
// mapFit), or null when there was nothing to compare
// → { template: { img, src }, regionMap, pieces, zones, carName, fit, swatches, kit (see kitOf) }
export async function loadTemplate(file, map = null) {
  const carName = file.name.replace(/\.[^.]+$/, '');
  if (!/\.(psd|xcf)$/i.test(file.name)) {
    const src = await fileToDataURL(file);
    return { template: { img: await loadImage(src), src }, regionMap: map, pieces: 0, zones: 0, carName, fit: null, swatches: [], kit: null };
  }
  const xcf = /\.xcf$/i.test(file.name);
  if (!xcf) await ensurePsdReader();
  const res = await (xcf ? xcfToTemplate : psdToTemplate)(await file.arrayBuffer());
  let decalData = null;
  if (res.decals) {
    try { decalData = res.decals.getContext('2d').getImageData(0, 0, res.decals.width, res.decals.height); } catch { /* no orientation hints */ }
  }
  const fit = mapFit(map, piecesRegionMap(carName, res.pieces));
  const merged = templateRegions(map, { pieces: res.pieces, zones: res.zones, decalData }, carName);
  const src = res.wire ? linesPicture(res.wire) : res.src;
  return {
    template: { img: await loadImage(src), src },
    regionMap: merged.map, pieces: merged.pieces, zones: merged.zones, carName, fit, swatches: res.swatches || [], kit: kitOf(res.kit),
  };
}
