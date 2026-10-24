// Overspray: the state, the canvas, and what the menus do.
// The refresh, built in stages on the existing plumbing (../js). Stage 1: load
// a template, show the pieces, an exact base colour, open projects from the
// original screen, save to iRacing. Stage 2: shapes you draw and keep editing
// (./tools.js), with exact colours. Stage 3: Map mode (./map.js) and the
// tools that work from the map: fill a panel, trim to panels, mirror.
// Stage 4: text and pictures (logos). Stage 5: Finish mode (../js/finish.js):
// finishes by colour, by layer, or by a drawn area.

import {
  SIZE, GOOGLE_FONTS, createDoc, renderPaint, renderSpec, buildDragCache, renderPaintWithDrag,
  serializeDoc, deserializeDoc, regenerateText, textFont, TEXT_FONTS, layerCorners, layerMatrix, newId,
  createTextLayer, createImageLayer, createFillLayer, loadImage, registerCustomFont, paintLayers,
  MATERIALS, fadeStyleOf, cleanCredits, cleanRepeat, readPalettes,
} from '../js/engine.js';
import { canvasToTGA, decodeTGA } from '../js/tga.js';
import * as persist from '../js/persist.js';
import { loadTemplate } from '../js/template.js';
import { psdToLayers, xcfToLayers } from '../js/psd.js';
import { saveToIracing, paintFilenames, validCustid, exportPaintCanvas, paintsDir, carFolders, isPaintsFolder, matchCar } from '../js/iracing.js';
import { initUI } from './ui.js';
import * as maplib from './maplib.js';
import { hexToRgb } from './picker.js';
import { initTools, isShape, isBox, moveLayer, setShape, fadeEnds, hasFade, hasAim } from './tools.js';
import { moved, joined, boxOutline, placed, pieces, SHAPES, hasInner, outerOnly, wrapped, bounds as shapeBounds, mapped as shapeMapped } from '../js/shapes.js';
import { searchIcons, iconShape, svgToShape } from './icons.js';
import { traceImage, paintColours, specAreas } from '../js/trace.js';
import { finishSpec, finishList, withFinishes, setRule, clearRule, ruleFor, layerColour, layerColours, isArea, hasOwnFinish, readFinish, writeFinish, presetOf, FINISHES, SPARKLE, liverySparkle, oneSparkle } from '../js/finish.js';
import { initMap, syncGuide, guideLayer, pairList, setGuidePink } from './map.js';
import { initCarGradient } from './cargrad.js';
import { mirrorLayer, mirrorImage, withMirrors, withSeams, seamsOf } from '../js/mirror.js';
import { pointInPolygon, regionOutline, parseRegionMap, mapFit, regionById, renameRegion, setMirror, addTwins, setMirrorKind, MIRROR_NAMES } from '../js/regions.js';

// what needs the template's panels says so, greyed out, until one is loaded
const NEEDS_TEMPLATE = 'Open a blank template first';
const needTemplate = () => { if (app.doc.template) return false; ui.say(NEEDS_TEMPLATE, true); return true; };
export const VERSION = self.VERSION || 'unknown'; // from version.js, which the page loads first

const $ = (id) => document.getElementById(id);
const cv = $('view');
const ctx = cv.getContext('2d');

export const app = {
  doc: null,
  view: { x: 0, y: 0, zoom: 0.3 },   // screen = (doc + offset) * zoom
  mode: 'paint',
  tool: 'select',
  sel: 'base',                        // a layer id, 'base', or null
  sels: [],                           // every selected layer's id when there are several (it includes sel)
  // the template's own linework already draws every piece's border, so the
  // computed piece outlines start off here; they are Map mode's to show
  show: { start: true, layers: true, props: true, outlines: false, lines: true, mesh: true },
  custid: '',
  live: false,
  liveBad: false,                     // the last live save failed
  projectId: null,                    // browser project autosave writes through to
  canUndo: false,
  canRedo: false,
  theme: 'system',
  colour: '#111214',                  // what the next new shape is filled with
  clipboard: null,                    // a copied layer
  shapeKind: 'ellipse',               // which ready-made shape the Shape tool draws
  shapeMenu: false,                   // its row of shapes is open: from its button until one is picked or drawn
  bandWidth: 60,                      // px on the sheet
  stamp: { key: 'star', size: 120 },  // what the Stamp tool places: a shape's key (see motifOf) and its size on the sheet
  trimming: false,                    // clicks on the sheet choose the selected layer's panels
  board: null,                        // the pitboard picked in Car extras: { p (its swatch), had (layer ids then) }; what is added since stays inside it
  piece: null,                        // Map mode: the selected panel's id
  centreFor: null,                    // Map mode: the panel a centreline is being set on, if fixed
  mapShow: { colours: true },         // Map mode: panel colours and names over the sheet
  pairOpen: null,                     // Pair panels: the list's open row, { key, ids (one panel, or the two being checked) }
  pairHover: null,                    // Pair panels: ids of the row under the pointer
  font: 'Arial Black',                // what the next new text is set in
  // Finish mode: what the next finish applies to —
  // { kind: 'colour', colour, layerId? } | { kind: 'layer', id } | { kind: 'area', id }
  ftarget: null,
  fmore: [],                          // more targets picked with Ctrl or Shift: a change to ftarget's finish goes on them too
  finishKind: 'matte',                // the finish a newly drawn area starts with
  // the shared map library's admin, if signed in: { key, login }; asked for
  // only when the page is opened with ?admin, so nobody else sees it
  admin: null,
  adminAsk: /[?&]admin\b/.test(location.search),
  // a shared map being reviewed: { pr, prev (this livery's own map, put
  // back after), old, next (the maps; old is null for a new car), text, side }
  review: null,
};
let ui = null, tools = null, mapTools = null, carGrad = null;
// who the pointer talks to (a car line being drawn on the sheet: the car gradient window)
const onSheet = () => (app.mode === 'map' ? mapTools : carGrad && carGrad.drawing() ? carGrad : tools);

// ---------- the doc ----------

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// template linework has to read against the base coat it sits on
// how strongly the template's inner linework shows; this screen sets it, not
// the doc (the original screen's per-project opacity suited its dark canvas)
// The template's lines for the screen, as two pictures in a tone that reads
// against the base coat: the panel lines (strong ink in the template picture,
// thickened a little) and the mesh (faint ink; see js/template.js). Each is
// made only while it is switched on, and the template picture is let go once
// they are made (16 MB decoded): it is decoded again only to make one that was
// off. A new tone recolours them in place.
let lineCache = { src: null, dark: null, borders: null, mesh: null };
let lineLoad = null; // the template being decoded for them
function templateLines(doc) {
  const t = doc.template, dark = luminance(doc.baseColor) > 0.5, tone = dark ? '#101114' : '#ffffff';
  if (lineCache.src !== t.src) lineCache = { src: t.src, dark, borders: null, mesh: null };
  if (!app.show.lines) lineCache.borders = null;
  if (!app.show.mesh) lineCache.mesh = null;
  if (lineCache.dark !== dark) {
    for (const c of [lineCache.borders, lineCache.mesh]) {
      if (!c) continue;
      const g = c.getContext('2d');
      g.globalCompositeOperation = 'source-in'; g.fillStyle = tone; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
    }
    lineCache.dark = dark;
  }
  const want = { borders: app.show.lines && !lineCache.borders, mesh: app.show.mesh && !lineCache.mesh };
  if (!want.borders && !want.mesh) return lineCache;
  if (!t.img) {
    if (lineLoad !== t.src) {
      const src = lineLoad = t.src;
      loadImage(src).then((img) => { if (app.doc.template && app.doc.template.src === src) { app.doc.template.img = img; lineLoad = null; requestDraw(); } }, () => { /* left without lines; not tried again */ });
    }
    return lineCache;
  }
  const img = t.img, w = img.width, h = img.height;
  const read = document.createElement('canvas');
  read.width = w; read.height = h;
  const rctx = read.getContext('2d', { willReadFrequently: true });
  rctx.drawImage(img, 0, 0);
  const src = rctx.getImageData(0, 0, w, h).data;
  const B = want.borders ? new ImageData(w, h) : null, M = want.mesh ? new ImageData(w, h) : null, rgb = dark ? [16, 17, 20] : [255, 255, 255];
  for (let i = 0; i < src.length; i += 4) {
    const ink = (255 - Math.min(src[i], src[i + 1], src[i + 2])) * (src[i + 3] / 255); // how far from white
    const to = ink >= 200 ? B : ink >= 40 ? M : null;
    if (to) { to.data[i] = rgb[0]; to.data[i + 1] = rgb[1]; to.data[i + 2] = rgb[2]; to.data[i + 3] = 255; }
  }
  const canvas = (data, bold) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.putImageData(data, 0, 0);
    if (!bold) return c;
    const out = document.createElement('canvas'); // a hairline is too faint at fit-to-screen zoom
    out.width = w; out.height = h;
    const og = out.getContext('2d');
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) og.drawImage(c, dx, dy);
    return out;
  };
  if (B) lineCache.borders = canvas(B, true);
  if (M) lineCache.mesh = canvas(M, false);
  t.img = null;
  return lineCache;
}
function newDoc() {
  const doc = createDoc();
  doc.baseColor = '#ffffff';
  return doc;
}

// ---------- view ----------

const screenToDoc = (sx, sy) => ({ x: sx / app.view.zoom - app.view.x, y: sy / app.view.zoom - app.view.y });
const docToScreen = (dx, dy) => ({ x: (dx + app.view.x) * app.view.zoom, y: (dy + app.view.y) * app.view.zoom });

function fit() {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  // drawing a shape: room for its window's title bar above the sheet, and the frame is told where the sheet is
  const top = app.workshop ? 66 : 0;
  app.view.zoom = Math.min(w / SIZE, (h - top) / SIZE) * (app.workshop ? 0.84 : 0.9);
  app.view.x = (w / app.view.zoom - SIZE) / 2;
  app.view.y = (top + (h - top - SIZE * app.view.zoom) / 2) / app.view.zoom;
  if (app.workshop) {
    const st = $('stage').style;
    st.setProperty('--sx', app.view.x * app.view.zoom + 'px');
    st.setProperty('--sy', app.view.y * app.view.zoom + 'px');
    st.setProperty('--ss', SIZE * app.view.zoom + 'px');
  }
  requestDraw();
}
function setZoom(z, cx = cv.clientWidth / 2, cy = cv.clientHeight / 2) {
  const before = screenToDoc(cx, cy); // keep the doc point under (cx, cy) fixed
  app.view.zoom = Math.max(0.05, Math.min(8, z));
  const after = screenToDoc(cx, cy);
  app.view.x += after.x - before.x;
  app.view.y += after.y - before.y;
  requestDraw();
}

// ---------- drawing ----------

// the paint as it goes to the car: soft edges mixed the accurate way
const paint = () => renderPaint(shown(), { linearEdges: true });
// the livery with the other side of every Mirrored layer added: what is painted
// and with every layer carrying the finish it ends up with
// A picture given a colour is painted as its own outline filled with that
// colour. The picture itself is kept, so the colour can be taken off again.
const tinted = new WeakMap(); // picture → { colour, canvas }: the last one made
function tintedImage(img, colour) {
  const had = tinted.get(img);
  if (had && had.colour === colour) return had.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tinted.set(img, { colour, canvas });
  return canvas;
}
const withTints = (doc) => (doc.layers.some(l => l.type === 'image' && l.color && l.img)
  ? { ...doc, layers: doc.layers.map(l => (l.type === 'image' && l.color && l.img ? { ...l, img: tintedImage(l.img, l.color) } : l)) }
  : doc);
const shown = () => withSeams(withMirrors(withTints(withFinishes(app.doc))));
let quick = false, quickTimer = null; // an edit is in full flow: draw fast, tidy up when it pauses
let dirty = true;       // the paint composite needs re-rendering
let composite = null;
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// ---------- the sheet's picture ----------
// Soft edges are mixed the accurate way except while something is being
// dragged or a slider pulled: that mix is too slow for every frame of a drag.
//
// A quick picture is quicker still when only one thing is changing, which is
// nearly always: everything behind it and everything in front of it is
// painted once and kept (the engine's drag cache), and each frame repaints
// only what moved. What is "moving" is found, not told: each layer is summed
// up as a string, and the layers whose string changed since the last picture
// are the moving ones. The kept parts are used only while every other
// layer's string is still what it was, so a kept picture can never be stale.
const imgIds = new WeakMap();
let imgCount = 0;
const imgId = (img) => { if (!imgIds.has(img)) imgIds.set(img, ++imgCount); return imgIds.get(img); };
// all of a layer that its paint depends on (its picture by which picture it is, not by its bytes)
const layerSig = (l) => JSON.stringify(l, (k, v) => (k === 'src' ? undefined : k === 'img' ? (v ? imgId(v) : 0) : v));
const baseSig = (doc) => `${doc.baseColor}|${doc.baseMaterial || ''}|${JSON.stringify(doc.baseMatParams || null)}`;
let seen = null; // { sigs, base } of the last picture made in full
let kept = null; // { cache, sigs, base }: the parts kept round what is moving
let accurate = false; // whether `composite` was made the accurate way
function picture(wantAccurate) {
  const doc = shown();
  dirty = false;
  accurate = wantAccurate;
  if (wantAccurate) {
    kept = null;
    seen = { sigs: doc.layers.map(layerSig), base: baseSig(doc) };
    composite = renderPaint(doc, { linearEdges: true });
    return;
  }
  const sigs = doc.layers.map(layerSig), base = baseSig(doc);
  const still = (was) => was && was.base === base && was.sigs.length === sigs.length;
  if (still(kept) && !sigs.some((sig, i) => sig !== kept.sigs[i] && !kept.cache.movingIds.has(doc.layers[i].id))) {
    composite = renderPaintWithDrag(doc, kept.cache); // only what is moving has changed
    return;
  }
  const moving = new Set();
  if (still(seen)) sigs.forEach((sig, i) => { if (sig !== seen.sigs[i]) moving.add(doc.layers[i].id); });
  const cache = moving.size ? buildDragCache(doc, moving) : null; // null: they are not next to each other in the stack, or something blends over them
  kept = cache ? { cache, sigs, base } : null;
  seen = { sigs, base };
  composite = cache ? renderPaintWithDrag(doc, cache) : renderPaint(doc, { linearEdges: false });
}

