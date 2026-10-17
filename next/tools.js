// Overspray: what the pointer does on the sheet.
//
// Pen tool: click points to draw a closed outline; it becomes a fill layer
// with shape 'path' (see ../js/shapes.js and the engine's fillShapePath).
// Select tool: click a layer to select it and drag to move it; a selected
// shape shows its points, which drag, and a dot on every line, which bends
// it. Clicking a line adds a point, right-clicking a point removes it.
// Shape tool: drag out a circle, box or triangle (the engine's own fill
// shapes; a selected one resizes by its corners). Band tool: a start and an
// end make a straight stripe of a set width, as an ordinary editable shape.
// Fill a panel: click a panel and it becomes a shape with that panel's
// outline. Trimming (a state of the Select tool): click panels to choose the
// windows the selected layer shows through.
// In Finish mode the same tools draw *areas*: shapes that paint nothing and
// only carry a finish. There, only areas can be moved or reshaped; a click on
// anything else just picks it as what the finish applies to.
// Text tool: click the sheet and a line of text is put there. A selected text
// or picture has a handle on each corner to resize it and one above to turn it.

import { SIZE, createFillLayer, isRegionLayer, toLocal, layerCorners, regenerateText } from '../js/engine.js';
import { bounds, flatten, contains, moved, mapped, segmentAt, midOf, bendTo, insertAt, removeAt, snapAngle, nextIndex, SHAPES, aspect, boxOutline, placed, joined } from '../js/shapes.js';
import { regionOutline, snapToOutline, trimShape, growOutline, pointInPolygon } from '../js/regions.js';
import { clipPolys, fadeStyleOf, repeatOffsets, copyLook, repeatAim } from '../js/engine.js';
import { pieceAt } from '../js/mirror.js';

const GRAB = 9;        // px: how close counts as "on" a point or dot
const EDGE = 6;        // px: how close counts as "on" a line
const SLOP = 3;        // px: a press that moves less than this is a click
const BIG = 0.6;       // a layer covering more of the sheet than this is not grabbed by a click on the sheet

export const isShape = (l) => !!l && l.type === 'fill' && l.shape === 'path' && Array.isArray(l.pts) && l.pts.length >= 3;
// text or a picture: placed by a centre, a size and a turn (not pinned by corners)
export const isPic = (l) => !!l && !!l.img && (l.type === 'image' || l.type === 'text');
// a ready-made fill (circle, box, triangle…): sized by its box, not by points
export const isBox = (l) => !!l && l.type === 'fill' && !isShape(l);
// the three the engine draws from a box; the rest are made as outlines, so they can turn and be reshaped
const BOXED = new Set(['ellipse', 'rect', 'triangle']);

// Where a fill's fade runs: from the first point to the second (across), or
// out from the first as far as the second (from the middle). `style`, when
// given, asks for fresh points laid across the fill's box in that style.
// `box`: lay them across this instead (several shapes fading as one).
export function fadeEnds(l, style, box = { x: l.rx, y: l.ry, w: l.rw, h: l.rh }) {
  if (!style && l.fadeFrom && l.fadeTo) return { a: l.fadeFrom, b: l.fadeTo };
  const cy = box.y + box.h / 2, right = { x: box.x + box.w, y: cy };
  return (style || fadeStyleOf(l)) === 'radial' ? { a: { x: box.x + box.w / 2, y: cy }, b: right } : { a: { x: box.x, y: cy }, b: right };
}
export const hasFade = (l) => !!l && l.type === 'fill' && (l.fillType === 'linear' || l.fillType === 'radial');
// something of the layer follows its fade line: its paint
export const hasAim = hasFade;

// keep a shape's box in step with its outline (gradients and the engine's
// own hit-testing work from the box)
export function setShape(layer, pts) {
  const b = bounds(pts);
  layer.pts = pts;
  layer.rx = b.x; layer.ry = b.y; layer.rw = b.w; layer.rh = b.h;
}

export function moveLayer(l, dx, dy) {
  if (isShape(l)) l.pts = moved(l.pts, dx, dy);
  if (l.fadeFrom && l.fadeTo) { // a fade's two points belong to the shape
    l.fadeFrom = { x: l.fadeFrom.x + dx, y: l.fadeFrom.y + dy };
    l.fadeTo = { x: l.fadeTo.x + dx, y: l.fadeTo.y + dy };
  }
  if (isRegionLayer(l)) { l.rx += dx; l.ry += dy; } else { l.x += dx; l.y += dy; }
}