function draw() {
  if (!app.doc) return; // a resize can land before the first doc exists
  const doc = app.doc, dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (dirty || !composite) picture(!quick);

  ctx.save();
  ctx.scale(app.view.zoom, app.view.zoom);
  ctx.translate(app.view.x, app.view.y);
  ctx.save(); // the sheet lifts off the backdrop
  ctx.shadowColor = 'rgba(10, 16, 28, .3)';
  ctx.shadowBlur = 28 * dpr;
  ctx.shadowOffsetY = 6 * dpr;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(composite, 0, 0);
  if (doc.template) { // (called with both off too: that lets their pictures go)
    const L = templateLines(doc);
    if (app.show.mesh && L.mesh) { ctx.globalAlpha = 0.3; ctx.drawImage(L.mesh, 0, 0, SIZE, SIZE); }
    if (app.show.lines && L.borders) { ctx.globalAlpha = 0.85; ctx.drawImage(L.borders, 0, 0, SIZE, SIZE); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // screen space from here: lines stay hairline at any zoom
  const trace = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const q = docToScreen(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
  };
  if (app.mode === 'map') {
    if (mapTools) mapTools.drawOverlay(ctx, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f5fe0');
    $('zoom-readout').textContent = Math.round(app.view.zoom * 100) + '%';
    $('empty').hidden = !!(doc.template || doc.layers.length);
    return;
  }
  if (app.show.outlines && doc.regionMap) {
    const onLight = luminance(doc.baseColor) > 0.5;
    ctx.lineJoin = 'round';
    for (const r of doc.regionMap.regions) {
      if (!r.points || r.kind) continue; // pieces only; the kit's zones are Map mode's
      trace(regionOutline(r));
      // one solid line that contrasts with the base coat, over a soft halo of
      // the opposite tone so it still shows where paint of its own tone is
      ctx.strokeStyle = onLight ? 'rgba(255, 255, 255, .6)' : 'rgba(16, 17, 20, .6)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = onLight ? '#101114' : '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f5fe0';
  const sel = doc.layers.find(l => l.id === app.sel);
  if (sel && sel.visible && !sel.car && !(isShape(sel) && app.tool === 'select')) { // a car gradient has no box of its own // a shape shows its own outline and points
    try {
      trace(layerCorners(sel));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5; ctx.stroke();
    } catch { /* a layer with no picture yet has no box */ }
  }
  if (app.board) { // the pitboard being added to
    trace(app.board.p.points);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  }
  if (tools) tools.drawOverlay(ctx, accent);
  if (carGrad) { carGrad.drawOverlay(ctx, accent); carGrad.sync(); }
  $('zoom-readout').textContent = Math.round(app.view.zoom * 100) + '%';
  $('empty').hidden = !!(doc.template || doc.layers.length);
  showPos();
}
// the selection's top-left corner on the sheet, for the position boxes
function selCorner() {
  const ls = app.mode === 'map' ? [] : selectedLayers();
  try {
    const cs = ls.flatMap(l => layerCorners(l));
    return cs.length ? { x: Math.round(Math.min(...cs.map(q => q.x))), y: Math.round(Math.min(...cs.map(q => q.y))) } : null;
  } catch { return null; } // a layer with no picture yet has no box
}
// Two sets of boxes: in Properties' Place, and by the zoom for when
// Properties is not showing (Finish mode, drawing a shape, the panel hidden).
function showPos() {
  const at = selCorner(), inPlace = !!$('f-pos-x') && !$('f-pos-x').closest('[hidden]');
  $('pos').hidden = !at || inPlace;
  if (!at) return;
  for (const id of ['pos-x', 'pos-y', 'f-pos-x', 'f-pos-y']) {
    const box = $(id);
    if (box && document.activeElement !== box) box.value = at[id.slice(-1)]; // not under the user's typing
  }
}
document.addEventListener('change', (e) => {
  const k = /^(?:f-)?pos-([xy])$/.exec(e.target.id || '')?.[1];
  if (!k) return;
  const at = selCorner(), v = Math.round(+e.target.value);
  if (!at || !Number.isFinite(v) || !e.target.value.trim()) return showPos();
  actions.nudge(k === 'x' ? v - at.x : 0, k === 'y' ? v - at.y : 0);
});

// ---------- undo / redo ----------
// Snapshot-based, as in the original screen: one step per settled change.
// Long strings (embedded pictures) are swapped for references so 40 snapshots
// of a logo-heavy livery do not hold 40 copies of every logo.
const interned = new Map(), internedBack = [];
const pack = (data) => JSON.stringify(data, (k, v) => {
  if (typeof v !== 'string' || v.length < 1024) return v;
  let n = interned.get(v);
  if (n === undefined) { n = internedBack.push(v) - 1; interned.set(v, n); }
  return '\u0001' + n;
});
const unpack = (snap) => JSON.parse(snap, (k, v) => (typeof v === 'string' && v[0] === '\u0001' ? internedBack[+v.slice(1)] : v));

const undoStack = [], redoStack = [];
let skipCapture = false; // the save that follows an undo must not re-record it
function capture(data) {
  if (skipCapture) { skipCapture = false; return; }
  const snap = pack(data || serializeDoc(app.doc));
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  if (internedBack.length > 120) dropUnused();
  syncUndo();
}
// The long strings shared between undo steps (pictures, mostly: a text is a
// new picture every time it changes) are kept only while a step still uses
// them. Without this they piled up for as long as the page stayed open.
const MARK = new RegExp(JSON.stringify('\u0001').slice(0, -1).replace(/\\/g, '\\\\') + '(\\d+)"', 'g'); // a shared string's stand-in as it reads in a snapshot's JSON
function dropUnused() {
  const used = new Set();
  for (const snap of [...undoStack, ...redoStack]) for (const m of snap.matchAll(MARK)) used.add(+m[1]);
  if (used.size === internedBack.length) return;
  const was = internedBack.slice(), to = new Map();
  interned.clear(); internedBack.length = 0;
  for (const n of [...used].sort((a, b) => a - b)) { to.set(n, internedBack.push(was[n]) - 1); interned.set(was[n], to.get(n)); }
  const renumber = (snap) => snap.replace(MARK, (_, n) => JSON.stringify('\u0001' + to.get(+n)));
  for (const stack of [undoStack, redoStack]) stack.forEach((snap, i) => { stack[i] = renumber(snap); });
}
function syncUndo() {
  app.canUndo = undoStack.length > 1;
  app.canRedo = redoStack.length > 0;
  $('btn-undo').disabled = !app.canUndo;
  $('btn-redo').disabled = !app.canRedo;
}
let snapSeq = 0; // undo steps load their pictures at their own pace; only the last one asked for is shown
async function applySnap(snap) {
  const seq = ++snapSeq;
  const doc = await deserializeDoc(unpack(snap));
  if (seq !== snapSeq) return;
  app.doc = doc;
  app.board = null;
  if (!fixedSel() && !app.doc.layers.some(l => l.id === app.sel)) app.sel = 'base';
  syncUndo();
  change();
  skipCapture = true; // after change(), which clears it for real edits
}
function undo() {
  if (saveTimer) runSave(); // an edit made a moment ago is recorded first, so it is the step taken back
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  applySnap(undoStack[undoStack.length - 1]);
}
function redo() {
  if (saveTimer) runSave(); // likewise: an edit since the undo clears what redo would bring back
  if (!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(snap);
  applySnap(snap);
}
function resetHistory() {
  undoStack.length = redoStack.length = 0;
  skipCapture = false;
  capture();
}

// ---------- saving: history, autosave, live ----------

// Every edit ends here. panels: false when the edit came from a control in a
// panel that must not be rebuilt under the user's hand (a colour box, a slider).
// now: true for a finished, one-off action (paste, delete, a drag let go), so
// it is its own undo step instead of merging with whatever comes next.
// While a pointer is held down (a drag on the sheet, a slider being pulled)
// more of the same edit is coming. The accurate redraw, the save and Live all
// wait for it to be let go: on a livery of many layers each of those takes
// long enough that doing them between two moves of the pointer made the drag
// itself crawl.
let held = false;
window.addEventListener('pointerdown', () => { held = true; }, true);
for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, () => { held = false; }, true);
function settle() {
  if (held) { quickTimer = setTimeout(settle, 160); return; }
  quick = false; dirty = true; requestDraw();
}
// layers added while the pitboard is picked are trimmed to it
function onBoard() {
  const { p, had } = app.board;
  for (const l of app.doc.layers) {
    if (had.has(l.id)) continue;
    had.add(l.id);
    if (l.car) continue; // a car gradient is the whole car's
    // put on the sheet elsewhere (the middle of the view, say): it moves onto the board
    try {
      const cs = layerCorners(l), cx = cs.reduce((t, q) => t + q.x, 0) / cs.length, cy = cs.reduce((t, q) => t + q.y, 0) / cs.length;
      if (!pointInPolygon(p.points, cx, cy)) moveLayer(l, Math.round(p.x + p.w / 2 - cx), Math.round(p.y + p.h / 2 - cy));
    } catch { /* a layer with no picture yet stays where it is */ }
    l.clip = [p.points.map(q => ({ x: q.x, y: q.y }))];
    l.clipAt = [{ x: Math.round(p.x + p.w / 2), y: Math.round(p.y + p.h / 2) }];
  }
}
function change({ panels = true, now = false } = {}) {
  skipCapture = false; // a real edit after an undo is recorded
  oneSparkle(app.doc); // a layer pasted or brought in with another sparkle takes the livery's
  clearTimeout(quickTimer);
  quick = !panels && !now; // a drag, a slider, a nudge: more of the same is coming
  if (quick) quickTimer = setTimeout(settle, 160);
  dirty = true;
  if (app.board) onBoard();
  requestDraw();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, now ? 0 : 450);
  if (ui) panels ? ui.refresh() : ui.refreshChrome();
}

let saveTimer = null, lastJson = null, saveWarned = false;
// A map and a template "fit" when nearly all their traced panels line up
// (see mapFit); less, and the map was made for another car or for an older
// version of this car's template, so its links may land in the wrong places
const FIT_OK = 0.9;
const misfit = (fit, what) => `${what} doesn't match: only ${Math.round(fit * 100)}% of panels line up. It may be for another car, or the template has changed.`;
const MAP_FILE_MAX = 10 * 1024 * 1024; // a real map is well under 1 MB
const LIVERY_FILE_MAX = 300 * 1024 * 1024; // a big livery is tens of MB: its template and pictures
const SAVE_FAILED = 'Could not save in the browser: its storage may be full. Export TGA keeps a copy of the paint.';
function projectThumb() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(paint(), 0, 0, 128, 128);
  return c.toDataURL('image/jpeg', 0.6);
}
async function runSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (held && quick) { saveTimer = setTimeout(runSave, 300); return; } // mid-drag: once it is let go
  const data = serializeDoc(app.doc);
  if (app.workshop) { capture(data); return; } // a shape being drawn: it has undo steps, but it is never saved as the livery nor sent to the car
  const json = JSON.stringify(data); // stringify before capture, which is free to intern
  capture(data);
  if (json !== lastJson) {
    lastJson = json;
    try {
      // its own slot: the original screen's autosave is never overwritten from here
      await persist.saveBlob('next-autosave', json);
      await persist.saveSetting('next-project', app.projectId);
      if (app.projectId) await persist.saveProject(app.projectId, { name: app.doc.name, thumb: projectThumb() }, json);
      saveWarned = false;
    } catch { // quota or private mode: the livery is still on screen, so say so once and try again on the next save
      lastJson = null;
      if (!saveWarned) { saveWarned = true; ui.say(SAVE_FAILED, true); }
      liveTick();
      return false;
    }
  }
  liveTick();
}

// A live save can fail for a moment and then be fine: the sim holds the paint
// file open while it reads it. So a failed one is tried again a few times
// before Live is shown as paused; otherwise that change would never reach the
// car until the next edit.
const TRACE_PX = 1400; // Make shapes reads a picture no larger than this along its longer side: enough for a logo, and quick
// a picture's pixels, brought down to no more than `max` along its longer side → { px, w, h, k (the scale) }
function pixelsOf(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  return { px: g.getImageData(0, 0, w, h).data, w, h, k };
}
// The main colours of imported pictures saved as livery colours, so they are
// in the colour list (see paintColours). pics: [{ name, src (an image or canvas), scale, scaleY }]. → how many
function keepColours(pics) {
  const d = app.doc;
  const samples = pics.map(p => { const { px, w, h, k } = pixelsOf(p.src, 512); return { name: p.name, px, w, h, weight: p.scale * (p.scaleY ?? p.scale) / (k * k) }; });
  const found = paintColours(samples, { total: SIZE * SIZE, have: d.palette.map(c => c.color) });
  for (const c of found) d.palette.push({ id: 'c' + newId(), name: c.name || 'Colour ' + (d.palette.length + 1), color: c.color });
  return found.length;
}
// A spec map (red, green, blue: metallic, roughness, clearcoat) as Spec areas
// in a group on top: one over the whole sheet with its main finish, and one
// for each other finish in it (see specAreas). → how many
function specToAreas(src) {
  const { px, w, h } = pixelsOf(src, TRACE_PX), got = specAreas(px, w, h);
  if (!got) return 0;
  const d = app.doc, gid = 'g' + newId(), kx = SIZE / w, ky = SIZE / h, r = (v) => Math.round(v * 100) / 100;
  const area = (rgb, i) => {
    const f = writeFinish({ met: rgb[0], rough: rgb[1], clear: rgb[2] });
    return Object.assign(createFillLayer(d.baseColor), { name: 'Spec ' + i, specOnly: true, finishOwn: true, material: f.material, matParams: f.params, groupId: gid }); // the base coat's colour: no new colour in the colour list
  };
  const made = [Object.assign(area(got.base, 1), { rx: 0, ry: 0, rw: SIZE, rh: SIZE }), ...got.areas.map((a, i) => {
    const s = area(a.rgb, i + 2);
    s.shape = 'path';
    setShape(s, shapeMapped(a.pts, (q) => ({ x: r(q.x * kx), y: r(q.y * ky) })));
    return s;
  })];
  d.groups = [...(d.groups || []), { id: gid, name: 'Spec map', collapsed: true }];
  d.layers.push(...made);
  return made.length;
}
const LIVE_RETRIES = 5;
let liveBusy = false, liveAgain = false, liveRetry = null;
async function liveTick(attempt = 0) {
  clearTimeout(liveRetry);
  if (!app.live || app.workshop) return; // a shape being drawn is not the livery
  if (liveBusy) { liveAgain = true; return; }
  liveBusy = true;
  let res;
  try {
    // the car gets the accurate picture; if the screen's is that already, it is not made a second time
    if (dirty || !accurate || !composite) { picture(true); requestDraw(); }
    res = await saveToIracing(shown(), app.custid, { quiet: true, paint: () => (!dirty && accurate ? composite : null) }); // asked for when it is needed: the sheet may have been redrawn while the folder was being reached
  } catch (err) { // a drawing error must not leave Live busy for good, skipping every later edit
    res = { ok: false, error: err && err.message };
  }
  liveBusy = false;
  if (liveAgain) { liveAgain = false; liveTick(); return; } // a newer change is waiting: send that
  if (!res.ok && attempt < LIVE_RETRIES) { liveRetry = setTimeout(() => liveTick(attempt + 1), 400); return; }
  if (app.liveBad !== !res.ok) {
    app.liveBad = !res.ok;
    if (!res.ok) ui.say(`Live paused${res.error ? ': ' + res.error.replace(/\.$/, '') : ''}. Click Live to reconnect.`, true);
    ui.refreshChrome();
  }
}

// ---------- fonts ----------
// text layers are pictures of text; a Google font has to be on the page
// before they can be re-drawn in it
const fontLoads = new Map(), fontReady = new Set();
const isWebFont = (f) => GOOGLE_FONTS.includes(f) || (app.doc.googleFonts || []).includes(f);
const cssUrl = (family, faces) => 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + (faces ? ':' + faces : '') + '&display=swap';
const addCss = (href) => new Promise((done) => {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href;
  link.onload = () => done(true); link.onerror = () => { link.remove(); done(false); };
  document.head.appendChild(link);
});
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
// What Google has of a font: { weights, italics } (the weights it comes in,
// and those of them it has a real italic for). Google's service only sends
// the weights it is asked for and refuses a request that names one the font
// lacks, so each is tried: at most twenty small requests, once for a font,
// then kept in this browser.
let fontFaces = {};
try { fontFaces = JSON.parse(localStorage.getItem('next-fontfaces') || '{}') || {}; } catch { /* asked for again */ }
const facesAsked = new Map();
function findFaces(family) {
  if (fontFaces[family]) return Promise.resolve(fontFaces[family]);
  if (facesAsked.has(family)) return facesAsked.get(family);
  const has = async (faces) => { try { return (await fetch(cssUrl(family, faces))).ok; } catch { return null; } };
  const p = (async () => {
    let info;
    if (await has('ital,wght@0,100..900;1,100..900')) info = { weights: WEIGHTS, italics: WEIGHTS, range: 'ital,wght@0,100..900;1,100..900' };
    else if (await has('wght@100..900')) info = { weights: WEIGHTS, italics: [], range: 'wght@100..900' };
    else {
      const got = await Promise.all(WEIGHTS.map((w) => has('wght@' + w)));
      if (got.every((g) => g === null)) return null; // not reachable: try again another time
      const weights = WEIGHTS.filter((w, i) => got[i]);
      const slant = await Promise.all(weights.map((w) => has('ital,wght@1,' + w)));
      info = { weights, italics: weights.filter((w, i) => slant[i]) };
    }
    fontFaces[family] = info;
    try { localStorage.setItem('next-fontfaces', JSON.stringify(fontFaces)); } catch { /* kept for this visit only */ }
    return info;
  })();
  facesAsked.set(family, p);
  p.then((info) => { if (!info) facesAsked.delete(family); });
  return p;
}
// every face of a family in one stylesheet: the browser fetches a face's file only when something is drawn in it
const allFaces = (info) => info.range || (info.italics.length
  ? 'ital,wght@' + [...info.weights.map((w) => '0,' + w), ...info.italics.map((w) => '1,' + w)].join(';')
  : 'wght@' + info.weights.join(';'));
// Puts a Google font on the page, in the weight and slant a layer asks for.
// → true once it can be drawn with, false if Google has no such font (its
// names are case-sensitive) or it is unreachable.
function loadWebFont(family, weight = null, italic = false) {
  const key = `${family}|${weight || ''}|${italic ? 'i' : ''}`;
  if (fontLoads.has(key)) return fontLoads.get(key);
  const face = textFont({ font: family, fontWeight: weight, italic });
  const p = (async () => {
    if (!weight && !italic) { // the font as it comes: also how a name is checked
      if (!await addCss(cssUrl(family))) return false;
    } else {
      const info = await findFaces(family);
      if (!info || !info.weights.length) return false;
      if (!fontLoads.has(family + '|all')) fontLoads.set(family + '|all', addCss(cssUrl(family, allFaces(info))));
      if (!await fontLoads.get(family + '|all')) return false;
    }
    try { await document.fonts.load(face); } catch { return false; }
    return document.fonts.check(face);
  })();
  fontLoads.set(key, p);
  p.then((ok) => { if (ok) fontReady.add(key); else fontLoads.delete(key); }); // a miss may be retried later
  return p;
}
// every text layer whose font is not on the page yet gets it, and is drawn again when it arrives
function ensureDocFonts() {
  const wanted = new Map();
  for (const l of app.doc.layers) if (l.type === 'text' && isWebFont(l.font)) wanted.set(`${l.font}|${l.fontWeight || ''}|${l.italic ? 'i' : ''}`, l);
  for (const [key, like] of wanted) {
    if (fontReady.has(key)) continue;
    loadWebFont(like.font, like.fontWeight || null, !!like.italic).then((ok) => {
      if (!ok) return;
      let touched = false;
      for (const l of app.doc.layers) if (l.type === 'text' && `${l.font}|${l.fontWeight || ''}|${l.italic ? 'i' : ''}` === key) { regenerateText(l); touched = true; }
      if (touched) { dirty = true; requestDraw(); }
    });
  }
}

// ---------- what the menus do ----------

// the name a palette gives its base coat colour: it goes on the base coat when used
const BASE_COAT = 'Base coat';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safeName = () => (app.doc.name || 'livery').replace(/[^\w.-]+/g, '_');

async function setDoc(doc, projectId) {
  await flush();
  if (tools) tools.cancel();
  if (mapTools) mapTools.cancel();
  app.piece = app.centreFor = null;
  app.trimming = false;
  app.doc = doc;
  if (!doc.template && app.mode === 'map') actions.setMode('paint'); // Map is greyed out with no template
  oneSparkle(doc); // an older livery could have a different sparkle on each layer: they all take the first one's
  app.projectId = projectId;
  app.sel = 'base';
  lastJson = null;
  ensureDocFonts();
  fit();
  resetHistory();
  change();
}
// lands any pending edit in its own project before the doc is swapped
const flush = () => (saveTimer ? runSave() : Promise.resolve());

// Every selected layer, back to front. `sels` only counts while it holds the
// primary selection, so code that just sets app.sel never leaves a stale set.
// Finish mode's pick. how: none = t alone; 'add' = t joins (and leads) or leaves;
// 'range' = every row of the Finishes list from the lead to t
const fkey = (t) => t.kind + ':' + (t.kind === 'colour' ? t.colour : t.id);
function pickFinish(t, how) {
  const lead = app.ftarget, list = finishList(app.doc);
  const a = lead ? list.findIndex(f => fkey(f) === fkey(lead)) : -1, b = t ? list.findIndex(f => fkey(f) === fkey(t)) : -1;
  if (how === 'range' && a !== -1 && b !== -1) {
    app.fmore = list.slice(Math.min(a, b), Math.max(a, b) + 1).filter((_, i) => i + Math.min(a, b) !== a)
      .map(f => f.kind === 'colour' ? { kind: 'colour', colour: f.colour } : { kind: f.kind, id: f.id });
    return;
  }
  if (!how || !lead || !t) { app.ftarget = t; app.fmore = []; return; }
  const all = [lead, ...app.fmore], i = all.findIndex(x => fkey(x) === fkey(t));
  if (i === -1) all.unshift(t); else all.splice(i, 1);
  app.ftarget = all[0] || null; app.fmore = all.slice(1);
}

// the car's extra colour a selection names ('sw0', 'sw1', …), or null
const swatchAt = (id) => /^sw\d+$/.test(id || '') ? (app.doc.swatches || [])[+id.slice(2)] || null : null;
// the base coat or an extra colour: a colour of the livery's, not a layer
const fixedSel = () => app.sel === 'base' || !!swatchAt(app.sel);

function selectedLayers() {
  const ids = app.sels.length > 1 && app.sels.includes(app.sel) ? app.sels : app.sel && app.sel !== 'base' ? [app.sel] : [];
  return app.doc.layers.filter(l => ids.includes(l.id));
}
let anchor = null; // the layer clicked last in the Layers list: where a Shift+click's range starts
// the ids picked up with this one: its group, or just itself
function groupOf(id) {
  const l = app.doc.layers.find(x => x.id === id);
  return l && l.groupId ? app.doc.layers.filter(x => x.groupId === l.groupId).map(x => x.id) : [id];
}
// after a move: a layer put between two of a group's layers joins that group;
// one moved away from the rest of its own leaves it
function settleGroups(ids) {
  const L = app.doc.layers;
  for (const id of ids) {
    const i = L.findIndex(l => l.id === id);
    if (i === -1) continue;
    const g = L[i].groupId, a = (L[i - 1] || {}).groupId, b = (L[i + 1] || {}).groupId;
    if (a && a === b) L[i].groupId = a;
    else if (g && a !== g && b !== g) L[i].groupId = null;
  }
  pruneGroups();
}
// a group needs two members to mean anything
function pruneGroups() {
  const d = app.doc, n = new Map();
  for (const l of d.layers) if (l.groupId) n.set(l.groupId, (n.get(l.groupId) || 0) + 1);
  for (const l of d.layers) if (l.groupId && n.get(l.groupId) < 2) l.groupId = null;
  d.groups = (d.groups || []).filter(g => n.get(g.id) >= 2);
}
// a fill that fades to nothing ends in its own colour, see-through: keep that true when the colour changes
function keepFadeOut(l) {
  if (typeof l.color2 === 'string' && l.color2.length === 9 && l.color2.endsWith('00')) l.color2 = l.color + '00';
}
// in Finish mode the paint is not to be disturbed: only an area may be changed
const canChange = () => app.mode !== 'finish' || isArea(actions.selected());
let spaceHeld = false; // Space is down: a drag moves the sheet
let handFrom = 'select'; // the tool that was armed when the Hand was taken up
let pairingOn = false, unpaired = new Set(), pairGuide = null; // unpaired: exact pairs taken apart by hand, not paired again this visit; // pairGuide: was Show on car on before the list put its pink panels on the car
const toolChanged = () => {
  // the pairing list is open while Pair panels is armed (or the Hand taken up from it)
  const pairing = app.mode === 'map' && (app.tool === 'mpair' || (app.tool === 'hand' && handFrom === 'mpair'));
  if (pairing && !pairingOn) actions.pairStart();
  else if (!pairing && pairingOn) actions.pairEnd();
  pairingOn = pairing;
  cv.classList.toggle('draw', (app.tool !== 'select' && app.tool !== 'mpick' && app.tool !== 'hand') || app.trimming);
  handCursor();
};
// the open hand: Space is held, or the Hand tool is armed (never in the draw-a-shape window, whose view is held still)
const handCursor = () => cv.classList.toggle('pan', (spaceHeld || app.tool === 'hand') && !app.workshop);

let library = { logos: [], shapes: [], sets: [], palettes: [] }; // sets: several layers kept as one thing (a badge in three colours, a logo with its lettering)
const saveLibrary = () => persist.saveBlob('next-library', library).catch(() => { /* quota: it still works this session */ });
// A shape brought in from outside (an icon, an SVG file) is kept in the
// library, so it is there for Repeat and stamps too. One already kept (the
// same icon again) is not kept twice. → the library's copy
function keepShape(made) {
  const icon = made.credit ? made.credit.icon : null;
  const had = icon && library.shapes.find(x => (x.credits || []).some(c => c.icon === icon));
  if (had) return had;
  const { credit, ...rest } = made;
  const item = { id: 's' + newId(), ...rest, ...(credit ? { credits: [credit] } : {}) };
  library.shapes.unshift(item);
  saveLibrary();
  return item;
}

// settings of a text layer that change what its picture looks like
const TEXT_KEYS = new Set(['text', 'font', 'fontSize', 'textColor', 'outlineColor', 'outlineWidth', 'italic', 'letterSpacing', 'curve', 'fontWeight', 'lineSpacing', 'align']);

// a copy that shares nothing editable with the original (pictures are shared:
// they are never changed in place)
function cloneLayer(l) {
  const c = { ...l, id: newId() }; // still tagged with the original's group: paste gives copies a group of their own
  for (const k of ['pts', 'clipAt', 'stops']) if (Array.isArray(l[k])) c[k] = structuredClone(l[k]);
  if (Array.isArray(l.clip)) c.clip = l.clip.map(poly => poly.map(q => ({ ...q })));
  for (const k of ['matParams', 'fx', 'fadeFrom', 'fadeTo']) if (l[k]) c[k] = { ...l[k] };
  return c;
}

// Where a fade runs is set by two dots on the sheet (fadeFrom, fadeTo). Shapes
// selected together share them, so one fade runs across them all: those of
// `ls` that follow a fade line and have no dots yet take the dots another of
// them has, or else fresh ones laid across them all. fresh: lay them anew (the
// style changed, and its dots start somewhere else).
function aim(ls, fresh) {
  const using = ls.filter(hasAim);
  if (!using.length) return;
  const had = fresh ? null : using.find(l => l.fadeFrom && l.fadeTo);
  const x0 = Math.min(...using.map(l => l.rx)), y0 = Math.min(...using.map(l => l.ry));
  const box = { x: x0, y: y0, w: Math.max(...using.map(l => l.rx + l.rw)) - x0, h: Math.max(...using.map(l => l.ry + l.rh)) - y0 };
  const ends = had ? { a: had.fadeFrom, b: had.fadeTo } : fadeEnds(using[0], fadeStyleOf(using[0]), box);
  for (const l of using) if (fresh || !(l.fadeFrom && l.fadeTo)) { l.fadeFrom = { ...ends.a }; l.fadeTo = { ...ends.b }; }
}
const newSeed = () => (Math.random() * 0x7fffffff) | 0;
// the next colour for a repeat's copies: one already in the livery that they
// do not have yet, else a plain one
function nextMix(colors) {
  const has = new Set(colors.map(c => String(c || '').toLowerCase()));
  const livery = [app.doc.baseColor, ...app.doc.layers.map(layerColour)].filter(Boolean).map(c => c.toLowerCase());
  return [...livery, '#ffffff', '#101114', '#808080'].find(c => !has.has(c)) || '#808080';
}
// What a repeat's copies take, or a stamp places, from its key: a ready-made
// shape's name, or 'own:<id>' for one saved in the library. A library shape
// is copied in, so the livery does not depend on this browser's library.
function motifOf(key) {
  if (SHAPES[key]) return { kind: key };
  const it = library.shapes.find(x => 'own:' + x.id === key);
  if (!it) return null;
  return { kind: 'own', id: it.id, name: it.name, w: it.w, h: it.h, ...(it.credits && it.credits.length ? { credits: it.credits } : {}), pts: (it.pts || boxOutline(it.shape, 0, 0, it.w, it.h)).map(q => (q.c ? { ...q, c: { ...q.c } } : { ...q })) };
}

// ---------- drawing a shape of my own ----------
// The livery is put aside and a blank sheet takes its place, so every drawing
// tool works on the new shape with nothing else in the way. The screen is
// dressed as a window of its own (see body.workshop in app.css) and the view
// is held still. Saving joins everything drawn into one shape for the library.
let aside = null; // the livery, and how its screen was left, while a shape is drawn
function startShape() {
  if (aside) return;
  tools.cancel(); mapTools.cancel();
  if (saveTimer) runSave(); // the livery's last edit is saved first: runSave reads it before it waits for anything
  aside = { doc: app.doc, view: { ...app.view }, sel: app.sel, sels: app.sels, mode: app.mode, colour: app.colour, undo: undoStack.splice(0), redo: redoStack.splice(0) };
  app.doc = createDoc();
  app.doc.name = 'shape';
  app.doc.baseColor = '#ffffff';
  app.workshop = true;
  app.mode = 'paint'; app.tool = 'pen'; app.sel = null; app.sels = []; app.colour = '#101114';
  app.trimming = false;
  document.body.classList.add('workshop');
  $('shapebox').hidden = false;
  resetHistory();
  fit(); toolChanged();
  dirty = true;
  ui.refresh();
}
// keep: save what was drawn to the library (false: throw it away)
async function endShape(keep) {
  if (!aside) return;
  tools.cancel();
  let item = null;
  if (keep) {
    const drawn = app.doc.layers.filter(l => l.visible && l.type === 'fill' && !l.specOnly);
    if (!drawn.length) { ui.say('Nothing is drawn yet', true); return; }
    const name = await ui.askText({ title: 'Save the shape', label: 'Name', value: 'Shape ' + (library.shapes.length + 1), ok: 'Save' });
    if (!name) return; // back to drawing
    const all = joined(drawn.map(l => (isShape(l) ? l.pts : boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh))));
    const b = shapeBounds(all), k = 300 / Math.max(b.w, b.h, 1e-6), r = (v) => Math.round(v * 100) / 100; // 300 px along its longer side, as icons come in
    const credits = cleanCredits(drawn.flatMap(l => l.credits || []));
    item = keepShape({ name, shape: 'path', pts: shapeMapped(all, p => ({ x: r((p.x - b.x) * k), y: r((p.y - b.y) * k) })), w: r(b.w * k), h: r(b.h * k), ...(credits.length ? { credits } : {}) });
  }
  clearTimeout(saveTimer); saveTimer = null;
  app.doc = aside.doc;
  Object.assign(app.view, aside.view);
  app.sel = aside.sel; app.sels = aside.sels; app.mode = aside.mode; app.colour = aside.colour; app.tool = app.mode === 'map' ? 'mpick' : 'select';
  undoStack.splice(0, undoStack.length, ...aside.undo);
  redoStack.splice(0, redoStack.length, ...aside.redo);
  aside = null;
  app.workshop = false;
  document.body.classList.remove('workshop');
  $('shapebox').hidden = true;
  skipCapture = false;
  syncUndo(); toolChanged();
  dirty = true;
  requestDraw();
  ui.refresh();
  if (item) ui.say(`${item.name} is in Your shapes`);
}

const actions = {
  undo, redo, fit,
  drawShape: startShape,
  saveDrawnShape: () => endShape(true),
  cancelShape: () => endShape(false),
  zoomBy: (f) => setZoom(app.view.zoom * f),
  change,

  async newLivery() {
    const d = app.doc;
    if ((d.layers.length || d.template) && !app.projectId
        && !await ui.ask({ title: 'Start a new livery?', body: 'This one is not saved as a project yet.', ok: 'Start new' })) return;
    await setDoc(newDoc(), null);
  },

  async open() {
    const list = (await persist.listProjects().catch(() => [])).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const id = await ui.pickProject(list);
    if (!id) return;
    try {
      let data = await persist.loadProject(id);
      if (typeof data === 'string') data = JSON.parse(data);
      if (!data) throw new Error('missing');
      await setDoc(await deserializeDoc(data), id);
      ui.say(`Opened ${app.doc.name}`);
    } catch {
      ui.say('Could not open that project', true);
    }
  },

  async save() {
    if (!app.projectId) {
      const name = await ui.askText({ title: 'Save as project', label: 'Name', value: app.doc.name || 'untitled livery', ok: 'Save' });
      if (!name) return;
      app.doc.name = name;
      app.projectId = Date.now().toString(36);
      lastJson = null;
    }
    if (await runSave() === false) ui.say(SAVE_FAILED, true);
    else ui.say(`Saved ${app.doc.name}`);
    ui.refreshChrome();
  },

  pickTemplate: () => $('file-template').click(),
  // where the cars' template files are: Trading Paints lists them all, free, no login
  getTemplate() { const tab = window.open('https://www.tradingpaints.com/cartemplates', '_blank'); if (tab) tab.opener = null; else ui.say('Allow pop-ups for this site, or open tradingpaints.com/cartemplates', true); },
  async loadTemplateFile(file) {
    ui.say('Reading template…');
    try {
      const d = app.doc;
      const t = await loadTemplate(file, d.regionMap);
      d.template = t.template;
      d.regionMap = t.regionMap;
      // the template's extra colours; ones already set keep their colours
      app.board = null;
      d.swatches = t.swatches.map((p) => { const had = (d.swatches || []).find(o => o.name === p.name); return had ? { ...p, color: had.color, ref: had.ref } : { ...p, ref: null }; });
      if (!fixedSel() && !d.layers.some(l => l.id === app.sel)) app.sel = 'base';
      if (!d.name || d.name === 'untitled livery') d.name = t.carName;
      fit();
      change();
      await actions.findCar(t.carName);
      if (t.fit !== null && t.fit < FIT_OK) ui.say(misfit(t.fit, 'This template'), true);
      else ui.say((t.pieces ? `${t.pieces} panels found` : 'Template loaded') + (d.target === 'car' && d.car ? ` · Car folder: ${d.car}` : ''));
    } catch (err) {
      ui.say('Could not load that template: ' + (err.message || 'unknown error'), true);
    }
  },

  // The linked paints folder and the car folders in it. After a reload the
  // browser still holds the folder but wants to be asked again before it can
  // be read (the same thing that pauses Live); request: ask now, which only
  // works from a click.
  async paintsFolder(request) {
    const root = (request && await persist.getPaintsFolder({ requestIfNeeded: true }).catch(() => null)) || await persist.getPaintsFolder().catch(() => null);
    return { root, cars: root ? await carFolders(root).catch(() => []) : [] };
  },

  // Which car folder this livery goes to: worked out from the template's name
  // (or the livery's) when one folder stands clear, asked for when none does.
  // → true once there is one
  async findCar(hint, request = false) {
    const d = app.doc;
    if (d.target !== 'car' || d.car) return true;
    const { root, cars } = await actions.paintsFolder(request);
    if (!cars.length) {
      if (root && request) ui.say(`There are no car folders in ${root.name}. Link the iRacing paints folder itself, not a car's folder.`, true);
      return false; // or nothing is linked, or it cannot be read until a click allows it
    }
    const { car } = matchCar(hint || d.name, cars);
    if (car) { d.car = car; change(); return true; }
    await actions.carSetup(hint);
    return !!d.car;
  },

  async carSetup(hint) {
    const { root, cars } = await actions.paintsFolder(true);
    const near = matchCar(hint || app.doc.name, cars).ranked.filter(r => r.score >= 0.3).slice(0, 3).map(r => r.folder);
    const res = await ui.carSetup({ custid: app.custid, target: app.doc.target, customNumber: app.doc.customNumber, folder: root ? root.name : null, cars, near, car: app.doc.car });
    if (!res) return false;
    app.custid = res.custid.trim();
    persist.saveSetting('custid', app.custid).catch(() => {});
    if (cars.length) app.doc.car = res.car || null;
    app.doc.target = res.target;
    app.doc.customNumber = res.customNumber;
    change();
    return validCustid(app.custid);
  },

  async linkFolder() {
    if (!persist.fsSupported()) { ui.say('Linking a folder needs Chrome or Edge', true); return false; }
    try {
      const h = await persist.pickPaintsFolder(isPaintsFolder);
      if (!h) { ui.say('That is one car\'s folder. Link the paints folder itself: Documents › iRacing › paints.', true); return false; }
      ui.say(`Linked ${h.name}`);
      await actions.findCar();
      return true;
    } catch (err) {
      if (err && err.name !== 'AbortError') ui.say('Could not link that folder', true);
      return false;
    }
  },

  // quiet: false asks for the folder permission, so it must come from a click
  async saveIracing() {
    if (!persist.fsSupported()) { ui.say('Saving to iRacing needs Chrome or Edge. Use Export TGA instead.', true); return false; }
    if (!validCustid(app.custid) && !await actions.carSetup()) return false;
    if (!await persist.getPaintsFolder().catch(() => null) && !await actions.linkFolder()) return false;
    if (!await actions.findCar(null, true)) return false;
    const res = await saveToIracing(shown(), app.custid);
    if (res.ok) ui.say(res.backed ? `Saved ${res.paintName}. Your previous paint is kept in overspray-backup.` : `Saved ${res.paintName}`);
    else ui.say(res.error, true);
    return res.ok;
  },

  async toggleLive() {
    if (app.live && !app.liveBad) {
      app.live = false;
    } else if (await actions.saveIracing()) { // a real save first: it proves the folder and the number
      app.live = true;
      app.liveBad = false;
    } else {
      return;
    }
    persist.saveSetting('liveSync', app.live).catch(() => {});
    ui.refreshChrome();
  },

  exportTga() {
    const [paintName, specName] = paintFilenames(app.doc, validCustid(app.custid) ? app.custid : safeName());
    download(canvasToTGA(exportPaintCanvas(app.doc, paint())), paintName); // a helmet at 1024, as Save to iRacing writes it
    if (specName) download(canvasToTGA(renderSpec(shown()), { alpha: true }), specName);
    ui.say(specName ? `${paintName} is the paint; ${specName} is the finish map` : `Exported ${paintName}`);
  },
  exportPng() {
    paint().toBlob((b) => { if (b) download(b, safeName() + '.png'); }, 'image/png');
  },
  // the picked layers alone, as they are painted, over a clear sheet the size of the paint
  exportLayerPng() {
    const ls = selectedLayers();
    if (!ls.length) return;
    const g = ls[0].groupId && ls.every(l => l.groupId === ls[0].groupId) ? (app.doc.groups || []).find(x => x.id === ls[0].groupId) : null;
    const name = (ls.length > 1 ? (g ? g.name : 'layers') : ls[0].name).replace(/[^\w.-]+/g, '_');
    const sheet = paintLayers(withSeams(withMirrors(withTints({ ...app.doc, layers: ls }))).layers, { linearEdges: true });
    exportPaintCanvas(app.doc, sheet).toBlob((b) => { if (b) download(b, `${safeName()}_${name}.png`); }, 'image/png');
  },

  // Trading Paints takes the paint as a PNG, and a finish map only as the
  // .mip the sim itself makes from the last Save to iRacing. A car's Send
  // opens the upload page only once both files are down: otherwise it stays
  // here and says why, since the new tab would hide the message.
  async sendTp() {
    const name = safeName() + '.png'; // Trading Paints takes any file name (the .mip too); the upload page asks for the car and number
    const blob = await new Promise(done => exportPaintCanvas(app.doc, paint()).toBlob(done, 'image/png'));
    if (!blob) { ui.say('The paint could not be exported', true); return; }
    download(blob, name);
    let why = null;
    if (app.doc.target === 'car') {
      why = 'No finish file: add your iRacing account number, then send again.';
      if (validCustid(app.custid)) try {
        const dir = await paintsDir(app.doc);
        if (!dir) throw 0; // no folder linked, or a reload dropped access to it
        const mip = await persist.readFileFromFolder(dir, `car_spec_${app.custid}.mip`);
        const tga = mip && await persist.readFileFromFolder(dir, `car_spec_${app.custid}.tga`);
        if (!mip) why = 'No spec map file yet: Save to iRacing, open the car in iRacing once, then send again.';
        else if (tga && mip.lastModified < tga.lastModified) why = 'Spec map file is out of date: open the car in iRacing once, then send again.';
        else { download(mip, safeName() + '_spec.mip'); why = null; }
      } catch { why = 'No finish file: turn on Live (or link the paints folder) so Overspray can read it, then send again.'; }
    }
    if (why) { ui.say(`${name} downloaded. ${why}`, true); return; }
    // a few awaits in, the click still counts: browsers allow pop-ups for 5s after it
    // (no 'noopener' in the call: with it the answer is always null, blocked or not)
    const tab = window.open('https://www.tradingpaints.com/upload', '_blank');
    if (!tab) { ui.say('Allow pop-ups for this site, then send again', true); return; }
    tab.opener = null;
    ui.say(app.doc.target === 'car' ? `Downloaded ${name} (paint) and ${safeName()}_spec.mip (finish)` : `Downloaded ${name}. Upload it as the paint.`);
  },

  setMode(mode) {
    if (mode === app.mode || (mode === 'map' && needTemplate())) return;
    tools.cancel(); mapTools.cancel(); carGrad.close();
    app.mode = mode;
    app.tool = mode === 'map' ? 'mpick' : 'select';
    app.ftarget = null; app.fmore = [];
    if (mode !== 'finish' && isArea(actions.selected())) app.sel = null; // an area is Finish mode's to select
    app.trimming = false;
    app.centreFor = null;
    toolChanged();
    requestDraw();
    ui.refresh();
  },

  // ---- finishes ----
  // the layer a finish target is about, if it is about one
  finishLayer() {
    const t = app.ftarget;
    return t && (t.kind === 'layer' || t.kind === 'area') ? app.doc.layers.find(l => l.id === t.id) || null : null;
  },
  // the finish the target has now, as the engine stamps it: { material, params }
  finishNow() {
    const t = app.ftarget, l = actions.finishLayer();
    if (!t) return null;
    if (t.kind === 'colour') { const r = ruleFor(app.doc, t.colour); return { material: r ? r.material : 'gloss', params: (r && r.params) || null }; }
    return l ? { material: l.material || 'gloss', params: l.matParams || null } : null;
  },
  // on the target and everything picked with it: the same whole finish on each
  applyFinish({ material, params }) {
    if (!app.ftarget) return false;
    let did = false;
    for (const t of [app.ftarget, ...app.fmore]) {
      const own = params && structuredClone(params), l = t.kind !== 'colour' && app.doc.layers.find(x => x.id === t.id);
      if (t.kind === 'colour') { setRule(app.doc, t.colour, material, own); did = true; }
      else if (l) { l.material = material; l.matParams = own; l.finishOwn = true; did = true; }
    }
    return did;
  },
  // one of the six: its three numbers, keeping whatever sparkle is on
  setFinish(key) {
    const now = actions.finishNow();
    if (!now || !MATERIALS[key]) return;
    const m = MATERIALS[key], cur = readFinish(now.material, now.params);
    if (!actions.applyFinish(writeFinish({ met: m.met, rough: m.rough, clear: m.clear, sparkle: cur.sparkle }, key))) return;
    app.finishKind = key;
    change({ now: true });
  },
  // a slider or the Sparkle switch. part: met | rough | clear | sparkle | amount | size | strength
  tweakFinish(part, value) {
    const now = actions.finishNow();
    if (!now) return;
    const f = readFinish(now.material, now.params);
    const all = part === 'amount' || part === 'size' || part === 'strength' || part === 'bright';
    if (part === 'sparkle') f.sparkle = value ? { ...(liverySparkle(app.doc) || SPARKLE) } : null; // switched on: the livery's sparkle
    else if (all) { if (!f.sparkle) return; f.sparkle[part] = value; }
    else f[part] = value;
    // it keeps the name of the finish it started from while its numbers are moved
    if (!actions.applyFinish(writeFinish(f, presetOf(readFinish(now.material, now.params)) || now.material))) return;
    if (all) oneSparkle(app.doc, f.sparkle); // one sparkle for the whole livery: every sparkly finish moves with it
    change(part === 'sparkle' ? { now: true } : { panels: false });
  },
  // the finish something else in the livery has, taken over whole. from: 'colour:#rrggbb' | 'layer:id' | 'area:id'
  copyFinish(from) {
    const [kind, key] = from.split(/:(.*)/), src = finishList(app.doc).find(o => o.kind === kind && (kind === 'colour' ? o.colour : o.id) === key);
    if (!src || !actions.applyFinish({ material: src.material, params: src.params ? structuredClone(src.params) : null })) return;
    app.finishKind = presetOf(readFinish(src.material, src.params)) || src.material;
    change({ now: true });
  },
  // the three sliders back to where the named finish has them; sparkle stays
  resetFinish() {
    const now = actions.finishNow();
    if (!now) return;
    const key = FINISHES.includes(now.material) ? now.material : 'gloss', m = MATERIALS[key];
    if (actions.applyFinish(writeFinish({ met: m.met, rough: m.rough, clear: m.clear, sparkle: readFinish(now.material, now.params).sparkle }, key))) change({ now: true });
  },
  // "all of this colour" or "just this layer", for a target that came from a shape or text
  finishScope(scope) {
    const t = app.ftarget;
    if (!t) return;
    if (scope === 'layer' && t.kind === 'colour' && t.layerId) app.ftarget = { kind: 'layer', id: t.layerId };
    else if (scope === 'colour' && t.kind === 'layer') {
      const l = actions.finishLayer(), c = l && layerColour(l);
      if (!c) return;
      if (hasOwnFinish(l)) { l.finishOwn = false; l.material = 'gloss'; l.matParams = null; change({ now: true }); } // it follows its colour again
      app.ftarget = { kind: 'colour', colour: c, layerId: l.id };
    }
    requestDraw();
    ui.refresh();
  },
  // from the Finishes list. how: 'add' (Ctrl) | 'range' (Shift)
  finishSelect(kind, key, how) {
    pickFinish(kind === 'colour' ? { kind, colour: key } : { kind, id: key }, how);
    app.sel = kind === 'colour' || app.fmore.length ? null : key;
    requestDraw();
    ui.refresh();
  },
  // Back to the default finish, plain gloss. A finish cannot be taken away:
  // everything has one, so the row stays. (An area is a shape: Delete removes it.)
  finishDefault(kind, key) {
    const d = app.doc, l = d.layers.find(x => x.id === key);
    if (kind === 'colour') clearRule(d, key);
    else if (l) { l.material = 'gloss'; l.matParams = null; }
    change({ now: true });
  },

  // ---- the map ----
  pickPiece(id) { app.piece = id; requestDraw(); ui.refresh(); },
  // every edit to the map ends here
  async mapChanged(msg) {
    if (guideLayer(app.doc)) await syncGuide(app.doc, true); // the guide on the car follows the map
    change({ now: true });
    if (msg) ui.say(msg);
  },
  mapRename(name) {
    const r = regionById(app.doc.regionMap, app.piece);
    if (!r || !name || name === r.name) return;
    renameRegion(app.doc.regionMap, r, name);
    app.piece = r.id; // the id follows the name
    actions.mapChanged();
  },
  mapPair(id) {
    const m = app.doc.regionMap, r = regionById(m, app.piece);
    if (!r) return;
    setMirror(m, r, id || null);
    const n = id ? addTwins(m).length : 0; // links made before the pairing get their twins now
    actions.mapChanged(id ? `${r.name} paired with ${regionById(m, id).name}${n ? `, and ${n} link${n > 1 ? 's' : ''} copied to the other side` : ''}` : `${r.name} unpaired`);
  },
  // ---- the pairing list (Pair panels): twins suggested, checked one by one ----
  // Opening it pairs the panels whose outlines match exactly; everything else waits to be checked.
  pairStart() {
    const m = app.doc.regionMap;
    if (!m) return;
    const exact = pairList(m).pairs.filter(p => p.exact && !unpaired.has(`${p.a.id}|${p.b.id}`));
    for (const p of exact) setMirror(m, p.a, p.b.id);
    if (!exact.length) return;
    const n = addTwins(m).length;
    actions.mapChanged(`${exact.length} pair${exact.length > 1 ? 's' : ''} matched exactly and ${exact.length > 1 ? 'were' : 'was'} paired: they are under Paired to check${n ? `, and ${n} link${n > 1 ? 's' : ''} copied to the other side` : ''}`);
  },
  async pairEnd() {
    app.pairOpen = app.pairHover = null;
    if (pairGuide === null) return;
    setGuidePink(null);
    await syncGuide(app.doc, pairGuide); // the car goes back to how it was
    pairGuide = null;
    change({ now: true });
  },
  pairHover(ids) {
    if (String(ids) === String(app.pairHover)) return;
    app.pairHover = ids; requestDraw();
  },
  // the row, open (its panels pink on the sheet and on the car), or closed again
  pairOpen(key) {
    if (app.pairOpen && app.pairOpen.key === key) return actions.pairClose();
    actions.pairShow({ key, ids: key.split('|') });
  },
  pairClose() { app.pairOpen = null; actions.pairShow(null); },
  // msg: said once the car has caught up. One undo step, the map edit before it included
  // ponytail: opening a row is an undo step too (the guide on the car changes); skip capture if that gets in the way
  async pairShow(open, msg) {
    app.pairOpen = open;
    requestDraw(); ui.refresh();
    if (pairGuide === null) pairGuide = !!guideLayer(app.doc);
    setGuidePink(open ? open.ids : null);
    await syncGuide(app.doc, true);
    change({ now: true });
    if (msg) ui.say(msg);
  },
  // a panel clicked on the sheet while a row is open: the one to pair its first panel with
  pairPick(id) {
    const o = app.pairOpen;
    if (!o || id === o.ids[0]) return;
    actions.pairShow({ key: o.key, ids: [o.ids[0], id] });
  },
  // on to the next suggestion, or the row closes when there is none
  pairNext(msg) {
    const p = pairList(app.doc.regionMap).pairs[0];
    actions.pairShow(p ? { key: `${p.a.id}|${p.b.id}`, ids: [p.a.id, p.b.id] } : null, msg);
  },
  pairConfirm() {
    const m = app.doc.regionMap, o = app.pairOpen, [a, b] = o ? o.ids.map(id => regionById(m, id)) : [];
    if (!a || !b) return;
    setMirror(m, a, b.id);
    const n = addTwins(m).length;
    actions.pairNext(`${a.name} paired with ${b.name}${n ? `, and ${n} link${n > 1 ? 's' : ''} copied to the other side` : ''}`);
  },
  // checked: these panels have no twin, so they are not suggested again
  pairNone() {
    const m = app.doc.regionMap, rs = app.pairOpen ? app.pairOpen.ids.map(id => regionById(m, id)).filter(r => r && !r.mirror) : [];
    if (!rs.length) return;
    for (const r of rs) r.noPair = true;
    actions.pairNext(`${rs.map(r => r.name).join(' and ')}: no pair`);
  },
  pairHasPair() {
    const m = app.doc.regionMap, r = app.pairOpen && regionById(m, app.pairOpen.ids[0]);
    if (!r) return;
    delete r.noPair;
    app.pairOpen.key = r.id; // its row moves to No match found
    actions.mapChanged(`${r.name} can be paired again`);
  },
  pairUnpair() {
    const m = app.doc.regionMap, r = app.pairOpen && regionById(m, app.pairOpen.ids[0]);
    if (!r || !r.mirror) return;
    const was = regionById(m, r.mirror);
    setMirror(m, r, null);
    for (const k of [`${r.id}|${was.id}`, `${was.id}|${r.id}`]) unpaired.add(k);
    actions.pairShow({ key: `${r.id}|${was.id}`, ids: [r.id, was.id] }, `${r.name} and ${was.name} unpaired`);
  },
  pairRename(id, name) {
    const m = app.doc.regionMap, r = regionById(m, id);
    if (!r || !name || name === r.name) return;
    renameRegion(m, r, name);
    if (r.id !== id) { // the id follows the name
      const swap = (x) => (x === id ? r.id : x);
      if (app.pairOpen) app.pairOpen = { key: app.pairOpen.key.split('|').map(swap).join('|'), ids: app.pairOpen.ids.map(swap) };
      if (app.piece === id) app.piece = r.id;
      if (app.pairOpen) setGuidePink(app.pairOpen.ids);
    }
    actions.mapChanged();
  },
  mapFlip(kind) {
    const m = app.doc.regionMap, r = regionById(m, app.piece);
    if (!r || !r.mirror) return;
    const n = setMirrorKind(m, r, kind);
    actions.mapChanged(`${r.name} and ${regionById(m, r.mirror).name}: ${MIRROR_NAMES[kind]}${n ? `, ${n} twin link${n > 1 ? 's' : ''} moved to match` : ''}`);
  },
  centreStart() { app.centreFor = app.piece; actions.setTool('mcentre'); },
  centreRemove() {
    const r = regionById(app.doc.regionMap, app.piece);
    if (!r || !r.center) return;
    delete r.center;
    actions.mapChanged(`Centreline removed from ${r.name}`);
  },
  // One fade over the whole car, painted on each panel by its car line (see cargrad.js)
  // the left strip's Car extras: the pit box, cockpit and pitboard, in Properties
  openExtras() {
    if (needTemplate()) return;
    if (!(app.doc.swatches || []).length) { ui.say(app.doc.template ? 'This car\'s template has no pit box, cockpit or pitboard, or it was not loaded as a PSD' : 'Load the car\'s template PSD first: these come from it', true); return; }
    actions.select(swatchAt(app.sel) ? app.sel : 'sw0');
  },
  addCarGradient() {
    if (needTemplate()) return;
    if (app.mode !== 'paint') actions.setMode('paint');
    const l = createFillLayer(app.colour);
    const n = app.doc.layers.filter(x => x.car).length + 1;
    l.name = 'Car gradient' + (n > 1 ? ' ' + n : '');
    Object.assign(l, { rx: 0, ry: 0, rw: SIZE, rh: SIZE });
    l.car = { blocks: [{ color: app.colour, from: 0, to: 0.2 }, { color: nextMix([app.colour]), from: 0.8, to: 1 }] };
    app.doc.layers.push(l);
    actions.setTool('select');
    app.sel = l.id; app.sels = [];
    change({ now: true });
    carGrad.open(l.id);
    if (!(app.doc.regionMap && (app.doc.regionMap.carLines || []).length)) ui.say('Set panels to show it on the car');
  },
  openCarGradient() { const l = actions.selected(); if (l && l.car) carGrad.open(l.id); },
  // the piece no longer placed on the car (Map › Place a piece)
  unplace() {
    const m = app.doc.regionMap, r = m && regionById(m, app.piece);
    if (!r || !(m.places || []).some(pl => pl.piece.region === r.id)) return;
    m.places = m.places.filter(pl => pl.piece.region !== r.id);
    actions.mapChanged(`${r.name} no longer placed`);
  },
  toggleMapColours() { app.mapShow.colours = !app.mapShow.colours; requestDraw(); ui.refresh(); },
  async toggleGuide() {
    if (!app.doc.regionMap) { ui.say(NEEDS_TEMPLATE, true); return; }
    await syncGuide(app.doc, !guideLayer(app.doc));
    change({ now: true });
    ui.say(guideLayer(app.doc) ? 'Panel colours are on the car. Switch this off before your real save.' : 'Panel colours are off the car');
  },
  guideOn: () => !!guideLayer(app.doc),
  pickMapFile: () => $('file-map').click(),
  async loadMapFile(file) {
    if (file.size > MAP_FILE_MAX) { ui.say('Could not read that map: the file is too big for a map', true); return; }
    await actions.loadMapText(await file.text());
  },
  // → the map, or null when it could not be read (and said so)
  async loadMapText(text) {
    try {
      if (text.length > MAP_FILE_MAX) throw new Error('the file is too big for a map');
      const map = parseRegionMap(JSON.parse(text));
      // the map there now came from the template, when one is loaded
      const fit = mapFit(app.doc.regionMap, map);
      app.doc.regionMap = map;
      app.piece = null;
      await actions.mapChanged(`Map loaded: ${map.regions.length} regions`);
      if (fit !== null && fit < FIT_OK) ui.say(misfit(fit, 'This map'), true);
      return map;
    } catch (err) {
      ui.say('Could not read that map: ' + (err.message || 'not a map file'), true);
      return null;
    }
  },
  saveMap() {
    const m = app.doc.regionMap;
    if (!m) return;
    const name = (m.car || 'car').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'car';
    download(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }), name + '.regions.json');
  },

  // ---- the shared map library (see maplib.js) ----
  async browseMaps() {
    let list;
    ui.say('Looking for shared maps…');
    try { list = await maplib.listMaps(); } catch (err) { ui.say('Could not reach the map library: ' + err.message, true); return; }
    const mine = maplib.mapFileName(app.doc.car, app.doc.regionMap && app.doc.regionMap.car);
    list.sort((a, b) => (b.name === mine) - (a.name === mine)); // this car's first
    const pick = await ui.pickList({ title: 'Shared maps', empty: 'No maps shared yet.',
      items: list.map(f => ({ id: f.url, name: f.name.replace(/\.json$/, ''), note: f.name === mine ? 'This car' : '' })) });
    if (!pick) return;
    try { await actions.loadMapText(await maplib.fetchMap(pick)); } catch (err) { ui.say('Could not load that map: ' + err.message, true); }
  },
  // the map saved under the car's name, then GitHub's upload page for it,
  // which turns the upload into a pull request for anyone without write access
  shareMap() {
    const m = app.doc.regionMap;
    if (!m || !m.regions.length) { ui.say('Make a map first', true); return; }
    if (!app.doc.car) { ui.say('Link your paints folder and choose the car first, so the map gets the car\'s name', true); return; }
    const name = maplib.mapFileName(app.doc.car);
    download(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }), name);
    const tab = window.open(maplib.uploadPage, '_blank');
    if (tab) tab.opener = null;
    ui.say(tab ? `Saved ${name}. Drop it onto the GitHub page that opened, then press Propose changes.` : 'Allow pop-ups for this site to open GitHub', !tab);
  },

  // admins: a GitHub key of theirs that can write to the maps repo
  async adminSignIn() {
    const key = await ui.askText({ title: 'Sign in to review maps', label: 'GitHub key', ok: 'Sign in' });
    if (!key) return;
    try {
      app.admin = { key, login: await maplib.signIn(key) };
      persist.saveSetting('mapsKey', key).catch(() => {});
      ui.say(`Signed in as ${app.admin.login}`);
    } catch (err) { ui.say('Could not sign in: ' + err.message, true); }
    ui.refresh();
  },
  adminSignOut() {
    app.admin = null;
    persist.saveSetting('mapsKey', null).catch(() => {});
    ui.refresh();
  },
  async reviewMaps() {
    if (!app.admin) return actions.adminSignIn();
    let list;
    ui.say('Looking for maps to review…');
    try { list = await maplib.openReviews(app.admin.key); } catch (err) { ui.say('Could not reach GitHub: ' + err.message, true); return; }
    const num = await ui.pickList({ title: 'Maps waiting for review', empty: 'Nothing waiting for review.',
      items: list.map(pr => ({ id: String(pr.number), name: pr.file.replace(/^cars\/|\.json$/g, ''), note: `#${pr.number} by ${pr.by}` })) });
    const pr = list.find(x => String(x.number) === num);
    if (!pr) return;
    try {
      const { next, now } = await maplib.reviewMaps(app.admin.key, pr);
      const prev = app.doc.regionMap;
      const map = await actions.loadMapText(next);
      if (!map) return;
      let old = null;
      try { old = now && parseRegionMap(JSON.parse(now)); } catch { /* an unreadable old map: nothing to compare */ }
      app.review = { pr, prev, old, next: map, text: JSON.stringify(map), side: 'new' };
      ui.refresh();
    } catch (err) { ui.say('Could not load that pull request: ' + err.message, true); }
  },
  // Old / New: which map is on the sheet (and on the car, with Show on car).
  // Fixes go on New; Old is only for looking at.
  async reviewSide(side) {
    const r = app.review;
    if (!r || side === r.side || (side === 'old' && !r.old)) return;
    if (r.side === 'new') r.next = app.doc.regionMap;
    r.side = side;
    app.doc.regionMap = side === 'old' ? r.old : r.next;
    app.piece = null;
    await actions.mapChanged(side === 'old' ? 'Showing the map there now' : 'Showing the new map');
  },
  reviewOld: () => actions.reviewSide('old'),
  reviewNew: () => actions.reviewSide('new'),
  async reviewApprove() {
    const r = app.review;
    if (!r || r.busy) return; // a second click while GitHub is still merging
    if (r.side === 'new') r.next = app.doc.regionMap;
    const now = JSON.stringify(r.next);
    r.busy = 'merge'; ui.refresh(); // the button says Merging… until GitHub answers
    try {
      await maplib.approve(app.admin.key, r.pr, now === r.text ? null : JSON.stringify(r.next, null, 2));
      ui.say(`Merged #${r.pr.number}${now === r.text ? '' : ', with your fixes'}`);
      await actions.reviewStop();
    } catch (err) { ui.say('Could not merge: ' + err.message, true); }
    r.busy = false; ui.refresh();
  },
  async reviewReject() {
    const r = app.review;
    if (!r || r.busy) return;
    r.busy = 'reject'; ui.refresh();
    try {
      await maplib.reject(app.admin.key, r.pr);
      ui.say(`Closed #${r.pr.number} without merging`);
      await actions.reviewStop();
    } catch (err) { ui.say('Could not close it: ' + err.message, true); }
    r.busy = false; ui.refresh();
  },
  // back to this livery's own map
  async reviewStop() {
    const r = app.review;
    if (!r) return;
    app.review = null;
    app.doc.regionMap = r.prev;
    app.piece = null;
    await actions.mapChanged();
    ui.refresh();
  },

  // ---- painting from the map ----
  // Mirrored: the layer is painted on its twin panel (or across its
  // centreline) as well, and both sides follow every edit
  mirror() {
    const l = actions.selected(), ls = selectedLayers();
    if (!l || !canChange() || needTemplate()) return;
    // any of them mirrored: the switch is on, and this takes it off them all
    if (ls.some(x => x.mirrored)) { for (const x of ls) x.mirrored = false; change({ now: true }); return; }
    // every selected layer that has somewhere to mirror onto
    let done = 0, first = null, where = null;
    for (const x of ls) {
      const res = mirrorLayer(app.doc.regionMap, x); // only to find out whether it can be
      if (res.error) { first = first || res.error; continue; }
      x.mirrored = true; done++;
      where = where || (res.dst.mirror ? `Mirrored onto ${res.dst.name}` : `Mirrored across ${res.dst.name}'s centreline`);
    }
    if (!done) { ui.say(first, true); ui.refresh(); return; }
    // some could not be: say so, or the others look forgotten
    if (first) ui.say(`Mirrored ${done} of ${ls.length}. ${first}`, true);
    else ui.say(ls.length > 1 ? `Mirrored ${done} layers` : where);
    change({ now: true });
  },
  // Continues: what hangs over a linked edge of the layer's panel is painted
  // on the panel that edge meets, and follows every edit
  continues() {
    const l = actions.selected(), ls = selectedLayers();
    if (!l || !canChange() || needTemplate()) return;
    if (ls.some(x => x.continues)) { for (const x of ls) x.continues = false; change({ now: true }); return; }
    if (ls.length > 1) { // each that sits on a panel with a linked edge
      let done = 0, first = null;
      for (const x of ls) {
        const s = seamsOf(app.doc.regionMap, x);
        if (s.error) first = first || s.error;
        else { x.continues = s.home.id; done++; }
      }
      if (!done) { ui.say(first, true); ui.refresh(); return; }
      ui.say(first ? `${done} of ${ls.length} continue across edges. ${first}` : `${done} layers continue across edges`, !!first);
      change({ now: true });
      return;
    }
    const s = seamsOf(app.doc.regionMap, l);
    if (s.error) { ui.say(s.error, true); ui.refresh(); return; }
    l.continues = s.home.id;
    const names = [...new Set(s.links.map(({ link, side }) => (regionById(app.doc.regionMap, link[side === 'a' ? 'b' : 'a'].region) || {}).name))].filter(n => !s.homes.some(h => h.name === n));
    const placed = s.places.map(({ place }) => regionById(app.doc.regionMap, place.piece.region).name);
    ui.say([names.length ? `Continues onto ${names.join(', ')} where it hangs over the edge` : s.links.length ? 'Continues across the linked edges between its panels' : '',
      placed.length ? `Shows on ${placed.join(', ')}, placed over it` : ''].filter(Boolean).join('. '));
    change({ now: true });
  },
  // ---- fades ----
  // A shape's fill fades from its colour to a second one, or to nothing.
  // part: on | style ('linear' | 'radial') | to (a hex) | out (to nothing)
  setFade(part, value) {
    const ls = selectedLayers().filter(l => l.type === 'fill' && !isArea(l)); // every selected shape: together they fade as one
    if (!ls.length || !canChange()) return;
    for (const l of ls) {
      // switched on, it starts as the usual want: a smooth fade to nothing
      // (the engine's own default second colour means none has been chosen yet)
      if (part === 'on') {
        l.fillType = value ? fadeStyleOf(l) : 'solid';
        if (value && (!l.color2 || l.color2 === '#101114')) l.color2 = l.color + '00';
      } else if (part === 'style') {
        l.fadeStyle = value === 'radial' ? 'radial' : 'linear';
        if (hasFade(l)) l.fillType = l.fadeStyle;
      } else if (part === 'to') l.color2 = value;
      else if (part === 'out') l.color2 = value ? l.color + '00' : '#ffffff'; // the same colour, see-through
    }
    aim(ls, part === 'style');
    change(part === 'to' ? { panels: false } : { now: true });
  },
  // The colours a fade passes through between its own colour and the one it
  // fades to, [{ color, at: 0–1 }]. f(stops) → the new list, which every
  // selected shape takes, so they still fade as one. `panels`: as setRepeat.
  setFadeStops(f, panels = true) {
    const ls = selectedLayers().filter(l => l.type === 'fill' && !isArea(l));
    if (!ls.length || !canChange()) return;
    const next = f((ls.find(hasFade) || ls[0]).stops || []);
    for (const l of ls) l.stops = next.map(o => ({ ...o }));
    change(panels ? { now: true } : { panels: false });
  },
  // a new colour in the middle of the widest stretch, its box opened to choose it
  addFadeColour() {
    let k = 0;
    actions.setFadeStops((stops) => {
      const ats = [0, ...stops.map(o => o.at), 1];
      for (let i = 1; i < ats.length - 1; i++) if (ats[i + 1] - ats[i] >= ats[k + 1] - ats[k]) k = i; // a tie: the later stretch, so a new colour goes on towards the end
      const l = actions.selected() || {};
      return [...stops.slice(0, k), { color: nextMix([l.color, ...stops.map(o => o.color), String(l.color2 || '').slice(0, 7)]), at: (ats[k] + ats[k + 1]) / 2 }, ...stops.slice(k)];
    });
    setTimeout(() => { const box = $(`f-stop-c${k}`); if (box) box.click(); }, 0);
  },
  fadeColour(k, part) { actions.setFadeStops((stops) => stops.map((o, i) => (i === k ? { ...o, ...part } : o)), false); },
  dropFadeColour(k) { actions.setFadeStops((stops) => stops.filter((_, i) => i !== k)); },
  // the mirrored side becomes a layer of its own, to be changed separately
  separate() {
    const l = actions.selected();
    if (!l || !l.mirrored) return;
    const res = mirrorLayer(app.doc.regionMap, l);
    if (res.error) { ui.say(res.error, true); return; }
    l.mirrored = false;
    res.copy.mirrored = false;
    if (res.copy.repeat) delete res.copy.repeat.at; // its own scatter from now on: only a Mirrored side's follows the original's
    app.doc.layers.splice(app.doc.layers.indexOf(l) + 1, 0, res.copy);
    app.sel = res.copy.id;
    change({ now: true });
  },
  trim() {
    if (!actions.selected() || app.mode !== 'paint') return;
    if (!app.doc.regionMap) { ui.say(NEEDS_TEMPLATE, true); return; }
    app.trimming = !app.trimming;
    toolChanged();
    requestDraw();
    ui.refresh();
  },
  endTrim() { if (!app.trimming) return; app.trimming = false; toolChanged(); requestDraw(); ui.refresh(); },
  trimClear() {
    if (!actions.selected()) return;
    for (const l of selectedLayers()) { l.clip = null; l.clipAt = null; }
    app.trimming = false;
    toolChanged();
    change({ now: true });
  },

  setTool(id) {
    if (id === 'piece' && needTemplate()) return;
    // The Hand is taken up and put down again (H a second time, its button, or
    // Esc) without disturbing what was in progress: a half-drawn pen shape, or
    // panels being picked for a trim, is still there when the tool it came
    // from is back.
    if (id === 'hand' && app.tool === 'hand') id = handFrom;
    const aside = id === 'hand' || (app.tool === 'hand' && id === handFrom);
    if (id === 'hand') handFrom = app.tool;
    if (!aside) {
      if (tools) tools.cancel();
      if (mapTools) mapTools.cancel();
      app.trimming = false;
      if (id !== 'mcentre') app.centreFor = null;
    }
    app.tool = id;
    if (id === 'shape') app.shapeMenu = true;
    toolChanged();
    requestDraw();
    ui.refresh();
  },
  setShapeKind(kind) { app.shapeKind = kind; app.shapeMenu = false; requestDraw(); ui.refreshChrome(); },
  setStamp(part) { Object.assign(app.stamp, part); requestDraw(); },

  // ---- repeat: copies of a layer in a line or a grid ----
  // part: settings to change; null takes the repeat off. `panels`: redraw the
  // panel too, for a change that shows or hides settings (a slider need not).
  setRepeat(part, panels = true) {
    const ls = selectedLayers().filter(l => !l.locked);
    if (!ls.length || !canChange()) return;
    for (const l of ls) {
      if (part === null) { delete l.repeat; continue; }
      const r = l.repeat || cleanRepeat({ seed: newSeed() });
      l.repeat = cleanRepeat({ ...r, ...(typeof part === 'function' ? part(r, l) : part) });
    }
    change({ panels });
  },
  repeatReroll() { actions.setRepeat({ seed: newSeed() }); },
  // the copies' other colours: they take turns with the layer's own, or pick by their roll
  addRepeatColour() {
    actions.setRepeat((r, l) => ({ colors: [...r.colors, nextMix([layerColour(l), ...r.colors])] }));
    // the new colour is there to be chosen: its box opens the colour pop-up straight away
    const r = (actions.selected() || {}).repeat, n = r ? r.colors.length : 0;
    if (n) setTimeout(() => { const box = $(`f-rep-c${n - 1}`); if (box) box.click(); }, 0);
  },
  // k: which of the extra colours, or -1 for the layer's own, whose place the first extra then takes
  dropRepeatColour(k) {
    if (k >= 0) return actions.setRepeat((r) => ({ colors: r.colors.filter((_, i) => i !== k) }));
    const r = (actions.selected() || {}).repeat;
    if (!r || !r.colors.length) return; // the only colour stays
    actions.setRepeat({ colors: r.colors.slice(1) }, false);
    actions.applyColour(r.colors[0]);
  },
  repeatColour(k, hex) { actions.setRepeat((r) => ({ colors: r.colors.map((c, i) => (i === k ? hex : c)) }), false); },
  // a shape's copies can take other outlines too
  addRepeatShape(key) { actions.setRepeat((r) => ({ shapes: [...r.shapes, motifOf(key)] })); },
  // k: which of the extra shapes, or -1 for the layer's own: the first extra
  // then becomes its outline, the same size, where it is
  dropRepeatShape(k) {
    if (k >= 0) return actions.setRepeat((r) => ({ shapes: r.shapes.filter((_, i) => i !== k) }));
    actions.setRepeat((r, l) => {
      if (l.type !== 'fill' || !r.shapes.length) return {}; // the only shape stays
      l.shape = 'path';
      setShape(l, placed(r.shapes[0], l.rx + l.rw / 2, l.ry + l.rh / 2, Math.max(l.rw, l.rh), l.turn || 0));
      return { shapes: r.shapes.slice(1) };
    });
  },
  ownShapes: () => library.shapes,
  setBandWidth(n) { app.bandWidth = Math.max(2, Math.min(800, Math.round(n) || 60)); requestDraw(); },
  redraw() { requestDraw(); ui.refresh(); },
  hint: () => (app.mode === 'map' ? (mapTools ? mapTools.hint() : '') : tools ? tools.hint() : ''),

  // ---- layers ----
  selected: () => app.doc.layers.find(l => l.id === app.sel) || null,
  selectedLayers,
  // several at once: the last one is the one Properties shows
  selectMany(ids) {
    const all = new Set();
    for (const id of ids) for (const m of groupOf(id)) all.add(m);
    app.sels = app.doc.layers.filter(l => all.has(l.id)).map(l => l.id);
    app.sel = app.sels[app.sels.length - 1] || null;
    if (app.sels.length < 2) app.sels = [];
    requestDraw();
    ui.refresh();
  },
  selectAll() { if (app.mode === 'paint') actions.selectMany(app.doc.layers.filter(l => l.visible && !l.locked && !isArea(l)).map(l => l.id)); },
  copy() {
    const ls = selectedLayers();
    if (ls.length) { app.clipboard = ls.map(cloneLayer); ui.refreshChrome(); }
  },
  paste(from = app.clipboard) {
    if (!from || !from.length || app.mode !== 'paint') return;
    const made = from.map((src) => {
      const l = cloneLayer(src);
      if (!/ copy$/.test(l.name)) l.name += ' copy';
      moveLayer(l, 40, 40);
      return l;
    });
    // copies of two or more of a group's layers make a group of their own; a lone one joins none
    const n = new Map(), to = new Map();
    for (const l of made) if (l.groupId) n.set(l.groupId, (n.get(l.groupId) || 0) + 1);
    for (const l of made) {
      if (!l.groupId) continue;
      if (n.get(l.groupId) < 2) { l.groupId = null; continue; }
      if (!to.has(l.groupId)) {
        const g = (app.doc.groups || []).find(x => x.id === l.groupId), id = 'g' + newId();
        app.doc.groups = [...(app.doc.groups || []), { id, name: (g ? g.name : 'Group') + ' copy', collapsed: true, turn: g ? g.turn || 0 : 0 }];
        to.set(l.groupId, id);
      }
      l.groupId = to.get(l.groupId);
    }
    // a second paste lands beside the first, not on top of it
    if (from === app.clipboard) for (const src of from) moveLayer(src, 40, 40);
    app.doc.layers.push(...made);
    app.sel = made[made.length - 1].id;
    app.sels = made.length > 1 ? made.map(l => l.id) : [];
    change({ now: true });
  },
  duplicate() { const ls = selectedLayers(); if (ls.length) actions.paste(ls.map(cloneLayer)); },
  // one layer, from the x on its row in the Layers list
  removeLayer(id) {
    if (app.mode !== 'paint' || !app.doc.layers.some(l => l.id === id)) return;
    app.doc.layers = app.doc.layers.filter(l => l.id !== id);
    if (app.sel === id) app.sel = null;
    app.sels = app.sels.filter(x => x !== id);
    pruneGroups();
    change({ now: true });
  },
  remove() {
    const gone = new Set(selectedLayers().map(l => l.id));
    if (!gone.size || !canChange()) return;
    if (app.mode === 'finish') { app.ftarget = null; app.fmore = []; }
    app.doc.layers = app.doc.layers.filter(l => !gone.has(l.id));
    app.sel = null; app.sels = [];
    pruneGroups();
    change({ now: true });
  },
  // Group: the layers are picked up together from then on
  group() {
    const ls = selectedLayers();
    if (ls.length < 2 || app.mode !== 'paint') return;
    const id = 'g' + newId();
    app.doc.groups = [...(app.doc.groups || []), { id, name: 'Group', collapsed: true }]; // one row in the Layers list until it is opened
    for (const l of ls) l.groupId = id;
    // gathered together in the stack, where the front one is, so the Layers list shows them under the group
    const L = app.doc.layers, rest = L.filter(l => l.groupId !== id);
    rest.splice(L.indexOf(ls[ls.length - 1]) - ls.length + 1, 0, ...ls);
    app.doc.layers = rest;
    pruneGroups();
    change({ now: true });
  },
  ungroup() {
    const ls = selectedLayers().filter(l => l.groupId);
    if (!ls.length) return;
    for (const l of ls) l.groupId = null;
    pruneGroups();
    change({ now: true });
  },
  // Merge: the selected layers become one, in the top one's place. Shapes of
  // one colour become a single shape with several pieces, which can still be
  // recoloured, faded, mirrored, trimmed and reshaped. Anything else (text,
  // pictures, shapes of different colours) can only become one picture.
  async merge() {
    if (app.mode !== 'paint') return;
    const ids = new Set(selectedLayers().map(l => l.id));
    const targets = app.doc.layers.filter(l => ids.has(l.id) && l.visible && !isArea(l)); // back to front
    if (targets.length < 2) { ui.say('Select two or more layers to merge. Ctrl+click them, or drag a box round them.'); return; }
    const top = targets[targets.length - 1], spec = finishSpec(app.doc, top);
    const credits = cleanCredits(targets.flatMap(l => l.credits || [])); // whatever they become, the icons in them stay credited
    const same = (f) => targets.every(l => f(l) === f(top));
    const shapes = targets.every(l => isShape(l) || (isBox(l) && ['rect', 'ellipse', 'triangle'].includes(l.shape) && !l.flipH && !l.flipV));
    const sameColour = same(l => (l.color || '').toLowerCase());
    const sameRest = same(l => l.fillType || 'solid') && same(l => l.color2 || '') && same(l => JSON.stringify(l.stops || [])) && same(l => l.opacity ?? 1) && same(l => l.blend || '')
      && same(l => !!l.mirrored) && same(l => JSON.stringify(finishSpec(app.doc, l))) && same(l => JSON.stringify(l.clip || null))
      && same(l => JSON.stringify(l.repeat || null)); // copies and a plain shape are not the same thing
    // They cannot simply become one shape as they are: ask what is wanted.
    // → 'shape' (like the top one) | a colour for them all | 'group' | 'picture'
    let how = 'shape';
    if (!(shapes && sameColour && sameRest)) {
      const colours = [...new Set(targets.filter(l => l.type === 'fill').map(l => (l.color || '').toLowerCase()).filter(Boolean))];
      how = await ui.mergeChoice({ shapes, sameColour, colours, top: top.name });
      if (!how) return;
    }
    if (how === 'group') return actions.group();
    if (how !== 'picture') {
      if (how !== 'shape') { top.color = how; top.colorRef = null; keepFadeOut(top); } // the colour chosen for them all
      setShape(top, joined(targets.map(l => (isShape(l) ? l.pts : boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh)))));
      top.shape = 'path';
      if (credits.length) top.credits = credits;
      app.doc.layers = app.doc.layers.filter(l => l === top || !targets.includes(l));
      pruneGroups();
      app.sel = top.id; app.sels = [];
      change({ now: true });
      ui.say(`Merged ${targets.length} shapes into one. Split takes it apart again.`);
      return;
    }
    // their mirrored sides are part of what is painted, so they are part of the picture
    const sheet = paintLayers(withSeams(withMirrors(withTints({ ...app.doc, layers: targets }))).layers, { linearEdges: true });
    const px = sheet.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
    let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (px[(y * SIZE + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) { ui.say('Those layers paint nothing, so there is nothing to merge'); return; }
    const crop = document.createElement('canvas'); // just what was painted, so the layer's box is its artwork
    crop.width = x1 - x0 + 1;
    crop.height = y1 - y0 + 1;
    crop.getContext('2d').drawImage(sheet, -x0, -y0);
    const src = crop.toDataURL('image/png');
    const merged = createImageLayer(await loadImage(src), src, `${top.name} (merged)`);
    merged.x = x0 + crop.width / 2;
    merged.y = y0 + crop.height / 2;
    merged.scale = 1;
    merged.linearMix = true; // its soft edges and fades go on mixing the way its parts' did
    if (credits.length) merged.credits = credits;
    // one finish for the lot: the top layer's
    merged.material = spec.material; merged.matParams = spec.params ? { ...spec.params } : null; merged.finishOwn = spec.material !== 'gloss' || !!spec.params;
    const at = app.doc.layers.indexOf(top);
    app.doc.layers.splice(at, 1, merged);
    app.doc.layers = app.doc.layers.filter(l => !targets.includes(l));
    pruneGroups();
    app.sel = merged.id; app.sels = [];
    change({ now: true });
    const finishes = new Set(targets.map(l => JSON.stringify(finishSpec(app.doc, l))));
    ui.say(finishes.size > 1 ? `Merged ${targets.length} layers into a picture. They had different finishes, so it took the top one's.` : `Merged ${targets.length} layers into a picture. Ctrl+Z brings them back.`);
  },
  // Split: a shape of several pieces becomes one shape per piece again
  split() {
    const l = actions.selected();
    if (!l || !isShape(l) || app.mode !== 'paint') return;
    const parts = pieces(l.pts);
    if (parts.length < 2) return;
    const made = parts.map(([a, b], i) => {
      const c = cloneLayer(l);
      c.name = `${l.name} ${i + 1}`;
      setShape(c, l.pts.slice(a, b).map((p, k) => { const q = { x: p.x, y: p.y }; if (p.c) q.c = { ...p.c }; return q; }));
      return c;
    });
    app.doc.layers.splice(app.doc.layers.indexOf(l), 1, ...made);
    app.sel = made[made.length - 1].id;
    app.sels = made.map(x => x.id);
    change({ now: true });
  },
  // One shape pulled tight round the selected ones, like a rubber band: two
  // circles become a slot whose sides are tangent to both. It takes their
  // place, with the front one's colour and settings.
  wrap() {
    if (app.mode !== 'paint') return;
    const ids = new Set(selectedLayers().map(l => l.id));
    const targets = app.doc.layers.filter(l => ids.has(l.id) && l.visible && l.type === 'fill' && !isArea(l)); // back to front
    if (!targets.length) { ui.say('Select the shapes to wrap. Ctrl+click them, or drag a box round them.'); return; }
    const top = targets[targets.length - 1];
    const pts = wrapped(targets.map(l => (isShape(l) ? l.pts : boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh))));
    if (pts.length < 3) return;
    const credits = cleanCredits(targets.flatMap(l => l.credits || []));
    top.shape = 'path'; top.flipH = top.flipV = false;
    setShape(top, pts);
    if (credits.length) top.credits = credits;
    app.doc.layers = app.doc.layers.filter(l => l === top || !targets.includes(l));
    pruneGroups();
    app.sel = top.id; app.sels = [];
    change({ now: true });
  },
  // an outline-style shape made solid: its holes, and anything inside them, go
  fillIn() {
    const ls = selectedLayers().filter(l => isShape(l) && hasInner(l.pts));
    if (!ls.length || !canChange()) return;
    for (const l of ls) setShape(l, outerOnly(l.pts));
    change({ now: true });
  },
  // +1 forward, -1 back: every selected layer (a whole group, when that is
  // picked) steps past the next layer, or past the next group whole
  order(dir) {
    const L = app.doc.layers, on = new Set(selectedLayers().map(l => l.id));
    if (!on.size || !canChange()) return;
    const runs = []; // [first, last] of each stretch of selected layers, back to front
    L.forEach((l, i) => { if (!on.has(l.id)) return; const r = runs[runs.length - 1]; r && r[1] === i - 1 ? (r[1] = i) : runs.push([i, i]); });
    let moved = false;
    for (const [a, b] of dir > 0 ? runs.reverse() : runs) { // the one furthest ahead goes first, into room the others then have
      const j = dir > 0 ? b + 1 : a - 1, g = L[j] && L[j].groupId;
      if (!L[j] || on.has(L[j].id)) continue;
      let k = j;
      if (g && g !== L[a].groupId) while (L[k + dir] && L[k + dir].groupId === g && !on.has(L[k + dir].id)) k += dir;
      const run = L.splice(a, b - a + 1);
      L.splice(dir > 0 ? k - run.length + 1 : k, 0, ...run);
      moved = true;
    }
    if (moved) { settleGroups(on); change({ now: true }); }
  },
  // to the very front (+1) or the very back (-1), every selected layer in the order they were in
  orderEnd(dir) {
    const on = new Set(selectedLayers().map(l => l.id));
    if (!on.size || !canChange()) return;
    const taken = app.doc.layers.filter(l => on.has(l.id)), rest = app.doc.layers.filter(l => !on.has(l.id));
    app.doc.layers = dir > 0 ? [...rest, ...taken] : [...taken, ...rest];
    settleGroups(on);
    change({ now: true });
  },
  front: () => actions.orderEnd(+1),
  back: () => actions.orderEnd(-1),
  // dragged in the Layers list: put layer `id` just in front of `targetId`
  // (above it in the list), or just behind it; 'base' means the very back
  // join: the group the layer is in after (null: none)
  // whole: every layer of id's group goes, in the order they were in, beside another group, never into it
  reorder(id, targetId, inFront, whole = false, join = null) {
    const L = app.doc.layers, moving = new Set(whole ? groupOf(id) : [id]);
    if (!L.some(l => l.id === id) || moving.has(targetId)) return;
    const tg = whole && (L.find(l => l.id === targetId) || {}).groupId;
    if (tg) { const ms = L.filter(l => l.groupId === tg); targetId = (inFront ? ms[ms.length - 1] : ms[0]).id; }
    const taken = L.filter(l => moving.has(l.id)), rest = L.filter(l => !moving.has(l.id));
    const at = targetId === 'base' ? -1 : rest.findIndex(x => x.id === targetId);
    rest.splice(targetId === 'base' ? 0 : at === -1 ? rest.length : at + (inFront ? 1 : 0), 0, ...taken);
    app.doc.layers = rest;
    app.sel = id;
    if (whole) app.sels = taken.length > 1 ? taken.map(l => l.id) : [];
    else { taken[0].groupId = join; pruneGroups(); }
    change({ now: true });
  },
  // a group as one row in the Layers list, or as a row for each of its layers
  foldGroup(gid) {
    const g = (app.doc.groups || []).find(x => x.id === gid);
    if (!g) return;
    g.collapsed = !g.collapsed;
    // ponytail: only the list redraws; not a paint change, so no redraw, save, send or undo step. It is saved with the next edit
    ui.refresh();
  },
  renameLayer(id, name) {
    const l = app.doc.layers.find(x => x.id === id);
    if (!l) return;
    l.name = name;
    change({ now: true });
  },
  renameGroup(gid, name) {
    const g = (app.doc.groups || []).find(x => x.id === gid);
    if (!g) return;
    g.name = name;
    change({ now: true });
  },
  showGroup(gid) {
    const ms = app.doc.layers.filter(l => l.groupId === gid), on = !ms.some(l => l.visible);
    for (const l of ms) l.visible = on;
    change();
  },
  removeGroup(gid) {
    if (app.mode !== 'paint') return;
    const gone = new Set(app.doc.layers.filter(l => l.groupId === gid).map(l => l.id));
    app.doc.layers = app.doc.layers.filter(l => !gone.has(l.id));
    if (gone.has(app.sel)) app.sel = null;
    app.sels = app.sels.filter(x => !gone.has(x));
    pruneGroups();
    change({ now: true });
  },
  forward: () => actions.order(+1),
  backward: () => actions.order(-1),
  nudge(dx, dy) {
    const ls = selectedLayers().filter(l => !l.locked);
    if (!ls.length || !canChange()) return;
    for (const l of ls) moveLayer(l, dx, dy);
    change({ panels: false });
  },
  // ---- text and pictures ----
  addText(p) {
    const l = createTextLayer();
    l.text = 'Text';
    l.name = 'Text';
    l.font = app.font;
    l.textColor = app.colour;
    l.x = Math.round(p.x); l.y = Math.round(p.y);
    regenerateText(l);
    app.doc.layers.push(l);
    app.tool = 'select';
    app.sel = l.id;
    toolChanged();
    ensureDocFonts();
    change({ now: true });
    // type straight away — once this press is over, or the sheet takes the focus back
    setTimeout(() => ui.focusField('f-text'), 0);
  },
  // the selected shape, turned round its middle to stand at deg
  turnTo(deg) {
    const l = actions.selected();
    if (!Number.isFinite(deg)) return;
    if (selectedLayers().length > 1) tools.turnManyTo(deg);
    else if (l && l.type === 'fill') tools.turnTo(l, deg);
    else return;
    change({ panels: false });
  },
  manyTurn: () => (tools ? tools.manyTurnNow() : null),
  // one setting of the selected layer (or of each selected); text settings redraw the text
  setProp(key, value) {
    if (!actions.selected()) return;
    for (const l of selectedLayers()) {
      if (key.startsWith('fx.')) l.fx = { ...(l.fx || {}), [key.slice(3)]: value };
      else l[key] = value;
      if (l.type === 'text' && TEXT_KEYS.has(key)) {
        if (key === 'text') l.name = String(value).split('\n')[0].trim().slice(0, 24) || 'Text';
        regenerateText(l);
        if (key === 'fontWeight' || key === 'italic') ensureDocFonts(); // that face of the font may still have to be fetched
      }
    }
    change({ panels: false });
  },
  // The weights a font can be drawn in, for the Weight list: [] while that is
  // not known yet (the panel is drawn again when it is) or when there is only one.
  fontWeights(family) {
    if (TEXT_FONTS.includes(family)) return [400, 700]; // the computer's own fonts: the browser makes the bold
    if (!isWebFont(family)) return [];                  // an uploaded file is one weight
    if (fontFaces[family]) return fontFaces[family].weights.length > 1 ? fontFaces[family].weights : [];
    findFaces(family).then((info) => { const l = actions.selected(); if (info && info.weights.length > 1 && l && l.type === 'text' && l.font === family) ui.refresh(); });
    return [];
  },
  setFont(name) {
    if (name === '__upload') { $('file-font').click(); ui.refresh(); return; }
    if (name === '__google') { ui.refresh(); return actions.addGoogleFont(); }
    const l = actions.selected();
    app.font = name;
    if (!l || l.type !== 'text') return;
    l.font = name;
    l.fontWeight = null; // the new font as it comes; its own weights are offered once they are known
    regenerateText(l);
    ensureDocFonts(); // a Google font arrives a moment later and the text is redrawn in it
    change({ now: true });
  },
  // any font on Google Fonts, by its name
  async addGoogleFont() {
    const typed = await ui.askText({ title: 'Add a Google font', label: 'Font name', value: '', ok: 'Add' });
    if (!typed) return;
    const clean = typed.trim().replace(/\s+/g, ' ');
    ui.say(`Looking for ${clean}…`);
    // Google's names are case-sensitive: try it as typed, then with each word capitalised
    let name = null;
    for (const cand of new Set([clean, clean.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())])) {
      if (await loadWebFont(cand)) { name = cand; break; }
    }
    if (!name) { ui.say(`No Google font called "${clean}" was found. Check the spelling and capitals.`, true); return; }
    const d = app.doc;
    d.googleFonts = [...new Set([...(d.googleFonts || []), name])];
    actions.setFont(name);
    if (!actions.selected()) change();
    ui.refresh();
    ui.say(`${name} added`);
  },
  async uploadFont(file) {
    if (file.size > 4 * 1024 * 1024) { ui.say('That font file is over 4 MB', true); return; }
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]+/g, ' ').trim() || 'custom font';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(bin);
      await registerCustomFont(name, data);
      const d = app.doc;
      d.customFonts = (d.customFonts || []).filter(f => f.name !== name); // a re-upload replaces
      d.customFonts.push({ name, data });
      actions.setFont(name);
      if (!actions.selected()) change();
      ui.say(`${name} added. It is saved with this livery.`);
    } catch {
      ui.say('That file is not a usable font', true);
    }
  },
  pickImage: () => $('file-image').click(),
  // at: where on the sheet its centre goes (the middle of the view if not given)
  async addImageFile(file, at) {
    try {
      const src = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      await actions.addImage(src, file.name.replace(/\.[^.]+$/, ''), at);
    } catch {
      ui.say('Could not read that picture', true);
    }
  },
  // keep: remember it in the library (not for the built-in graphics, which are there already)
  async addImage(src, name, at, keep = true) {
    let img = await loadImage(src);
    // A picture bigger than the sheet is brought down to it: it is never shown
    // larger on the car, and kept at full size it filled memory, the saved
    // livery, every undo step and the library (a 4000px logo is 64 MB decoded)
    const k = SIZE / Math.max(img.width, img.height);
    if (k < 1) try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      src = /^data:image\/jpeg/i.test(src) ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png'); // a photo stays a JPEG: as a PNG it would be several times the size
      img = await loadImage(src);
    } catch { /* one that cannot be read back (from another site) is kept as it is */ }
    const l = createImageLayer(img, src, name || 'Picture');
    if (keep && !library.logos.some(x => x.src === src)) {
      library.logos.unshift({ id: 'g' + newId(), name: name || 'Picture', src });
      library.logos.length = Math.min(library.logos.length, 80); // ponytail: the oldest fall off; add folders if 80 is ever tight
      saveLibrary();
    }
    const mid = at || screenToDoc(cv.clientWidth / 2, cv.clientHeight / 2);
    l.x = Math.round(Math.max(0, Math.min(SIZE, mid.x)));
    l.y = Math.round(Math.max(0, Math.min(SIZE, mid.y)));
    app.doc.layers.push(l);
    actions.setTool('select');
    app.sel = l.id;
    change({ now: true });
  },

  // A whole livery as one .overspray file: the same data the browser saves
  // (serializeDoc), so the template, pictures and custom fonts are inside it
  // and it opens on another computer or on the website as it was.
  exportLivery() {
    download(new Blob([JSON.stringify(serializeDoc(app.doc))], { type: 'application/json' }), safeName() + '.overspray');
    ui.say(`Downloaded ${safeName()}.overspray`);
  },
  pickLivery: () => $('file-livery').click(),
  async openLiveryFile(file) {
    let data;
    try {
      if (file.size > LIVERY_FILE_MAX) throw new Error('too big');
      data = JSON.parse(await file.text());
    } catch { data = null; }
    const format = data && typeof data.format === 'string' ? data.format : '';
    if (format !== 'overspray/1') {
      ui.say(/^overspray\/\d+$/.test(format) ? 'This livery is from a newer Overspray: reload the page to update, then open it again' : 'That is not an Overspray livery file', true);
      return;
    }
    try {
      const doc = await deserializeDoc(data);
      // the livery on screen is not lost: one never saved is kept as a project first
      const d = app.doc;
      let kept = '';
      if (!app.projectId && (d.layers.length || d.template)) {
        app.projectId = Date.now().toString(36);
        lastJson = null; // it is autosaved already, but not yet as a project
        if (await runSave() !== false) kept = ` · The one before is in Open… as ${d.name}`;
      }
      // always a new project: opening a file never writes over one already here
      await setDoc(doc, Date.now().toString(36) + 'f');
      await runSave();
      ui.refreshChrome();
      ui.say(`Opened ${doc.name}${kept}`);
    } catch {
      ui.say('Could not open that livery file', true);
    }
  },

  // A finished paint (a TGA from the iRacing folder, or a PNG/JPG) as a
  // picture layer stretched over the whole sheet, at the bottom so new layers
  // and the template lines go over it. Not kept in the library: it is big.
  pickPaint: () => $('file-paint').click(),
  async importPaint(file) {
    if (/\.(psd|xcf)$/i.test(file.name)) return actions.importPsd(file);
    ui.say('Reading paint…');
    try {
      let src;
      if (/\.tga$/i.test(file.name)) {
        const { w, h, rgba } = decodeTGA(await file.arrayBuffer(), { opaque: true });
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
        src = c.toDataURL('image/png');
      } else {
        src = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
      }
      let img = await loadImage(src);
      if (Math.max(img.width, img.height) > SIZE) { // a 4096 paint would be 64 MB decoded; the sheet shows 2048
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, SIZE, SIZE);
        src = c.toDataURL('image/png');
        img = await loadImage(src);
      }
      const l = createImageLayer(img, src, file.name.replace(/\.[^.]+$/, ''));
      l.scale = SIZE / img.width;
      l.scaleY = img.width === img.height ? null : SIZE / img.height;
      app.doc.layers.unshift(l);
      const kept = keepColours([{ name: l.name, src: img, scale: l.scale, scaleY: l.scaleY }]);
      if (app.mode !== 'paint') actions.setMode('paint');
      actions.setTool('select');
      app.sel = l.id;
      change({ now: true });
      ui.say((img.width === SIZE && img.height === SIZE ? 'Paint added as the bottom layer' : `Paint added as the bottom layer, stretched from ${img.width}x${img.height} to fit the sheet`) + (kept ? `, ${kept} colours saved to the colour list` : '') + (app.doc.template ? '' : ". Open the car's blank template too for panel lines"));
      // asked (one of the few popups): each flat colour as a shape, so finishes can go by colour
      if (!await ui.ask({ title: 'Split the paint into colours?', body: 'Each flat colour becomes a shape, so finishes can be set by colour. Fine detail and fades come out rougher. Make shapes in Properties does this later too.', ok: 'Split colours', cancel: 'Keep as one picture' })) return;
      if (!app.doc.layers.includes(l)) return;
      // Make shapes leaves the background out (right for a logo); on a paint it is the base coat, so the base coat takes it
      const g = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const corners = [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]].map(([x, y]) => { g.clearRect(0, 0, 1, 1); g.drawImage(img, x, y, 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; });
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 24);
      const bg = corners.find(c => corners.filter(o => near(c, o)).length >= 3);
      if (bg) { app.doc.baseColor = '#' + bg.map(v => v.toString(16).padStart(2, '0')).join(''); app.doc.baseRef = null; }
      app.sel = l.id; app.sels = [];
      actions.makeShapes();
    } catch (err) {
      ui.say('Could not read that paint: ' + (err.message || 'unknown error'), true);
    }
  },

  // A livery PSD or GIMP file as its layers (see psdToLayers), at the bottom like a flat
  // paint. With no template yet, a PSD made from a kit is the template too.
  async importPsd(file) {
    const d = app.doc;
    ui.say('Reading layers…');
    try {
      const { layers, lost, kit, spec } = await (/\.xcf$/i.test(file.name) ? xcfToLayers : psdToLayers)(await file.arrayBuffer());
      if (!d.template && kit) await actions.loadTemplateFile(file);
      if (!layers.length) { ui.say('No layers to bring in from that file', true); return; }
      const made = [], groups = new Map(); // PSD group name → its layers
      for (const e of layers) {
        const src = e.canvas.toDataURL('image/png');
        const l = createImageLayer(await loadImage(src), src, e.name);
        Object.assign(l, { x: e.x, y: e.y, scale: e.scale, scaleY: e.scaleY, opacity: e.opacity, blend: e.blend, visible: e.visible });
        if (e.group) groups.set(e.group, [...(groups.get(e.group) || []), l]);
        made.push(l);
      }
      for (const [name, ls] of groups) {
        if (ls.length < 2) continue; // a group of one is just the layer
        const id = 'g' + newId();
        d.groups = [...(d.groups || []), { id, name, collapsed: true }];
        for (const l of ls) l.groupId = id;
      }
      d.layers.unshift(...made);
      // multiply layers (shading) are not colours of the livery
      const kept = keepColours(layers.filter(e => e.visible && !e.blend).map(e => ({ name: e.name, src: e.canvas, scale: e.scale, scaleY: e.scaleY })));
      const areas = spec ? specToAreas(spec) : 0;
      if (app.mode !== 'paint') actions.setMode('paint');
      actions.setTool('select');
      app.sel = made[made.length - 1].id;
      change({ now: true });
      const notes = [kept && `${kept} colours saved to the colour list`, areas && `the spec map as ${areas} Spec areas`, lost.patterns && 'Car Patterns left out (iRacing\'s stock patterns are not imported)', lost.hidden && `${lost.hidden} turned off, as they were in the file`, lost.fx && `${lost.fx} without their effects (shadows, strokes)`, lost.blend && `${lost.blend} with a blend mode Overspray lacks, as normal`, lost.text && `${lost.text} text as pictures`].filter(Boolean);
      ui.say(`${made.length} layers added at the bottom` + (notes.length ? `: ${notes.join(', ')}` : ''), !!(lost.fx || lost.blend || lost.text)); // turned off is not a loss
    } catch (err) {
      ui.say('Could not read the layers in that file: ' + (err.message || 'unknown error'), true);
    }
  },

  // ---- the library ----
  // Kept in this browser, across liveries: pictures you have brought in, and
  // shapes you have saved. The built-in graphics come with the app.
  async openLibrary() {
    const pick = await ui.library(library, {
      remove(kind, id) { library[kind] = library[kind].filter(x => x.id !== id); saveLibrary(); },
      search: searchIcons, fetchIcon: iconShape,
      shapesOnly: !!app.workshop, // drawing a shape: only shapes can become part of it
    });
    if (!pick) return;
    if (pick.kind === 'draw') return startShape();
    if (pick.kind === 'file') return actions.pickImage();
    if (pick.kind === 'shapefile') return $('file-shape').click();
    if (pick.kind === 'logos') return actions.addImage(pick.item.src, pick.item.name);
    if (pick.kind === 'shapes') return actions.addShape(pick.item);
    if (pick.kind === 'sets') return actions.addSet(pick.item);
    if (pick.kind === 'icon') return actions.addShape(keepShape(pick.item));
  },
  // a shape from an SVG file: kept in the library, and put on the sheet
  async addShapeFile(file) {
    try {
      const made = svgToShape(await file.text());
      actions.addShape(keepShape({ name: file.name.replace(/\.[^.]+$/, '') || 'Shape', shape: 'path', ...made }));
    } catch (err) {
      ui.say(err.message || 'That file could not be read as a shape', true);
    }
  },
  // who is to be credited for what is in the livery: icons from the open sets, wherever they ended up
  credits() {
    const all = [];
    for (const l of app.doc.layers) all.push(...(l.credits || []), ...(l.repeat ? l.repeat.shapes.flatMap(m => m.credits || []) : []));
    return cleanCredits(all);
  },
  // Several layers kept in the library as one thing. They are kept as a
  // livery keeps them (see serializeDoc), with a small picture to show in the
  // library, and without what belongs to the place they were made: their
  // trim, their Mirrored switch, and which saved colour they followed.
  async saveSet() {
    const ls = selectedLayers();
    if (ls.length < 2) return;
    const g = ls[0].groupId && ls.every(l => l.groupId === ls[0].groupId) ? (app.doc.groups || []).find(x => x.id === ls[0].groupId) : null;
    const name = await ui.askText({ title: 'Save to the library', label: 'Name', value: g && g.name !== 'Group' ? g.name : ls[0].name, ok: 'Save' });
    if (!name) return;
    const cs = ls.flatMap(l => layerCorners(l)), xs = cs.map(q => q.x), ys = cs.map(q => q.y);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), h = Math.max(1, Math.max(...ys) - y);
    const layers = serializeDoc({ ...app.doc, layers: ls }).layers.map(l => ({ ...l, clip: undefined, clipAt: undefined, mirrored: false, colorRef: null, groupId: null }));
    // its picture: the layers alone, as they are painted, at library size
    const sheet = paintLayers(withTints({ ...app.doc, layers: ls }).layers, { linearEdges: true });
    const k = 160 / Math.max(w, h), t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(w * k)); t.height = Math.max(1, Math.round(h * k));
    const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(sheet, x, y, w, h, 0, 0, t.width, t.height);
    library.sets.unshift({ id: 't' + newId(), name, x, y, w, h, layers, thumb: t.toDataURL('image/png') });
    saveLibrary();
    ui.say(`${name} saved to the library, under Your shapes`);
  },
  // …and put on the sheet again: in the middle of the view, as a group of its own
  async addSet(item) {
    let made;
    try { made = (await deserializeDoc({ format: 'overspray/1', layers: item.layers })).layers; } catch { made = []; }
    if (!made.length) { ui.say('That library item could not be read', true); return; }
    const mid = screenToDoc(cv.clientWidth / 2, cv.clientHeight / 2), dx = Math.round(mid.x - (item.x + item.w / 2)), dy = Math.round(mid.y - (item.y + item.h / 2));
    const gid = 'g' + newId();
    for (const l of made) { l.id = newId(); l.groupId = gid; moveLayer(l, dx, dy); }
    app.doc.groups = [...(app.doc.groups || []), { id: gid, name: item.name, collapsed: true }];
    app.doc.layers.push(...made);
    ensureDocFonts();
    actions.setTool('select');
    app.sel = made[made.length - 1].id; app.sels = made.length > 1 ? made.map(l => l.id) : [];
    change({ now: true });
  },
  saveShape() {
    if (selectedLayers().length > 1) return actions.saveSet();
    const l = actions.selected();
    if (!l || l.type !== 'fill') return;
    const item = { id: 's' + newId(), name: l.name, shape: l.shape, w: l.rw, h: l.rh };
    if (l.credits && l.credits.length) item.credits = l.credits; // made from an icon: the credit goes with it
    if (isShape(l)) item.pts = moved(l.pts, -l.rx, -l.ry); // from its own corner, so it can be put anywhere
    library.shapes.unshift(item);
    saveLibrary();
    ui.say(`${l.name} saved to the library`);
  },
  addShape(item) {
    const l = createFillLayer(app.colour), mid = screenToDoc(cv.clientWidth / 2, cv.clientHeight / 2);
    const x = Math.round(mid.x - item.w / 2), y = Math.round(mid.y - item.h / 2);
    l.name = item.name;
    l.shape = item.shape;
    if (item.credits && item.credits.length) l.credits = item.credits;
    if (item.pts) setShape(l, moved(item.pts, x, y));
    else { l.rx = x; l.ry = y; l.rw = item.w; l.rh = item.h; }
    app.doc.layers.push(l);
    actions.setTool('select');
    app.sel = l.id;
    change({ now: true });
  },

  // ---- colour ----
  // what the colour controls are showing: the selection's colour, else the
  // colour the next shape will get
  selCorner,
  swatchAt,
  currentColour() {
    const l = actions.selected();
    if (app.sel === 'base') return app.doc.baseColor;
    if (swatchAt(app.sel)) return swatchAt(app.sel).color;
    if (l && l.type === 'text') return l.textColor || app.colour;
    return l && (l.type === 'fill' || l.type === 'image') && l.color ? l.color : app.colour;
  },
  // Sets the selection's colour (base coat or a fill) and the colour for new
  // shapes. ref: the saved colour it now follows, or null for a one-off.
  // typed: it came from a control the user is still holding, so panels stay.
  applyColour(hex, { ref = null, typed = false } = {}) {
    if (!swatchAt(app.sel)) app.colour = hex; // an extra's colour is not the next shape's: a logo on the pitboard would vanish into it
    let painted = 0;
    if (app.sel === 'base') { app.doc.baseColor = hex; app.doc.baseRef = ref; painted = 1; }
    else if (swatchAt(app.sel)) { Object.assign(swatchAt(app.sel), { color: hex, ref }); painted = 1; }
    else for (const l of selectedLayers()) { // every selected shape and text takes it
      if (l.type === 'fill') { l.color = hex; l.colorRef = ref; keepFadeOut(l); painted++; }
      else if (l.type === 'text') { l.textColor = hex; l.colorRef = ref; regenerateText(l); painted++; }
      else if (l.type === 'image') { l.color = hex; l.colorRef = ref; painted++; } // the whole picture, one colour
    }
    if (!painted) { if (!typed) ui.refresh(); return; } // nothing to paint: just the next shape's colour
    change({ panels: !typed });
  },
  setColour: (hex) => actions.applyColour(hex, { typed: true }),
  // A flat-colour picture (a logo, say) becomes shapes: one for each colour in
  // it, in a group where the picture was. The picture's background is left out.
  makeShapes() {
    const l = actions.selected();
    if (!l || (l.type !== 'image' && l.type !== 'text') || !l.img || !canChange()) return; // text is a picture of its letters
    const iw = l.img.naturalWidth || l.img.width, ih = l.img.naturalHeight || l.img.height;
    const k = Math.min(1, TRACE_PX / Math.max(iw, ih)), w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(l.img, 0, 0, w, h);
    let found;
    try { found = traceImage(g.getImageData(0, 0, w, h).data, w, h); } catch { ui.say('That picture cannot be read. Bring it in again as a file from your computer.', true); return; }
    if (!found.length) { ui.say('No flat colours found in that picture, so there are no shapes to make', true); return; }
    // from the picture's own pixels to where it lies on the sheet
    const m = layerMatrix(l), r = (v) => Math.round(v * 100) / 100;
    const at = (q) => { const p = m.transformPoint(new DOMPoint(q.x / k - iw / 2, q.y / k - ih / 2)); return { x: r(p.x), y: r(p.y) }; };
    const gid = 'g' + newId();
    const made = found.map(({ color, pts }, i) => {
      const s = createFillLayer(l.color || color || app.colour); // a mask's cut-out has no colour of its own: it takes the current one
      s.name = found.length > 1 ? `${l.name} ${i + 1}` : l.name;
      s.shape = 'path'; s.opacity = l.opacity;
      setShape(s, shapeMapped(pts, at));
      if (l.clip) { s.clip = structuredClone(l.clip); s.clipAt = l.clipAt ? structuredClone(l.clipAt) : null; } // it stays trimmed to the same panels
      s.mirrored = !!l.mirrored;
      if (found.length > 1) s.groupId = gid;
      return s;
    });
    if (found.length > 1) app.doc.groups = [...(app.doc.groups || []), { id: gid, name: l.name, collapsed: true }];
    app.doc.layers.splice(app.doc.layers.indexOf(l), 1, ...made);
    app.sel = made[made.length - 1].id; app.sels = made.length > 1 ? made.map(s => s.id) : [];
    change({ now: true });
    ui.say(made.length > 1 ? `${made.length} shapes made, one for each colour, in a group` : 'Made into a shape');
  },
  // a coloured picture back to its own colours
  ownColours() {
    for (const l of selectedLayers()) if (l.type === 'image') { l.color = undefined; l.colorRef = null; }
    change();
  },
  usePalette(id) {
    const c = app.doc.palette.find(x => x.id === id);
    if (c) actions.applyColour(c.color, { ref: id });
  },
  async saveColour() {
    const d = app.doc, color = actions.currentColour();
    const name = await ui.askText({ title: 'Save this colour', label: 'Name', value: ['Main', 'Accent', 'Trim', 'Detail'][d.palette.length] || 'Colour ' + (d.palette.length + 1), ok: 'Save' });
    if (!name) return;
    const entry = { id: 'c' + newId(), name, color };
    d.palette.push(entry);
    actions.applyColour(color, { ref: entry.id }); // what is selected now follows it
    if (!actions.selected() && !fixedSel()) change();
  },
  // Palettes: sets of colours kept in this browser, for any livery to use,
  // and as files to share or keep somewhere safe
  async openPalettes() {
    const pick = await ui.palettes(library.palettes);
    const p = pick && library.palettes[pick.i];
    if (!pick) return;
    if (pick.act === 'save') return actions.liveryColours({ save: true });
    if (pick.act === 'import') return $('file-palette').click();
    if (pick.act === 'use') return actions.usePaletteSet(p);
    if (pick.act === 'export') {
      download(new Blob([JSON.stringify({ overspray: 'palette', ...p }, null, 2)], { type: 'application/json' }), p.name.replace(/[^\w.-]+/g, '_') + '.palette.json');
      return;
    }
    if (pick.act === 'delete') { // confirmed in the list. The saved colours it added to this livery go too: what is in them keeps the colour
      const d = app.doc, ids = new Set(d.palette.filter(c => c.from === p.name).map(c => c.id));
      if (ids.size) {
        d.palette = d.palette.filter(c => !ids.has(c.id));
        for (const l of d.layers) if (ids.has(l.colorRef)) l.colorRef = null;
        if (ids.has(d.baseRef)) d.baseRef = null;
        change({ now: true });
      }
      library.palettes.splice(pick.i, 1);
      saveLibrary();
    }
    actions.openPalettes();
  },
  // a palette of the same name is replaced
  keepPalettes(list) {
    for (const p of list) library.palettes = [p, ...library.palettes.filter(x => x.name !== p.name)];
    saveLibrary();
  },
  // Livery colours: every colour it has (the base coat first, then the saved
  // ones, then the rest it uses), each named and changed in one place. A
  // change reaches everything in that colour, its finish and repeats too, and
  // each becomes a saved colour that what is in it follows. `save`: kept as a
  // palette as well.
  async liveryColours({ save = false } = {}) {
    const d = app.doc, rows = [];
    const add = (name, color, id) => { if (color && !rows.some(r => r.color === color)) rows.push({ name, color, id }); };
    const base = String(d.baseColor || '').toLowerCase();
    add(BASE_COAT, base, d.baseRef);
    for (const c of d.palette) add(c.name, c.color, c.id);
    for (const color of ui.usedColours(Infinity)) add('Colour ' + (rows.length + 1), color);
    const res = await ui.liveryColours(rows, save);
    if (!res) return;
    const saved = new Map(); // a colour as it was → its saved colour, as it is now
    res.colors.forEach((r, k) => {
      const was = rows[k];
      let c = d.palette.find(x => x.id === was.id) || d.palette.find(x => x.color === was.color);
      if (!c) { c = { id: 'c' + newId() }; d.palette.push(c); }
      Object.assign(c, r);
      saved.set(was.color, c);
    });
    const now = (hex) => (saved.get(String(hex || '').toLowerCase()) || {}).color || hex;
    for (const l of d.layers) {
      const c = saved.get(layerColour(l));
      if (c) {
        l.colorRef = c.id;
        if (l.type === 'text') { l.textColor = c.color; regenerateText(l); } else { l.color = c.color; if (l.type === 'fill') keepFadeOut(l); }
      }
      if (l.repeat && Array.isArray(l.repeat.colors)) l.repeat.colors = l.repeat.colors.map(now);
    }
    const b = saved.get(base);
    if (b) { d.baseColor = b.color; d.baseRef = b.id; }
    for (const r of d.finishRules || []) r.color = now(r.color);
    change({ now: true });
    if (!save) return;
    // its fonts go with it: those added by name, the built-in Google ones its
    // text uses, and the uploaded ones
    const google = [...(d.googleFonts || []), ...d.layers.filter(l => l.type === 'text' && GOOGLE_FONTS.includes(l.font)).map(l => l.font)];
    actions.keepPalettes(readPalettes({ name: res.name, colors: res.colors, fonts: { google, custom: d.customFonts } }));
    ui.say(`Palette "${res.name}" saved. Any livery can use it from Palettes.`);
  },
  // its colours join this livery's saved colours (one already there is not
  // added twice), the one named Base coat goes on the base coat, and its fonts
  // join the livery's
  async usePaletteSet(p) {
    const d = app.doc;
    let added = 0, base = null;
    for (const c of p.colors) {
      let saved = d.palette.find(x => x.color === c.color);
      if (!saved) { saved = { id: 'c' + newId(), name: c.name, color: c.color, from: p.name }; d.palette.push(saved); added++; } // from: so deleting the palette takes it out again
      if (c.name.trim().toLowerCase() === BASE_COAT.toLowerCase()) base = saved;
    }
    if (base) { d.baseColor = base.color; d.baseRef = base.id; }
    let fonts = 0;
    const f = p.fonts || { google: [], custom: [] };
    d.googleFonts = d.googleFonts || []; d.customFonts = d.customFonts || [];
    for (const name of f.google) if (!d.googleFonts.includes(name)) { d.googleFonts.push(name); fonts++; }
    for (const font of f.custom) {
      if (d.customFonts.some(x => x.name === font.name)) continue;
      try { await registerCustomFont(font.name, font.data); d.customFonts.push({ name: font.name, data: font.data }); fonts++; } catch { /* not a usable font: left out */ }
    }
    change({ now: true });
    ui.say((added ? `${added} colour${added > 1 ? 's' : ''} from "${p.name}" added` : `This livery already has every colour in "${p.name}"`) + (base ? ', base coat set' : '') + (fonts ? `, ${fonts} font${fonts > 1 ? 's' : ''} added` : ''));
  },
  async loadPaletteFile(file) {
    let list = [];
    try { list = readPalettes(JSON.parse(await file.text()), file.name.replace(/(\.palette)?\.json$/i, '')); } catch { /* not JSON */ }
    if (!list.length) { ui.say('No colours found in that file', true); return; }
    actions.keepPalettes(list);
    for (const p of list) await actions.usePaletteSet(p); // and straight onto this livery
  },
  // the selection's colour, named from Properties: its saved colour is renamed,
  // or it is saved under that name and what is selected is set to it
  nameColour(name) {
    const d = app.doc, sel = actions.selected(), color = String(actions.currentColour()).toLowerCase();
    name = String(name).trim().slice(0, 40);
    const ref = app.sel === 'base' ? d.baseRef : swatchAt(app.sel) ? swatchAt(app.sel).ref : sel ? sel.colorRef : null;
    let c = d.palette.find(x => x.id === ref) || d.palette.find(x => x.color === color);
    if (!name) { ui.refresh(); return; }
    if (c && c.id === ref) { c.name = name; change({ now: true }); return; }
    if (c) c.name = name;
    else d.palette.push(c = { id: 'c' + newId(), name, color });
    actions.applyColour(c.color, { ref: c.id }); // what is selected now follows it
    if (!sel && !fixedSel()) change();
  },
  async editColour(id) {
    const d = app.doc, c = d.palette.find(x => x.id === id);
    if (!c) return;
    const res = await ui.editColour(c);
    if (!res) return;
    if (res === 'delete') {
      d.palette = d.palette.filter(x => x.id !== id);
      for (const l of d.layers) if (l.colorRef === id) l.colorRef = null; // they keep the colour, just stop following
      if (d.baseRef === id) d.baseRef = null;
      for (const p of d.swatches) if (p.ref === id) p.ref = null;
    } else {
      c.name = res.name || c.name;
      c.color = res.color;
      for (const l of d.layers) { // everything following it changes with it
        if (l.colorRef !== id) continue;
        if (l.type === 'text') { l.textColor = c.color; regenerateText(l); } else { l.color = c.color; keepFadeOut(l); }
      }
      if (d.baseRef === id) d.baseColor = c.color;
      for (const p of d.swatches) if (p.ref === id) p.color = c.color;
    }
    change({ now: true });
  },

  // the top bar's button: the other one of light and dark from what is showing now
  flipTheme() {
    const dark = app.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : app.theme === 'dark';
    actions.setTheme(dark ? 'light' : 'dark');
  },
  setTheme(theme) {
    app.theme = theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('next-theme', theme); } catch { /* fine */ }
    requestDraw(); // the selection outline takes the accent colour
    ui.refreshChrome();
  },

  // add: Ctrl- or Shift-click — it joins the selection, or leaves it
  // Shift+click in the Layers list: everything from the row clicked last to
  // this one, both included, as a file list does it. The row clicked last
  // stays the end the next Shift+click measures from.
  selectRange(id) {
    const L = app.doc.layers.filter(l => !isArea(l)), to = L.findIndex(l => l.id === id);
    const from = L.findIndex(l => l.id === (anchor && L.some(l2 => l2.id === anchor) ? anchor : app.sel));
    if (to === -1 || from === -1) return actions.select(id);
    const kept = anchor && L.some(l => l.id === anchor) ? anchor : app.sel;
    actions.selectMany(L.slice(Math.min(from, to), Math.max(from, to) + 1).map(l => l.id));
    anchor = kept;
  },
  // alone: just this layer, though it is in a group (its own row in the
  // Layers list, or a double click on the sheet). Otherwise one of a group brings the rest.
  select(id, add = false, alone = false) {
    anchor = id;
    const b = swatchAt(id);
    app.board = b && b.points ? { p: b, had: new Set(app.doc.layers.map(l => l.id)) } : null;
    const real = id !== 'base' && app.doc.layers.some(l => l.id === id);
    if (id !== 'base' && !swatchAt(id) && !real) { app.sel = null; app.sels = []; }
    else if (add && real && app.sel && app.sel !== 'base') {
      const cur = new Set(selectedLayers().map(l => l.id)), had = cur.has(id);
      for (const m of (alone ? [id] : groupOf(id))) had ? cur.delete(m) : cur.add(m);
      app.sels = app.doc.layers.filter(l => cur.has(l.id)).map(l => l.id);
      app.sel = had ? app.sels[app.sels.length - 1] || null : id;
      if (app.sels.length < 2) app.sels = [];
    } else {
      const g = real && !alone ? groupOf(id) : [];
      app.sel = id;
      app.sels = g.length > 1 ? g : [];
    }
    requestDraw();
    ui.refresh();
  },
};

// ---------- pointer and keys ----------

let pan = null;
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (app.workshop) return; // the shape's window holds its view still
  const r = cv.getBoundingClientRect();
  setZoom(app.view.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // keys go to the sheet now
  if (app.workshop && (e.button === 1 || spaceHeld)) { e.preventDefault(); return; } // no panning there either
  // moving the sheet: the middle button, Space held, or the Hand tool (which needs nothing held:
  // a laptop touchpad freezes the pointer while a key is down, so Space-drag cannot work on one)
  if (e.button === 1 || (e.button === 0 && (spaceHeld || app.tool === 'hand'))) {
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('panning');
  } else if (e.button === 0) {
    cv.setPointerCapture(e.pointerId);
    onSheet().down(e, local(e));
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!pan) { onSheet().move(e, local(e)); return; }
  app.view.x += (e.clientX - pan.x) / app.view.zoom;
  app.view.y += (e.clientY - pan.y) / app.view.zoom;
  pan = { x: e.clientX, y: e.clientY };
  requestDraw();
});
const endPan = (e) => { if (!pan) onSheet().up(e, local(e)); pan = null; cv.classList.remove('panning'); };
cv.addEventListener('pointerup', endPan);
cv.addEventListener('pointercancel', endPan);
// right-click on a shape's point removes it; anywhere else the stage's menu opens
cv.addEventListener('contextmenu', (e) => {
  if (app.mode !== 'map' && tools.context(local(e))) { e.preventDefault(); e.stopPropagation(); }
});