export function initTools(app, env) {
  const { screenToDoc, docToScreen, change, requestDraw } = env;
  let draft = null;    // the outline being drawn: doc points
  let cursor = null;   // where the next point would go
  let drag = null;

  const selLayer = () => app.doc.layers.find(l => l.id === app.sel) || null;
  // in Finish mode the paint is not to be disturbed: only areas can be changed
  // …and with several layers selected there are no handles: they move as one
  const editable = (l) => !!l && !l.locked && l.visible && (app.mode !== 'finish' || !!l.specOnly) && env.selectedLayers().length < 2;
  const selShape = () => { const l = selLayer(); return isShape(l) && editable(l) ? l : null; };
  const selBox = () => { const l = selLayer(); return isBox(l) && editable(l) ? l : null; };
  const selPic = () => { const l = selLayer(); return isPic(l) && editable(l) ? l : null; };
  // The fade line on show: the selected shape's, or with several selected the
  // first one's that has one. They share it: dragging a dot moves it for them all.
  const fadeMates = () => (app.mode === 'paint' ? env.selectedLayers().filter(l => hasAim(l) && !l.locked && l.visible) : []);
  const selFade = () => fadeMates()[0] || null;
  // the selected layer's Repeat, when its copies fade out or shrink: two dots of its own aim that.
  // ponytail: the dots stay put when the layer turns; turn them with it if that's ever missed
  const selRepAim = () => { const l = selLayer(); return app.mode === 'paint' && editable(l) && l.repeat && (l.repeat.fadeOut || l.repeat.shrink) ? l : null; };
  // where the turn handle sits: out from the middle of the top edge
  function turnHandle(l) {
    const c = layerCorners(l).map(onScreen), top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 }, mid = onScreen(l);
    const dx = top.x - mid.x, dy = top.y - mid.y, len = Math.hypot(dx, dy) || 1;
    return { x: top.x + dx / len * 26, y: top.y + dy / len * 26, top };
  }
  const corners = (l) => [[l.rx, l.ry], [l.rx + l.rw, l.ry], [l.rx + l.rw, l.ry + l.rh], [l.rx, l.ry + l.rh]].map(([x, y]) => ({ x, y }));
  // A selected shape's frame, on the screen: a handle just outside each corner
  // of its box to resize it by (clear of the shape's own points), and a round
  // one above the middle to turn it by. A ready-made box has its resize
  // handles on its corners already, and uses only the turn handle.
  // The frame stands at the angle the shape was last turned to (layer.turn, in
  // degrees), so the turn handle stays with the shape's own top.
  const FRAME = 12;
  const flats = new WeakMap(); // an outline → its points with the curves walked: asked for on every pointer move
  const outlineOf = (l) => (isShape(l) ? flats.get(l.pts) || (flats.set(l.pts, flatten(l.pts)), flats.get(l.pts)) : isRegionLayer(l) ? corners(l) : l.img ? layerCorners(l) : []);
  // the box round some points, as seen with the sheet turned by t (radians): its middle c on the sheet, half its width and height
  function boxAt(points, t) {
    const cos = Math.cos(t), sin = Math.sin(t);
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const q of points) {
      const u = q.x * cos + q.y * sin, v = q.y * cos - q.x * sin;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    return { c: { x: cu * cos - cv * sin, y: cu * sin + cv * cos }, hw: (u1 - u0) / 2, hh: (v1 - v0) / 2, t };
  }
  // a spot in that box: u across and v down from its middle, as the box itself lies
  const inBox = (b, u, v) => ({ x: b.c.x + u * Math.cos(b.t) - v * Math.sin(b.t), y: b.c.y + u * Math.sin(b.t) + v * Math.cos(b.t) });
  // its corners, pad further out: top-left, top-right, bottom-right, bottom-left
  const boxCorners = (b, pad = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => inBox(b, i * (b.hw + pad), j * (b.hh + pad)));
  const shapeBox = (l) => boxAt(outlineOf(l), (l.turn || 0) * Math.PI / 180);
  function frameFor(b) {
    const pad = FRAME / app.view.zoom;
    return { corners: boxCorners(b, pad).map(onScreen), top: onScreen(inBox(b, 0, -b.hh - pad)), turn: onScreen(inBox(b, 0, -b.hh - pad - 24 / app.view.zoom)) };
  }
  const frameOf = (l) => frameFor(shapeBox(l));
  // Several layers selected: they turn as one, about the middle of the box
  // round them all. That box keeps the angle they have been turned to for as
  // long as the same layers stay selected; a group's box keeps it for good.
  let manyTurn = { key: '', t: 0 };
  const groupOfMany = (ls) => {
    const g = ls[0].groupId;
    return g && ls.every(l => l.groupId === g) ? (app.doc.groups || []).find(x => x.id === g) || null : null;
  };
  const selMany = () => {
    const ls = app.mode === 'paint' && app.tool === 'select' ? env.selectedLayers().filter(l => !l.locked && l.visible && !l.specOnly && (l.type === 'fill' || isPic(l))) : [];
    return ls.length > 1 ? ls : null;
  };
  function manyBox(ls) {
    const key = ls.map(l => l.id).join();
    const g = groupOfMany(ls);
    if (manyTurn.key !== key) manyTurn = { key, t: g ? (g.turn || 0) * Math.PI / 180 : 0 };
    return boxAt(ls.flatMap(outlineOf), manyTurn.t);
  }
  // A shape with a great many points (an icon, a wrapped slot) would be a
  // fringe of handles at this zoom: its points are put away until there is
  // room for them on the screen, about 9 px apart. Zooming in brings them back.
  const pointsShow = (l) => {
    const pts = l.pts;
    let run = 0;
    for (let i = 0; i < pts.length; i++) run += far(onScreen(pts[i]), onScreen(pts[nextIndex(pts, i)]));
    return run / pts.length >= 9;
  };
  // a turn begins: about the middle of the box b round the layers, from where the pointer is now
  const spinFrom = (ls, p, b) => ({
    kind: 'spin', c: b.c, a0: Math.atan2(p.y - b.c.y, p.x - b.c.x), t0: b.t, many: ls.length > 1, group: ls.length > 1 ? groupOfMany(ls) : null,
    layers: ls.map(l => ({ l, pts0: null, fade0: l.fadeFrom && l.fadeTo ? [{ ...l.fadeFrom }, { ...l.fadeTo }] : null, turn0: l.turn || 0, x0: l.x, y0: l.y, r0: l.rotation || 0 })),
  });
  // a turn, ang radians from where the layers were when it began
  function spinBy(drag, ang) {
    const cos = Math.cos(ang), sin = Math.sin(ang), c = drag.c, deg = ang * 180 / Math.PI;
    const f = (q) => ({ x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin, y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos });
    for (const d of drag.layers) {
      const l = d.l;
      if (isPic(l)) { const q = f({ x: d.x0, y: d.y0 }); l.x = q.x; l.y = q.y; l.rotation = d.r0 + deg; continue; } // text and pictures turn about their own middle, which goes round with the rest
      if (!d.pts0) {
        // A ready-made box is drawn from its box, which cannot turn: from here
        // on it is an outline like any other shape (a flip it carried goes into the outline).
        if (isBox(l)) {
          const cx = l.rx + l.rw / 2, cy = l.ry + l.rh / 2, fh = !!l.flipH, fv = !!l.flipV;
          const pts = mapped(boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh), q => ({ x: fh ? 2 * cx - q.x : q.x, y: fv ? 2 * cy - q.y : q.y }));
          l.shape = 'path'; l.flipH = l.flipV = false;
          setShape(l, pts);
        }
        d.pts0 = structuredClone(l.pts);
      }
      reshape(l, d, f);
      l.turn = (d.turn0 + deg) % 360;
    }
    if (drag.many) manyTurn.t = drag.t0 + ang;
    if (drag.group) drag.group.turn = Math.round(((manyTurn.t * 180 / Math.PI) % 360 + 540) % 360 - 180);
  }
  // the shape, and the fade line that belongs to it, put through f from how they were when the drag began
  function reshape(l, d, f) {
    setShape(l, mapped(d.pts0, f));
    if (d.fade0) { l.fadeFrom = f(d.fade0[0]); l.fadeTo = f(d.fade0[1]); }
  }
  let lastPress = { id: null, at: 0 }; // the layer last pressed on the sheet, and when: two close together are a double click
  let rubber = null;   // ready-made shape being dragged out: { a, b } doc points
  let band = null;     // band being placed: { a, b, pressed }
  let hover = null;    // the panel under the pointer, while a panel is being picked

  // Fill a panel: the panel's outline as a shape, a hair over the edge so no
  // bare line shows where the sim blends across panel edges
  // Shift: the panel joins the selected shape instead, so several panels make one layer
  function fillPanel(p, e) {
    const r = pieceAt(app.doc.regionMap, p.x, p.y);
    if (!r) { env.say(app.doc.regionMap ? 'Click inside a panel' : 'Load a template first'); return; }
    const pts = growOutline(regionOutline(r), 2).map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }));
    const into = e.shiftKey && selShape();
    if (into) {
      setShape(into, joined([into.pts, pts]));
      into.name += ' + ' + r.name;
      change({ now: true });
      return;
    }
    const layer = createFillLayer(app.colour);
    layer.shape = 'path';
    layer.name = r.name;
    setShape(layer, pts);
    env.created(layer);
    app.doc.layers.push(layer);
    app.sel = layer.id; // the tool stays armed: click the next panel
    change({ now: true });
  }
  // Trim: each click adds the panel under it as a window, or takes it out again
  function trimAt(p) {
    const l = selLayer();
    if (!l || p.x < 0 || p.y < 0 || p.x > SIZE || p.y > SIZE) { env.endTrim(); return; } // a click off the sheet is Done
    // several selected: the click goes to each of them, as it does to the one clicked first
    const r = pieceAt(app.doc.regionMap, p.x, p.y), out = clipPolys(l).some(poly => pointInPolygon(poly, p.x, p.y));
    if (!out && !r) { env.say('Click inside a panel'); return; }
    for (const x of env.selectedLayers()) {
      const polys = clipPolys(x).slice(), ats = [].concat(x.clipAt || []);
      const had = polys.findIndex(poly => pointInPolygon(poly, p.x, p.y));
      if (had !== -1) { if (out) { polys.splice(had, 1); ats.splice(had, 1); } }
      else if (!out) {
        polys.push(trimShape(r, p.x, p.y));
        ats.push({ x: Math.round(p.x), y: Math.round(p.y) }); // the spot picked: says which panel (and half) this is
      }
      x.clip = polys.length ? polys : null;
      x.clipAt = polys.length ? ats : null;
    }
    change({ now: true });
  }

  // a band's ends stick to the nearest piece edge or corner when close (Alt: free)
  function snapToPieces(p, e) {
    const map = app.doc.regionMap;
    if (e.altKey || !map) return p;
    let best = null;
    for (const r of map.regions) {
      if (!r.points || r.kind) continue;
      const hit = snapToOutline(regionOutline(r), p.x, p.y, GRAB / app.view.zoom);
      if (hit.d * app.view.zoom <= GRAB && (!best || hit.d < best.d)) best = hit;
    }
    return best ? { x: best.x, y: best.y } : p;
  }
  const bandEnd = (p, e) => (e.shiftKey && band ? snapAngle(band.a, p) : snapToPieces(p, e));
  function addLayer(layer) {
    env.created(layer);
    app.doc.layers.push(layer);
    app.tool = 'select';
    app.sel = layer.id;
    rubber = band = null;
    env.toolChanged();
    change({ now: true });
  }
  function evenBox(a, b, even) { // the dragged box; `even` makes it square
    let w = b.x - a.x, h = b.y - a.y;
    if (even) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
  }
  function finishReady(even) {
    let box = evenBox(rubber.a, rubber.b, even);
    const kind = app.shapeKind, name = SHAPES[kind];
    if (box.w < 4 || box.h < 4) { const h = 300 * aspect(kind); box = { x: rubber.a.x - 150, y: rubber.a.y - h / 2, w: 300, h }; } // a plain click
    const layer = createFillLayer(app.colour);
    layer.name = name + ' ' + (app.doc.layers.filter(l => new RegExp('^' + name + ' \\d+$').test(l.name)).length + 1);
    if (BOXED.has(kind)) {
      layer.shape = kind;
      layer.rx = box.x; layer.ry = box.y; layer.rw = box.w; layer.rh = box.h;
    } else {
      layer.shape = 'path';
      setShape(layer, boxOutline(kind, box.x, box.y, box.w, box.h));
    }
    addLayer(layer);
  }
  const bandPts = (a, b, width) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len * width / 2, ny = (b.x - a.x) / len * width / 2;
    return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
  };
  function finishBand() {
    if (Math.hypot(band.b.x - band.a.x, band.b.y - band.a.y) < 4) { band = null; requestDraw(); return; }
    const layer = createFillLayer(app.colour);
    layer.shape = 'path';
    layer.name = 'Band ' + (app.doc.layers.filter(l => /^Band \d+/.test(l.name)).length + 1);
    setShape(layer, bandPts(band.a, band.b, app.bandWidth));
    addLayer(layer);
  }
  // Stamp: each click places one copy. Every copy of one go (the tool left
  // armed, the colour unchanged) is a piece of the same shape, so a scatter of
  // stamps is one row in the Layers list; Split makes them shapes of their own.
  let stampRun = null;
  function stampAt(p) {
    const stamp = env.motif(app.stamp.key), pts = placed(stamp, p.x, p.y, app.stamp.size);
    let layer = app.doc.layers.find(l => l.id === stampRun && isShape(l) && !l.locked && l.color === app.colour);
    if (layer) {
      setShape(layer, joined([layer.pts, pts]));
    } else {
      layer = createFillLayer(app.colour);
      layer.shape = 'path';
      layer.name = 'Stamps ' + (app.doc.layers.filter(l => /^Stamps \d+$/.test(l.name)).length + 1);
      setShape(layer, pts);
      app.doc.layers.push(layer);
      stampRun = layer.id;
    }
    // a stamp made from an icon carries the icon's credit with it
    for (const c of stamp.credits || []) if (!(layer.credits || []).some(x => x.icon === c.icon)) layer.credits = [...(layer.credits || []), c];
    app.sel = layer.id;
    change({ now: true });
  }
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const onScreen = (p) => docToScreen(p.x, p.y);

  // the top layer under a doc point, on the layer itself or one of its Repeat's copies
  function layerAt(p) {
    for (let i = app.doc.layers.length - 1; i >= 0; i--) {
      const l = app.doc.layers[i];
      if (!l.visible || l.locked || l.car) continue; // a car gradient covers the sheet: picked from the Layers panel
      if (l.specOnly && app.mode !== 'finish') continue; // an area belongs to Finish mode
      // ponytail: a sheet-sized box or picture would swallow every click, so it
      // is only picked from the Layers panel; give it a real hit shape later
      const big = isShape(l) ? false : isRegionLayer(l) ? l.rw * l.rh > BIG * SIZE * SIZE
        : !!l.img && l.img.width * l.img.height / (l.img.res || 1) ** 2 * (l.scale || 1) * (l.scaleY ?? l.scale ?? 1) > BIG * SIZE * SIZE;
      if (big && l.id !== app.sel) continue;
      if (onLayer(l, p) || copyAt(l, p) > 0) return l;
    }
    return null;
  }
  // which of a Repeat's copies a doc point falls on (0 the layer itself), or -1
  // ponytail: each copy is taken as the layer moved there, without its random size and turn or other outline
  function copyAt(l, p) {
    if (!l.repeat) return -1;
    const wins = clipPolys(l);
    if (wins.length && !wins.some(w => pointInPolygon(w, p.x, p.y))) return -1; // trimmed away there
    try { return repeatOffsets(l).list.findIndex(o => onLayer(l, { x: p.x - o.x, y: p.y - o.y })); } catch { return -1; }
  }

  // does a doc point fall on this layer's own picture?
  function onLayer(l, p) {
    if (isShape(l)) return contains(l.pts, p.x, p.y);
    if (isRegionLayer(l)) return p.x >= l.rx && p.x <= l.rx + l.rw && p.y >= l.ry && p.y <= l.ry + l.rh;
    if (!l.img) return false;
    const q = toLocal(l, p.x, p.y);
    return Math.abs(q.x) <= l.img.width / 2 && Math.abs(q.y) <= l.img.height / 2;
  }
  function mirrorOwnerAt(p) {
    for (let i = app.doc.layers.length - 1; i >= 0; i--) {
      const l = app.doc.layers[i];
      if (!l.mirrored || !l.visible || l.locked) continue;
      const img = env.mirrorImage(l);
      if (img && (onLayer(img, p) || copyAt(img, p) > 0)) return l;
    }
    return null;
  }

  // a layer's bounding box on the sheet
  function boxOf(l) {
    try {
      const cs = layerCorners(l), xs = cs.map(q => q.x), ys = cs.map(q => q.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    } catch { return null; }
  }

  const closable = (s) => draft && draft.length >= 3 && far(onScreen(draft[0]), s) <= GRAB + 2;
  const nextPoint = (p, shift) => (shift && draft && draft.length ? snapAngle(draft[draft.length - 1], p) : p);

  function finish() {
    if (!draft || draft.length < 3) return false;
    const layer = createFillLayer(app.colour);
    const n = app.doc.layers.filter(l => isShape(l) && !l.specOnly).length + 1;
    layer.name = 'Shape ' + n;
    layer.shape = 'path';
    setShape(layer, draft);
    env.created(layer);
    app.doc.layers.push(layer);
    draft = null; cursor = null;
    app.tool = 'select';
    app.sel = layer.id;
    env.toolChanged();
    change({ now: true });
    return true;
  }

  function down(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.trimming) { trimAt(p); return; }
    if (app.tool === 'piece') { fillPanel(p, e); return; }
    if (app.tool === 'text') { env.addText(p); return; }
    if (app.tool === 'shape') { rubber = { a: p, b: p }; return; }
    if (app.tool === 'stamp') { stampAt(p); return; }
    if (app.tool === 'band') {
      if (band && !band.pressed) { band.b = bandEnd(p, e); finishBand(); return; } // the second click
      const a = snapToPieces(p, e);
      band = { a, b: a, pressed: true, start: s };
      requestDraw();
      return;
    }
    if (app.tool === 'pen') {
      if (closable(s) || (e.detail >= 2 && draft && draft.length >= 3)) { finish(); return; }
      (draft || (draft = [])).push(nextPoint(p, e.shiftKey));
      requestDraw();
      env.refreshChrome();
      return;
    }
    if (app.tool !== 'select') return;
    const faded = selFade();
    if (faded) { // the fade's two dots sit on top of everything else the shape has
      const ends = fadeEnds(faded);
      for (const end of ['b', 'a']) if (far(onScreen(ends[end]), s) <= GRAB) { drag = { kind: 'fade', layer: faded, end }; return; }
    }
    const rep = selRepAim();
    if (rep) {
      const ends = repeatAim(rep);
      for (const end of ['b', 'a']) if (far(onScreen(ends[end]), s) <= GRAB) { drag = { kind: 'repAim', layer: rep, end }; return; }
    }
    const many = selMany();
    if (many && far(frameFor(manyBox(many)).turn, s) <= GRAB) { drag = spinFrom(many, p, manyBox(many)); return; }
    const shape = selShape();
    if (shape) {
      const pts = shape.pts, shown = pointsShow(shape);
      const vi = shown ? pts.findIndex(q => far(onScreen(q), s) <= GRAB) : -1;
      if (vi !== -1) { drag = { kind: 'point', layer: shape, i: vi }; return; }
      const mi = shown ? pts.findIndex((q, i) => far(onScreen(midOf(pts, i)), s) <= GRAB - 1) : -1;
      if (mi !== -1) { drag = { kind: 'bend', layer: shape, i: mi, start: s, went: false }; return; }
      const fr = frameOf(shape);
      if (far(fr.turn, s) <= GRAB) { drag = spinFrom([shape], p, shapeBox(shape)); return; }
      const fi = fr.corners.findIndex(q => far(q, s) <= GRAB);
      if (fi !== -1) {
        // resized from the corner opposite the one taken; the handle sits a little off the corner, so that offset is kept
        const b = shapeBox(shape), cs = boxCorners(b), c0 = cs[fi];
        drag = { kind: 'resize', layer: shape, anchor: cs[(fi + 2) % 4], c0, t: b.t, off: { x: p.x - c0.x, y: p.y - c0.y }, pts0: structuredClone(pts), fade0: shape.fadeFrom && shape.fadeTo ? [{ ...shape.fadeFrom }, { ...shape.fadeTo }] : null };
        return;
      }
      const seg = segmentAt(pts, p.x, p.y, EDGE / app.view.zoom);
      if (seg) { drag = { kind: 'edge', layer: shape, seg, start: s, last: p, went: false }; return; }
    }
    const pic = selPic();
    if (pic) {
      const ang = Math.atan2(p.y - pic.y, p.x - pic.x);
      if (far(turnHandle(pic), s) <= GRAB) { drag = { kind: 'turn', layer: pic, a0: ang, r0: pic.rotation || 0 }; return; }
      if (layerCorners(pic).some(q => far(onScreen(q), s) <= GRAB)) {
        drag = { kind: 'scale', layer: pic, d0: Math.hypot(p.x - pic.x, p.y - pic.y) || 1, s0: pic.scale, sy0: pic.scaleY ?? null };
        return;
      }
    }
    const box = selBox();
    if (box) {
      if (far(frameOf(box).turn, s) <= GRAB) { drag = spinFrom([box], p, shapeBox(box)); return; }
      const ci = corners(box).findIndex(q => far(onScreen(q), s) <= GRAB);
      if (ci !== -1) { drag = { kind: 'size', layer: box, anchor: corners(box)[(ci + 2) % 4] }; return; }
    }
    const hit = layerAt(p);
    if (app.mode === 'finish') {
      const k = hit ? copyAt(hit, p) : -1, c = k > 0 && copyLook(hit.repeat, k).c; // a copy in one of the Repeat's other colours
      const more = e.shiftKey || e.ctrlKey || e.metaKey;
      env.finishPick(hit, p, c ? hit.repeat.colors[c - 1] : null, more); // what the finish will apply to; Ctrl/Shift: as well
      if (!hit || !hit.specOnly || more) return; // and only an area can be dragged here
    }
    const adding = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!hit) {
      // a click on the mirrored side of a layer selects the layer it belongs to
      const owner = mirrorOwnerAt(p);
      if (owner) { if (owner.id !== app.sel) env.select(owner.id, adding); return; }
      // empty sheet: a drag draws a box round the layers to select; a plain click selects nothing
      drag = { kind: 'marquee', a: p, b: p, start: s, went: false };
      return;
    }
    if (adding) { env.select(hit.id, true); return; } // joins the selection, or leaves it
    // a double click goes inside a group: this layer alone (pointer presses carry no click count, so it is kept here)
    const twice = lastPress.id === hit.id && performance.now() - lastPress.at < 450;
    lastPress = twice ? { id: null, at: 0 } : { id: hit.id, at: performance.now() };
    if (twice && hit.groupId) { env.select(hit.id, false, true); return; }
    if (env.selectedLayers().some(l => l.id === hit.id)) { // one of several: they all move
      drag = { kind: 'move', layer: hit, start: s, last: p, went: false };
      return;
    }
    if (hit.id !== app.sel) env.select(hit.id);
    drag = { kind: 'move', layer: hit, start: s, last: p, went: false };
  }

  function move(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'pen') { cursor = nextPoint(p, e.shiftKey); requestDraw(); return; }
    if (app.tool === 'stamp') { cursor = p; requestDraw(); return; }
    if (app.trimming || app.tool === 'piece') {
      const r = pieceAt(app.doc.regionMap, p.x, p.y);
      if (r !== hover) { hover = r; requestDraw(); }
      return;
    }
    if (rubber) { rubber.b = p; rubber.even = e.shiftKey; requestDraw(); return; }
    if (band) { band.b = bandEnd(p, e); requestDraw(); return; }
    if (!drag) return;
    const l = drag.layer;
    if (drag.kind === 'fade') {
      const ends = fadeEnds(l), other = drag.end === 'a' ? ends.b : ends.a;
      const q = e.shiftKey ? snapAngle(other, p) : p;
      const from = drag.end === 'a' ? { x: q.x, y: q.y } : { ...ends.a }, to = drag.end === 'b' ? { x: q.x, y: q.y } : { ...ends.b };
      for (const m of fadeMates()) { m.fadeFrom = { ...from }; m.fadeTo = { ...to }; } // every selected shape that fades takes the same line
      change({ panels: false });
      return;
    }
    if (drag.kind === 'repAim') { // kept as offsets from the layer's middle, so they go where it goes
      const ends = repeatAim(l), q = e.shiftKey ? snapAngle(drag.end === 'a' ? ends.b : ends.a, p) : p;
      ends[drag.end] = q;
      const { cx, cy } = repeatOffsets(l), off = (o) => ({ x: o.x - cx, y: o.y - cy });
      l.repeat.aim = { a: off(ends.a), b: off(ends.b) };
      change({ panels: false });
      return;
    }
    if (drag.kind === 'turn') {
      let r = drag.r0 + (Math.atan2(p.y - l.y, p.x - l.x) - drag.a0) * 180 / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      l.rotation = ((r + 180) % 360 + 360) % 360 - 180;
      change({ panels: false });
      return;
    }
    if (drag.kind === 'scale') { // from the centre, proportions kept
      const k = Math.max(0.02, Math.hypot(p.x - l.x, p.y - l.y) / drag.d0);
      l.scale = Math.max(0.01, Math.min(40, drag.s0 * k));
      if (drag.sy0 !== null) l.scaleY = Math.max(0.01, Math.min(40, drag.sy0 * k));
      change({ panels: false });
      return;
    }
    if (drag.kind === 'size') {
      const b = evenBox(drag.anchor, p, e.shiftKey);
      l.rx = b.x; l.ry = b.y; l.rw = Math.max(4, b.w); l.rh = Math.max(4, b.h);
      change({ panels: false });
      return;
    }
    if (drag.kind === 'resize') {
      // along the frame's own two directions, which lie at the angle the shape is turned to
      const a = drag.anchor, cos = Math.cos(drag.t), sin = Math.sin(drag.t);
      const own = (q) => ({ x: (q.x - a.x) * cos + (q.y - a.y) * sin, y: (q.y - a.y) * cos - (q.x - a.x) * sin });
      const was = own(drag.c0), now = own({ x: p.x - drag.off.x, y: p.y - drag.off.y });
      let sx = was.x ? Math.max(0.02, now.x / was.x) : 1, sy = was.y ? Math.max(0.02, now.y / was.y) : 1;
      if (e.shiftKey) sx = sy = Math.max(sx, sy); // kept even
      reshape(l, drag, (q) => { const o = own(q); return { x: a.x + o.x * sx * cos - o.y * sy * sin, y: a.y + o.x * sx * sin + o.y * sy * cos }; });
      change({ panels: false });
      return;
    }
    if (drag.kind === 'spin') {
      let ang = Math.atan2(p.y - drag.c.y, p.x - drag.c.x) - drag.a0;
      const step = Math.PI / 12;
      if (e.shiftKey) ang = Math.round((drag.t0 + ang) / step) * step - drag.t0; // to 15° steps
      spinBy(drag, ang);
      change({ panels: false });
      return;
    }
    if (drag.kind === 'point') {
      const pts = l.pts.map(q => ({ ...q }));
      pts[drag.i] = { ...pts[drag.i], x: p.x, y: p.y };
      setShape(l, pts);
      change({ panels: false });
      return;
    }
    if (!drag.went && far(drag.start, s) < SLOP) return;
    if (drag.kind === 'marquee') { drag.went = true; drag.b = p; requestDraw(); return; }
    if (drag.kind === 'bend') {
      drag.went = true;
      setShape(l, bendTo(l.pts, drag.i, p, 4 / app.view.zoom));
      change({ panels: false });
      return;
    }
    // 'edge' that moves is a move, like a press anywhere else on the layer
    drag.went = true;
    const many = env.selectedLayers(), moving = many.some(m => m.id === l.id) ? many : [l];
    for (const m of moving) if (!m.locked) moveLayer(m, p.x - drag.last.x, p.y - drag.last.y);
    drag.last = p;
    change({ panels: false });
  }

  function up(e, s) {
    if (rubber) { finishReady(rubber.even); return; }
    if (band && band.pressed) {
      band.pressed = false;
      if (s && far(band.start, s) >= SLOP) finishBand(); // dragged out in one go; otherwise wait for the second click
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'marquee') {
      if (!d.went) { if (app.sel !== null) env.select(null); return; }
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      env.selectMany(app.doc.layers.filter((l) => {
        if (!l.visible || l.locked || l.specOnly || l.car) return false;
        const b = boxOf(l);
        return b && b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0; // touches the box
      }).map(l => l.id));
      requestDraw();
      return;
    }
    if (!d.went && d.kind === 'bend') setShape(d.layer, insertAt(d.layer.pts, d.i, 0.5));       // a click on the dot: a point there
    else if (!d.went && d.kind === 'edge') setShape(d.layer, insertAt(d.layer.pts, d.seg.i, d.seg.t)); // a click on the line
    else if (d.kind === 'move' && !d.went) return;
    else if (d.kind === 'scale' && d.layer.type === 'text') regenerateText(d.layer); // its letters drawn again at the new size, so they stay sharp
    change({ now: true });
  }

  // right-click on a point of the selected shape removes it
  function context(s) {
    if (app.tool !== 'select') return false;
    const shape = selShape();
    const vi = shape && pointsShow(shape) ? shape.pts.findIndex(q => far(onScreen(q), s) <= GRAB) : -1;
    if (vi === -1) {
      // the menu that opens next should be about the layer under the pointer
      const hit = layerAt(screenToDoc(s.x, s.y));
      if (hit && hit.id !== app.sel) env.select(hit.id);
      return false;
    }
    if (shape.pts.length > 3) { setShape(shape, removeAt(shape.pts, vi)); change({ now: true }); }
    else env.say('A shape needs three points');
    return true;
  }

  // → true when the key was used
  function key(e) {
    if (app.tool === 'pen') {
      if (e.key === 'Enter') { if (!finish()) env.say('Click at least three points first'); return true; }
      if (e.key === 'Backspace' && draft && draft.length) { draft.pop(); requestDraw(); env.refreshChrome(); return true; } // with no points yet it deletes the selected layer as usual
      if (e.key === 'Escape') {
        if (draft && draft.length) { draft = null; cursor = null; requestDraw(); env.refreshChrome(); }
        else env.setTool('select');
        return true;
      }
    }
    if (app.trimming && (e.key === 'Escape' || e.key === 'Enter')) { env.endTrim(); return true; }
    if (e.key === 'Escape' && ['shape', 'band', 'stamp', 'piece', 'text'].includes(app.tool)) {
      if (band) { band = null; requestDraw(); }
      else env.setTool('select');
      return true;
    }
    return false;
  }

  function cancel() { draft = null; cursor = null; drag = null; rubber = null; band = null; hover = null; stampRun = null; }

  const hint = () => {
    if (app.tool === 'hand') return 'Drag to move the sheet · wheel zooms · H or Esc puts it down';
    if (app.trimming) return 'Click panels to show it in · click again to take one out · Enter or click off the sheet when done';
    if (app.mode === 'finish') {
      if (app.tool === 'piece') return 'Click a panel to give the whole panel a finish';
      if (app.tool === 'pen') return draft && draft.length ? 'Enter to finish the area · Backspace undoes a point' : 'Click points round the area · Shift holds 45°';
      if (app.tool === 'shape') return 'Drag out the area';
      if (selLayer() && selLayer().specOnly) return 'Drag the area to move it · Delete removes it';
      return 'Click a colour or a layer on the sheet, or pick one from the list';
    }
    if (app.tool === 'piece') return 'Click a panel to fill it';
    if (app.tool === 'text') return 'Click where the text goes';
    if (app.tool === 'select' && selRepAim() && !selFade()) return 'Drag the two dots: the copies fade or shrink to nothing as far from the ring as the dot is · Shift holds 45°';
    if (app.tool === 'select' && selFade()) return fadeMates().length > 1 ? 'Drag the two dots to aim the fade for all of them · Shift holds 45°' : 'Drag the two dots to aim the fade · Shift holds 45°';
    if (app.tool === 'select' && env.selectedLayers().length > 1) return `${env.selectedLayers().length} layers · drag to move them · the round handle turns them · ${env.selectedLayers().every(l => l.groupId && l.groupId === env.selectedLayers()[0].groupId) ? 'double-click one to pick it alone' : 'Ctrl+G groups'}`;
    if (app.tool === 'select' && selPic()) return 'Drag a corner to resize · the round handle turns it · Shift turns in steps';
    if (app.tool === 'shape') return 'Drag to draw · Shift keeps it even';
    if (app.tool === 'stamp') return 'Click to place one · Split makes them separate';
    if (app.tool === 'band') return band ? 'Click the end · Shift holds 45°' : 'Click the start, then the end · snaps to panel edges';
    if (app.tool === 'select' && selBox()) return 'Drag a corner to resize · the round handle turns it · Shift keeps it even';
    if (app.tool === 'pen') return draft && draft.length ? 'Enter to finish · Backspace undoes a point · Shift holds 45°' : 'Click points to draw · Shift holds 45°';
    if (selShape()) return (pointsShow(selShape()) ? 'Points and dots reshape it' : app.workshop ? 'Too many points to show here' : 'Zoom in to move its points') + ' · white corners resize · the round handle turns · Shift keeps it even';
    if (app.workshop) return 'Draw with the tools on the left · Ctrl+S saves the shape';
    return 'Space-drag to pan · wheel to zoom';
  };

  // screen space: lines and handles stay the same size at any zoom
  function drawOverlay(ctx, accent) {
    const path = (pts, close) => {
      ctx.beginPath();
      pts.forEach((a, i) => { // a point marked `m` starts a separate piece
        const A = onScreen(a);
        if (!i || a.m) ctx.moveTo(A.x, A.y);
        const last = i === pts.length - 1 || !!pts[i + 1].m;
        if (last && !close) return;
        const B = onScreen(pts[last ? nextIndex(pts, i) : i + 1]);
        if (a.c) { const C = onScreen(a.c); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); } else ctx.lineTo(B.x, B.y);
        if (last) ctx.closePath();
      });
    };
    const square = (q, r, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = fill === '#ffffff' ? accent : '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(q.x - r, q.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    };
    ctx.lineJoin = 'round';
    if (app.tool === 'pen' && draft && draft.length) {
      const pts = cursor ? [...draft, cursor] : draft;
      path(pts, false);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      draft.forEach((q, i) => square(onScreen(q), i === 0 && draft.length >= 3 ? 6 : 4, i === 0 ? '#ffffff' : accent));
      return;
    }
    const preview = (pts) => { // a shape that is not made yet
      path(pts, true);
      ctx.fillStyle = app.colour; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    };
    const outline = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const a = onScreen(q); i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); }); ctx.closePath(); };
    if (app.mode === 'paint') {
      // Nothing is painted off the sheet, so a layer out there (or the part of
      // one that hangs over the edge) would go missing: its outline is drawn
      // there, dashed, to find it and bring it back by.
      const off = (q) => q.x < 0 || q.y < 0 || q.x > SIZE || q.y > SIZE;
      const A = onScreen({ x: 0, y: 0 }), B = onScreen({ x: SIZE, y: SIZE });
      for (const l of app.doc.layers) {
        if (!l.visible || l.specOnly) continue;
        const pts = isShape(l) ? l.pts : isBox(l) ? boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh) : l.img ? layerCorners(l) : null;
        if (!pts || !pts.some(off)) continue;
        ctx.save();
        ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5); ctx.rect(A.x, A.y, B.x - A.x, B.y - A.y); ctx.clip('evenodd'); // everywhere but the sheet
        path(pts, true);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = '#5b6472'; ctx.lineWidth = 1.25; ctx.stroke();
        ctx.restore();
      }
    }
    if (app.mode === 'finish') {
      // an area paints nothing, so it is drawn here: tinted, dashed. Whatever
      // the finish is about to apply to gets a solid outline.
      const edge = (l) => {
        if (isShape(l)) path(l.pts, true);
        else if (isRegionLayer(l)) {
          const A = onScreen({ x: l.rx, y: l.ry }), B = onScreen({ x: l.rx + l.rw, y: l.ry + l.rh });
          ctx.beginPath();
          if (l.shape === 'ellipse') ctx.ellipse((A.x + B.x) / 2, (A.y + B.y) / 2, (B.x - A.x) / 2, (B.y - A.y) / 2, 0, 0, Math.PI * 2);
          else if (l.shape === 'triangle') { ctx.moveTo((A.x + B.x) / 2, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(A.x, B.y); ctx.closePath(); }
          else ctx.rect(A.x, A.y, B.x - A.x, B.y - A.y);
        } else if (l.img) outline(layerCorners(l));
        else ctx.beginPath();
      };
      const isTarget = env.finishTargets();
      for (const l of app.doc.layers) {
        if (!l.visible) continue;
        if (l.specOnly) {
          edge(l);
          ctx.fillStyle = accent; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
          ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
        if (isTarget(l)) {
          edge(l);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
          ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
        }
      }
    }
    if (app.trimming) {
      const l = selLayer();
      for (const poly of (l ? clipPolys(l) : [])) { // the windows it shows through now
        outline(poly);
        ctx.fillStyle = accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = accent; ctx.lineWidth = 1.75; ctx.stroke();
      }
    }
    if ((app.trimming || app.tool === 'piece') && hover) {
      outline(regionOutline(hover));
      if (app.tool === 'piece' && !app.trimming) { ctx.fillStyle = app.colour; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.75; ctx.stroke(); ctx.setLineDash([]);
    }
    if (app.trimming) return;
    if (rubber) {
      const b = evenBox(rubber.a, rubber.b, rubber.even), A = onScreen(b), B = onScreen({ x: b.x + b.w, y: b.y + b.h });
      if (!BOXED.has(app.shapeKind)) { if (b.w > 0 && b.h > 0) preview(boxOutline(app.shapeKind, b.x, b.y, b.w, b.h)); return; }
      ctx.beginPath();
      if (app.shapeKind === 'ellipse') ctx.ellipse((A.x + B.x) / 2, (A.y + B.y) / 2, (B.x - A.x) / 2, (B.y - A.y) / 2, 0, 0, Math.PI * 2);
      else if (app.shapeKind === 'triangle') { ctx.moveTo((A.x + B.x) / 2, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(A.x, B.y); ctx.closePath(); }
      else ctx.rect(A.x, A.y, B.x - A.x, B.y - A.y);
      ctx.fillStyle = app.colour; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    if (app.tool === 'stamp' && cursor) { preview(placed(env.motif(app.stamp.key), cursor.x, cursor.y, app.stamp.size)); return; }
    if (band) {
      if (far(band.a, band.b) > 0) preview(bandPts(band.a, band.b, app.bandWidth));
      square(onScreen(band.a), 4, accent);
      return;
    }
    if (drag && drag.kind === 'marquee' && drag.went) {
      const A = onScreen(drag.a), B = onScreen(drag.b);
      ctx.fillStyle = accent; ctx.globalAlpha = 0.1; ctx.fillRect(A.x, A.y, B.x - A.x, B.y - A.y); ctx.globalAlpha = 1;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.25; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y); ctx.setLineDash([]);
    }
    const many = app.tool === 'select' ? env.selectedLayers() : [];
    if (many.length > 1) for (const l of many) { // each of several selected layers, boxed
      const b = boxOf(l);
      if (!b) continue;
      const A = onScreen({ x: b.x0, y: b.y0 }), B = onScreen({ x: b.x1, y: b.y1 });
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.25; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y);
    }
    // a Mirrored layer's other side, dashed, so the pair reads as one thing
    const twin = app.tool === 'select' && selLayer() ? env.mirrorImage(selLayer()) : null;
    if (twin) {
      if (isShape(twin)) path(twin.pts, true);
      else if (isRegionLayer(twin)) outline(corners(twin));
      else ctx.beginPath();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    const pic = app.tool === 'select' ? selPic() : null;
    if (pic) {
      const h = turnHandle(pic);
      ctx.beginPath(); ctx.moveTo(h.top.x, h.top.y); ctx.lineTo(h.x, h.y); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      layerCorners(pic).forEach((q) => square(onScreen(q), 4.5, accent));
    }
    const turnKnob = (fr) => { // the round handle that turns a shape, on a short stalk above its frame
      ctx.beginPath(); ctx.moveTo(fr.top.x, fr.top.y); ctx.lineTo(fr.turn.x, fr.turn.y); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(fr.turn.x, fr.turn.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    };
    const box = app.tool === 'select' ? selBox() : null;
    if (box) { turnKnob(frameOf(box)); corners(box).forEach((q) => square(onScreen(q), 4.5, accent)); }
    const frameLine = (fr) => { // a thin line round a frame, and its knob
      ctx.beginPath(); fr.corners.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      turnKnob(fr);
    };
    if (selMany()) frameLine(frameFor(manyBox(selMany())));
    const fadeDots = () => { // where the fade starts (a ring) and where it ends (a dot)
      const faded = app.tool === 'select' ? selFade() : null, rep = app.tool === 'select' ? selRepAim() : null;
      if (rep) dots(repeatAim(rep));
      if (faded) dots(fadeEnds(faded));
    };
    const dots = (ends) => {
      const A = onScreen(ends.a), B = onScreen(ends.b);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      for (const [q, solid] of [[A, false], [B, true]]) {
        ctx.beginPath(); ctx.arc(q.x, q.y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = solid ? '#101114' : '#ffffff'; ctx.fill();
        ctx.strokeStyle = solid ? '#ffffff' : '#101114'; ctx.lineWidth = 2; ctx.stroke();
      }
    };
    const shape = app.tool === 'select' ? selShape() : null;
    if (!shape) { fadeDots(); return; }
    path(shape.pts, true);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    if (pointsShow(shape)) {
      shape.pts.forEach((q, i) => { // the dot that bends each line
        const m = onScreen(midOf(shape.pts, i));
        ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      });
      shape.pts.forEach((q) => square(onScreen(q), 4.5, accent));
    }
    // its frame: a thin line round the box, a white handle off each corner to resize by, the knob to turn by
    const fr = frameOf(shape);
    frameLine(fr);
    fr.corners.forEach((q) => square(q, 5, '#ffffff'));
    fadeDots();
  }

  // the Turn box in Place: the shape goes round its own middle to stand at deg
  // several selected: the angle their box is turned to, in degrees (null: none of them can turn), and turning them there
  function manyTurnNow() {
    const ls = selMany();
    return ls ? Math.round(((manyBox(ls).t * 180 / Math.PI) % 360 + 540) % 360 - 180) : null;
  }
  function turnManyTo(deg) {
    const ls = selMany();
    if (!ls) return;
    const b = manyBox(ls);
    spinBy(spinFrom(ls, { x: 0, y: 0 }, b), deg * Math.PI / 180 - b.t);
  }
  function turnTo(l, deg) {
    spinBy(spinFrom([l], { x: 0, y: 0 }, shapeBox(l)), (deg - (l.turn || 0)) * Math.PI / 180);
    l.turn = deg; // exact, so two shapes typed to the same angle match
  }

  return { down, move, up, key, context, cancel, hint, drawOverlay, turnTo, turnManyTo, manyTurnNow, drawing: () => !!(draft && draft.length) };
}