// Shortcuts stay alive after a slider or colour box is used; only a box you
// type in swallows keys.
const typing = () => {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'button', 'file'].includes(el.type);
};
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
  // in a box you type in, only the keys that have nothing to do with typing work
  if ($('dlg').open || (typing() && !(mod && (k === 's' || k === 'm')))) return;
  if (e.code === 'Space') { spaceHeld = true; handCursor(); e.preventDefault(); return; }
  if (app.tool === 'hand' && k === 'escape') { actions.setTool('hand'); return; } // put down: back to the tool it came from
  if (!mod && carGrad && carGrad.key(e)) { e.preventDefault(); return; }
  if (!mod && onSheet().key(e)) { e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); app.workshop ? endShape(true) : actions.save(); return; }
  if (!mod && k === 'c' && !app.workshop) { actions.toggleGuide(); return; } // in every mode: which panel is which, on the sheet and on the car
  if (app.workshop && !mod && (k === 'f' || k === '+' || k === '=' || k === '-' || k === 'g' || k === 't' || k === 'h')) return; // its view is held still, and it has no panels or text
  if (app.mode === 'map') { // the layer keys below belong to Paint
    if (mod) return;
    if (k === 'f') fit();
    else if (k === 'h') actions.setTool('hand');
    else if (k === '+' || k === '=') actions.zoomBy(1.25);
    else if (k === '-') actions.zoomBy(0.8);
    else if (k === 'f1') { e.preventDefault(); ui.shortcuts(); }
    return;
  }
  if (app.mode === 'finish' && mod) return; // copy, paste, order and mirror belong to Paint
  if (mod && k === 'm') { e.preventDefault(); actions.mirror(); return; }
  if (mod && k === 'c') { actions.copy(); return; }
  if (mod && k === 'v') { e.preventDefault(); actions.paste(); return; }
  if (mod && k === 'd') { e.preventDefault(); actions.duplicate(); return; }
  if (mod && k === 'a') { e.preventDefault(); actions.selectAll(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? actions.ungroup() : actions.group(); return; }
  if (mod && k === 'e') { e.preventDefault(); actions.merge(); return; }
  // e.key is } and { with Shift held on most keyboards, so go by the physical key
  if (mod && e.code === 'BracketRight') { e.preventDefault(); e.shiftKey ? actions.front() : actions.forward(); return; }
  if (mod && e.code === 'BracketLeft') { e.preventDefault(); e.shiftKey ? actions.back() : actions.backward(); return; }
  if (mod) return;
  if (k.startsWith('arrow')) {
    const step = e.shiftKey ? 10 : 1;
    e.preventDefault();
    actions.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
    return;
  }
  if (k === 'delete' || k === 'backspace') { actions.remove(); return; }
  if (k === 'escape') { actions.select(null); return; }
  if (k === 'v') actions.setTool('select');
  else if (k === 'h') actions.setTool('hand');
  else if (k === 'p') actions.setTool('pen');
  else if (k === 'u') actions.setTool('shape');
  else if (k === 's' && app.mode === 'paint') actions.setTool('stamp'); // S and U as Photoshop has them
  else if (k === 'b' && app.mode === 'paint') actions.setTool('band');
  else if (k === 'g') actions.setTool('piece');
  else if (k === 't' && app.mode === 'paint') actions.setTool('text');
  else if (k === 'f') fit();
  else if (k === '+' || k === '=') actions.zoomBy(1.25);
  else if (k === '-') actions.zoomBy(0.8);
  else if (k === 'f1') { e.preventDefault(); ui.shortcuts(); } // not '?': on some keyboards that shares a key with an arrow
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; handCursor(); } });
window.addEventListener('blur', () => { spaceHeld = false; handCursor(); });
// a file dropped anywhere on the sheet is taken as a template
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  // a kit's PSD or GIMP file is a template; any other picture dropped on the sheet is a logo
  if (/\.overspray$/i.test(f.name)) actions.openLiveryFile(f);
  else if (/\.(psd|xcf)$/i.test(f.name)) actions.loadTemplateFile(f);
  else if (/\.tga$/i.test(f.name)) actions.importPaint(f); // a TGA is a paint (the browser cannot show one as a logo anyway)
  else if (app.mode === 'paint') actions.addImageFile(f, screenToDoc(...Object.values(local(e))));
});
for (const [id, fn] of [['file-image', (f) => actions.addImageFile(f)], ['file-paint', (f) => actions.importPaint(f)], ['file-livery', (f) => actions.openLiveryFile(f)], ['file-shape', (f) => actions.addShapeFile(f)], ['file-font', (f) => actions.uploadFont(f)]]) {
  $(id).addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) fn(f);
  });
}
$('file-template').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadTemplateFile(f);
});
$('file-palette').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadPaletteFile(f);
});
$('file-map').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadMapFile(f);
});
$('btn-empty-template').addEventListener('click', actions.pickTemplate);
$('btn-empty-paint').addEventListener('click', actions.pickPaint);
$('btn-empty-livery').addEventListener('click', actions.pickLivery);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-theme').addEventListener('click', () => actions.flipTheme());
$('btn-live').addEventListener('click', actions.toggleLive);
$('btn-zoom-in').addEventListener('click', () => actions.zoomBy(1.25));
$('btn-zoom-out').addEventListener('click', () => actions.zoomBy(0.8));
$('btn-fit').addEventListener('click', fit);
new ResizeObserver(() => (app.workshop ? fit() : requestDraw())).observe($('stage')); // the shape's window follows the stage

// ---------- view choices ----------
// What is shown, where the sheet sits and where the cards are: kept in this
// browser over a reload. Nothing here is the livery, which the autosave keeps.
function saveView() {
  if (!ui) return;
  const view = aside ? aside.view : app.view; // drawing a shape: the livery's view, not the shape window's
  try { localStorage.setItem('next-view', JSON.stringify({ show: app.show, mapShow: app.mapShow, view, panels: ui.layout() })); } catch { /* not kept this time */ }
}
function loadView() {
  try { return JSON.parse(localStorage.getItem('next-view')) || {}; } catch { return {}; }
}
// only the choices this version has, so one taken out does not come back
const takeBools = (into, from) => { for (const k in into) if (typeof (from || {})[k] === 'boolean') into[k] = from[k]; };
addEventListener('pagehide', saveView);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveView(); });

// ---------- start ----------

async function boot() {
  try { applyStoredTheme(localStorage.getItem('next-theme')); } catch { /* default theme */ }
  app.doc = newDoc();
  app.custid = (await persist.loadSetting('custid').catch(() => '')) || '';
  const mapsKey = await persist.loadSetting('mapsKey').catch(() => null);
  if (mapsKey) app.admin = { key: mapsKey, login: '' }; // checked by GitHub on its first use
  app.live = !!(await persist.loadSetting('liveSync').catch(() => false)) && persist.fsSupported();
  if (app.live) {
    // After a reload the browser wants a click before it lets the page write
    // to the folder again. Say so on the button, instead of looking live and
    // sending nothing.
    let granted = false;
    try {
      const h = await persist.getPaintsFolder();
      granted = !!h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch { /* treated as not granted */ }
    app.liveBad = !granted;
  }
  try {
    const json = await persist.loadBlob('next-autosave');
    if (json) {
      app.doc = await deserializeDoc(JSON.parse(json));
      oneSparkle(app.doc);
      app.projectId = (await persist.loadSetting('next-project').catch(() => null)) || null;
      lastJson = json;
    }
  } catch { /* a bad autosave must not stop the app opening */ }
  // the sheet may already have been drawn once, from the blank livery this
  // started with, while the saved one was still loading: draw it again
  dirty = true;
  try {
    const lib = await persist.loadBlob('next-library');
    if (lib) library = { logos: Array.isArray(lib.logos) ? lib.logos : [], shapes: Array.isArray(lib.shapes) ? lib.shapes : [], sets: Array.isArray(lib.sets) ? lib.sets : [], palettes: readPalettes(lib.palettes) };
  } catch { /* an empty library */ }
  const saved = loadView();
  takeBools(app.show, saved.show);
  takeBools(app.mapShow, saved.mapShow);
  ui = initUI(app, actions, VERSION);
  ui.setLayout(saved.panels);
  tools = initTools(app, {
    screenToDoc, docToScreen, change, requestDraw,
    select: actions.select, setTool: actions.setTool, toolChanged,
    say: ui.say, refreshChrome: ui.refreshChrome,
    endTrim: actions.endTrim, addText: actions.addText,
    selectedLayers, selectMany: actions.selectMany,
    // a shape made in Finish mode is an area: it paints nothing and carries a finish
    motif: (key) => motifOf(key) || { kind: 'star' },
    created(layer) {
      if (app.mode !== 'finish') return;
      layer.specOnly = true;
      layer.finishOwn = true;
      layer.material = app.finishKind;
      layer.name = 'Area ' + (app.doc.layers.filter(isArea).length + 1);
      app.ftarget = { kind: 'area', id: layer.id }; app.fmore = [];
    },
    // Finish mode: a click on the sheet says what the finish applies to
    finishPick(hit, p, colour = null, adding = false) { // colour: a Repeat copy's own, when one was clicked
      let t = null;
      if (!hit) {
        const inSheet = p.x >= 0 && p.y >= 0 && p.x <= SIZE && p.y <= SIZE;
        t = inSheet ? { kind: 'colour', colour: app.doc.baseColor.toLowerCase() } : null;
      } else {
        const c = colour || layerColour(hit);
        t = isArea(hit) ? { kind: 'area', id: hit.id }
          : c && !hasOwnFinish(hit) ? { kind: 'colour', colour: c, layerId: hit.id } // by colour is the quick way in
          : { kind: 'layer', id: hit.id };
      }
      if (!(adding && !t)) pickFinish(t, adding && 'add'); // Ctrl or Shift on nothing changes nothing
      app.sel = hit && !app.fmore.length ? hit.id : null;
      requestDraw();
      ui.refresh();
    },
    // which layers the target covers, for the outline on the sheet
    finishTargets() {
      if (!app.ftarget) return () => false;
      const ts = [app.ftarget, ...app.fmore];
      const cols = ts.filter(t => t.kind === 'colour').map(t => t.colour), ids = ts.filter(t => t.kind !== 'colour').map(t => t.id);
      return (l) => ids.includes(l.id) || (!isArea(l) && !hasOwnFinish(l) && layerColours(l).some(c => cols.includes(c)));
    },
    mirrorImage: (l) => (l.mirrored && app.doc.regionMap ? mirrorImage(app.doc.regionMap, l) : null),
  });
  mapTools = initMap(app, {
    screenToDoc, docToScreen, requestDraw,
    say: ui.say, refreshChrome: ui.refreshChrome,
    setTool: actions.setTool, pickPiece: actions.pickPiece, mapChanged: actions.mapChanged, mapFlip: actions.mapFlip,
    pairPick: actions.pairPick, pairClose: actions.pairClose,
  });
  carGrad = initCarGradient(app, {
    screenToDoc, docToScreen, requestDraw, say: ui.say,
    nextColour: (has) => nextMix(has),
    // live: while dragging; the save, undo step and paints folder follow once it is let go
    setBlocks(id, blocks, live) {
      const l = app.doc.layers.find(x => x.id === id);
      if (!l || !l.car) return;
      l.car = { blocks };
      l.color = blocks.length ? [...blocks].sort((a, b) => a.from - b.from)[0].color : l.color; // its colour in the Layers list, finishes and palettes
      change(live ? { panels: false } : { now: true });
    },
    setLines(lines, live, msg) {
      if (!app.doc.regionMap) return;
      app.doc.regionMap.carLines = lines;
      change(live ? { panels: false } : { now: true });
      if (msg) ui.say(msg);
    },
  });
  ensureDocFonts();
  fit();
  const v = saved.view || {};
  if (Number.isFinite(v.x) && Number.isFinite(v.y) && v.zoom >= 0.05 && v.zoom <= 8) Object.assign(app.view, { x: v.x, y: v.y, zoom: v.zoom }); // F fits it again
  resetHistory();
  ui.refresh();
  requestDraw();
}
function applyStoredTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  app.theme = theme;
  document.documentElement.dataset.theme = theme;
}
boot();

// The site's service worker holds its update until a page asks for it. This
// page asks straight away, then reloads once on the new one, so a `git pull`
// shows up without a manual cache clear.
if ('serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    flush().finally(() => location.reload());
  });
  const take = (w) => w && w.postMessage({ type: 'SKIP_WAITING' });
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' }).then((reg) => { // none: version.js is asked for afresh too, or a bump could go unseen // from this file, not the page: the page may be at either address
    if (reg.waiting && navigator.serviceWorker.controller) take(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) take(w); });
    });
  }).catch(() => { /* no worker (plain http on a LAN address): the page still works */ });
}
