// Overspray: Map mode. The map is what the app knows about the
// sheet beyond pixels: which outline is which panel, which panel is the twin
// of which, and where a panel's centreline runs. Painting tools (fill a
// panel, trim, mirror) work from it; this mode is where it is looked at and
// corrected.

import { SIZE, createImageLayer, loadImage } from '../js/engine.js';
import { regionOutline, regionById, centerLine, snapToOutline, slideAlong, edgeSpan, labelPoint, linkPoints, linkLength, linkDir, nearestIsStretch, matchPoint, twinLink, twinOf, syncTwin, addTwins, setMirror, suggestPairs, MIRROR_KINDS } from '../js/regions.js';
import { pieceAt } from '../js/mirror.js';
import { hexToRgb } from './picker.js';

export const GUIDE = 'Panel guide'; // the layer that puts the panel colours on the car
export const pieces = (map) => (map ? map.regions.filter(r => !r.kind) : []);
// golden-angle steps keep neighbours in the list far apart in colour
export const hue = (i, alpha = 1) => `hsl(${(i * 137.5) % 360} 62% ${i % 2 ? 64 : 50}% / ${alpha})`;

// where each panel's name goes; worked out once per outline, not per frame
const labelCache = new WeakMap();
function labelOf(r, later) {
  const c = labelCache.get(r);
  if (c && c.n === r.points.length && c.x0 === r.points[0].x && c.y0 === r.points[0].y) return c.p;
  const p = labelPoint(r, later);
  labelCache.set(r, { n: r.points.length, x0: r.points[0].x, y0: r.points[0].y, p });
  return p;
}

// Linked edges get the same run of colour bands down both sides, so on the car
// the same colours should face each other across the join. Strong colours,
// unlike each other, in an order that reads differently backwards: a link made
// the wrong way round shows up.
// Each link shuffles them into its own order, and leaves out colours close to
// its panels' own fill, so ends of different links rarely share a colour and
// the blocks stand out from the panel. A link's twin gets the same blocks.
const BANDS = ['#ffffff', '#101114', '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324', '#808000'];
const hueOf = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d < 0.2) return null; // white, black: never close to a panel
  const h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return (h * 60 + 360) % 360;
};
const panelHue = (i) => (i * 137.5) % 360; // as hue() above
function bandsFor(key, avoid) {
  const out = BANDS.filter(c => { const h = hueOf(c); return h === null || avoid.every(a => Math.min(Math.abs(h - a), 360 - Math.abs(h - a)) > 35); });
  let s = Math.imul(key + 1, 2654435761);
  for (let k = out.length - 1; k > 0; k--) {
    s = Math.imul(s ^ (s >>> 15), 2246822507); s ^= s >>> 13;
    const j = (s >>> 0) % (k + 1);
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}
// a link and its twin share one number (the earlier one's place in the list),
// so they get the same colours; worked out again only when the map changes
let keyCache = { s: null, keys: [] };
function linkKeys(m) {
  const links = m.links || [], s = JSON.stringify([links, m.regions.map(r => [r.mirror, r.mirrorKind, r.center, r.points && r.points.length])]);
  if (s !== keyCache.s) keyCache = { s, keys: links.map((l, i) => { const t = twinOf(m, l); return t ? Math.min(i, links.indexOf(t)) : i; }) };
  return keyCache.keys;
}
const linkHue = (i) => `hsl(${(i * 137.5 + 40) % 360} 95% 62%)`;

// Pair panels: the twins the map could still have (see suggestPairs), worked
// out again only when the map changes, not on every redraw of the list
let pairCache = { s: null, list: null };
export function pairList(m) {
  const s = JSON.stringify(m.regions.map(r => [r.id, r.mirror, r.noPair, !!r.center, r.points && r.points.length, r.x, r.y]));
  if (s !== pairCache.s) pairCache = { s, list: suggestPairs(m) };
  return pairCache.list;
}
// While the pairing list is open the sheet is grey, and the panels being
// checked are pink (the first) and blue (the second), on the car too, so
// even a piece too small for its name shows which is which
export const GREY = '#d4d4d8', PAIR_COLOURS = ['#ff2bd6', '#00a3ff'];
const pairColour = (id, ...lists) => { for (const l of lists) if (l && l.includes(id)) return PAIR_COLOURS[l.indexOf(id)]; return GREY; };
let pink = null; // ids of the panels the guide on the car shows pink, or null for the usual guide
export const setGuidePink = (ids) => { pink = ids; };

// The panel colours, names, linked edges and centrelines as a full-sheet
// picture: what the "Show on car" guide layer is made of.
export function guideCanvas(map) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const list = pieces(map);
  const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };
  list.forEach((r, i) => {
    trace(regionOutline(r));
    ctx.fillStyle = pink ? pairColour(r.id, pink) : hue(i); ctx.fill();
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 3; ctx.stroke();
  });
  if (pink) return c; // just the panels being checked, nothing else to look past
  const keys = linkKeys(map), at = (id) => panelHue(list.findIndex(r => r.id === id));
  (map.links || []).forEach((link, i) => {
    const n = Math.max(3, Math.min(16, Math.round(linkLength(map, link) / 48)));
    const twins = map.links.filter((l, j) => keys[j] === keys[i]);
    const bands = bandsFor(keys[i], twins.flatMap(l => [at(l.a.region), at(l.b.region)]));
    for (const side of ['a', 'b']) {
      const r = regionById(map, link[side].region);
      if (!r) continue;
      // drawn on a scrap of canvas round the stretch, then trimmed to the spots
      // this edge is nearest to before going on the sheet
      const all = linkPoints(map, link, side, 0, 1, 3);
      if (!all.length) continue;
      const x0 = Math.floor(Math.min(...all.map(q => q.x)) - 23), y0 = Math.floor(Math.min(...all.map(q => q.y)) - 23);
      const sc = document.createElement('canvas');
      sc.width = Math.ceil(Math.max(...all.map(q => q.x)) + 23) - x0; sc.height = Math.ceil(Math.max(...all.map(q => q.y)) + 23) - y0;
      const g = sc.getContext('2d');
      g.translate(-x0, -y0);
      g.beginPath(); regionOutline(r).forEach((q, j) => (j ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
      g.clip(); // the band stays inside its own panel
      g.lineCap = 'butt'; g.lineWidth = 44; // half falls outside the outline and is clipped away
      for (let k = 0; k < n; k++) {
        const pts = linkPoints(map, link, side, k / n, (k + 1) / n, 3);
        g.beginPath(); pts.forEach((q, j) => (j ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.strokeStyle = bands[k % bands.length]; g.stroke();
      }
      const img = g.getImageData(0, 0, sc.width, sc.height), px = img.data, mine = nearestIsStretch(regionOutline(r), all, 22);
      for (let y = 0; y < sc.height; y++) for (let x = 0; x < sc.width; x++) {
        const o = (y * sc.width + x) * 4;
        if (px[o + 3] && !mine(x0 + x + 0.5, y0 + y + 0.5)) px[o + 3] = 0;
      }
      g.putImageData(img, 0, 0);
      ctx.drawImage(sc, x0, y0);
    }
  });
  for (const r of list) {
    const cl = centerLine(r);
    if (!cl) continue;
    ctx.save();
    trace(regionOutline(r)); ctx.clip();
    ctx.beginPath(); ctx.moveTo(cl.p0.x, cl.p0.y); ctx.lineTo(cl.p1.x, cl.p1.y);
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 14; ctx.stroke();
    ctx.setLineDash([28, 20]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 8; ctx.stroke();
    ctx.restore();
  }
  list.forEach((r, i) => {
    const p = labelOf(r, list.slice(i + 1));
    let size = Math.max(14, Math.min(64, p.room * 0.7));
    ctx.font = `700 ${size}px "IBM Plex Mono", monospace`;
    const fit = (p.room * 1.7) / ctx.measureText(r.name).width;
    if (fit < 1) { size = Math.max(11, size * fit); ctx.font = `700 ${size}px "IBM Plex Mono", monospace`; }
    ctx.lineWidth = size / 4; ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, p.x, p.y);
    ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, p.x, p.y);
  });
  return c;
}

export const guideLayer = (doc) => doc.layers.find(l => l.type === 'image' && l.name === GUIDE) || null;
// Puts the guide on the car (a locked layer on top of everything), refreshes
// it after a map edit, or takes it off again.
export async function syncGuide(doc, on) {
  const old = guideLayer(doc);
  if (!on) { if (old) doc.layers.splice(doc.layers.indexOf(old), 1); return; }
  if (!doc.regionMap) return;
  const src = guideCanvas(doc.regionMap).toDataURL('image/png');
  const img = await loadImage(src);
  if (old) { old.img = img; old.src = src; return; }
  const layer = createImageLayer(img, src, GUIDE);
  layer.scale = 1;
  layer.locked = true; // sheet-sized: it must never be grabbed by a click
  doc.layers.push(layer);
}

export function initMap(app, env) {
  const { screenToDoc, docToScreen, requestDraw } = env;
  let pending = null;   // centreline: the first corner clicked, { region, x, y }
  let snap = null;      // centreline and link: where a click would land right now
  // Link edges: which edges meet on the car. Four clicks make one: the two
  // ends of the shared stretch on one panel, then the two spots they meet on
  // the other, in the same order. Links live in the map (see regions.js).
  let ends = [];        // the ends clicked so far for the link being made: { region, x, y }
  let seam = null;      // near a linked edge: that spot and the one it meets, { at, partner }
  let slide = null;     // a link's end being slid along its edge: { region, ends, start, moved }
  let picked = null;    // the link end last grabbed, for the arrow keys to nudge: { region, ends }
  // Pair panels: click a panel, then its pair; again for the next pair. The
  // Centreline tool (from the toolbar) also keeps going, one panel after another.
  let pairFirst = null; // pair: the panel clicked first, waiting for its partner
  let undos = [];       // centreline and pair: how to take back each one made, newest last → what to say
  // Place a piece: a loose piece (a wing) is shown where it sits on the car by
  // two dragged lines, one along the piece, then the matching one over the
  // panel it lies beside on the car. Places live in the map (see regions.js).
  let drag = null;      // place: the line being dragged, { region, from, to }
  let placing = null;   // place: the piece's line, waiting for its match

  const map = () => app.doc.regionMap;
  const sel = () => (map() && app.piece ? regionById(map(), app.piece) : null);

  // the nearest spot on a panel's edge, corners preferred (free: no corner pull)
  function edgeSnap(p, only, reach = 14 / app.view.zoom, free = false) {
    let best = null;
    for (const r of pieces(map())) {
      if (only && r.id !== only) continue;
      const q = snapToOutline(regionOutline(r), p.x, p.y, free ? 0 : 4 / app.view.zoom);
      if (q.d <= reach && (!best || q.d < best.d)) best = { region: r.id, x: q.x, y: q.y, d: q.d };
    }
    return best;
  }
  const centreTarget = () => (pending ? pending.region : app.centreFor);
  // the second end of a stretch stays on the first end's panel; an end of a link already on that edge is landed on exactly
  // (skip: ends not to land on, the ones being slid; free: no pull to corners or ends, Alt held while sliding)
  function linkSnap(p, only = ends.length % 2 ? ends[ends.length - 1].region : null, reach, skip = [], free = false) {
    const hit = edgeSnap(p, only, reach, free);
    if (!hit || free) return hit;
    for (const l of map().links || []) for (const sd of [l.a, l.b]) {
      if (sd.region !== hit.region) continue;
      for (const end of [sd.from, sd.to]) if (!skip.includes(end) && Math.hypot(end.x - hit.x, end.y - hit.y) <= 10 / app.view.zoom) return { region: hit.region, x: end.x, y: end.y };
    }
    return hit;
  }
  // The link end under the pointer, with every other end at that same spot on
  // the same panel: where two links butt up on one edge they move together.
  function linkEndAt(s) {
    const m = map(), links = m.links || [];
    for (const l of links) for (const sd of [l.a, l.b]) for (const end of [sd.from, sd.to]) {
      const q = docToScreen(end.x, end.y);
      if (Math.hypot(q.x - s.x, q.y - s.y) > 9) continue;
      const mates = [];
      for (const l2 of links) for (const side of ['a', 'b']) {
        const s2 = l2[side];
        if (s2.region !== sd.region) continue;
        const hit = [s2.from, s2.to].filter(e => Math.hypot(e.x - end.x, e.y - end.y) < 0.6);
        // which way round the stretch runs is pinned, or it would flip to the
        // short way the moment it is slid past half the outline
        if (hit.length) { s2.dir = linkDir(m, l2, side); mates.push(...hit); }
      }
      return { region: sd.region, ends: mates };
    }
    return null;
  }
  // would moving these ends to `to` land them on the other end of their own stretch?
  const clashes = (moving, to) => map().links.some(l => [l.a, l.b].some(sd =>
    (moving.includes(sd.from) ? [sd.to] : moving.includes(sd.to) ? [sd.from] : []).some(o => Math.hypot(o.x - to.x, o.y - to.y) < 2)));
  const place = (moving, to) => { for (const end of moving) { end.x = Math.round(to.x * 10) / 10; end.y = Math.round(to.y * 10) / 10; } };
  // Left/Right: the picked end `step` px along its panel's edge, Right whichever way
  // goes more right on screen at the first press (on an upright edge: down), never past a sharp corner
  function nudge(dir, step) {
    const m = map(), r = picked && regionById(m, picked.region);
    // gone if the link was removed or the map replaced (undo)
    if (!r || !(m.links || []).some(l => [l.a, l.b].some(sd => picked.ends.includes(sd.from) || picked.ends.includes(sd.to)))) { picked = null; requestDraw(); return; }
    const e0 = picked.ends[0], pts = regionOutline(r);
    // settled on the first press and kept: which way round the outline Right goes
    // (so a bend can't flip it), and the edge the end stays on (it stops at sharp corners)
    if (!picked.way) {
      const fwd = slideAlong(pts, e0.x, e0.y, 1), back = slideAlong(pts, e0.x, e0.y, -1);
      const dx = fwd.x - back.x, dy = fwd.y - back.y;
      picked.way = (Math.abs(dx) > 0.1 ? dx : dy) > 0 ? 1 : -1;
      picked.span = edgeSpan(pts, e0.x, e0.y, dir * picked.way);
    }
    const to = slideAlong(pts, e0.x, e0.y, dir * picked.way * step, picked.span);
    if (clashes(picked.ends, to)) { env.say('The two ends need to be apart'); return; }
    place(picked.ends, to);
    syncTwins(picked.pairs);
    seam = null;
    requestDraw();
    // saved, sent live and one undo step once the presses stop, not on every one
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => env.mapChanged(), 400);
  }
  let nudgeTimer = null;
  // the twins of the links these ends belong to, found before they move: [link, twin] pairs
  function twinsOf(moving) {
    const m = map(), mine = (m.links || []).filter(l => [l.a, l.b].some(sd => moving.includes(sd.from) || moving.includes(sd.to)));
    return mine.map(l => [l, twinOf(m, l)]).filter(([, t]) => t && !mine.includes(t));
  }
  // once editing stops, the twins on the other side of the car follow
  const syncTwins = (pairs) => { for (const [l, t] of pairs) if (map().links.includes(t)) syncTwin(map(), l, t); };
  const nameOf = (id) => (regionById(map(), id) || { name: id }).name;
  // a link goes with its twin on the other side of the car, as they were made: → the twin removed, or null
  function dropLink(m, link) {
    const twin = twinOf(m, link);
    for (const l of [link, twin]) if (l) m.links.splice(m.links.indexOf(l), 1);
    picked = null;
    return twin;
  }
  function linkClick(p, remove) {
    const m = map();
    if (remove) {
      const hit = matchPoint(m, p.x, p.y, 12 / app.view.zoom);
      if (!hit) { env.say('No link there to remove'); return; }
      const twin = dropLink(m, m.links[hit.index]);
      seam = null;
      env.mapChanged(twin ? 'Link removed, and its twin on the other side' : 'Link removed');
      return;
    }
    const n = ends.length, hit = linkSnap(p);
    if (!hit) { env.say(n % 2 ? 'Click the other end on the same panel\'s edge' : 'Click closer to a panel\'s edge'); return; }
    if (n % 2 && Math.hypot(hit.x - ends[n - 1].x, hit.y - ends[n - 1].y) < 2) { env.say('The two ends need to be apart'); return; }
    ends.push(hit);
    if (ends.length < 4) { requestDraw(); env.refreshChrome(); return; }
    const [a1, a2, b1, b2] = ends, pt = (c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 });
    const link = { a: { region: a1.region, from: pt(a1), to: pt(a2) }, b: { region: b1.region, from: pt(b1), to: pt(b2) } };
    (m.links || (m.links = [])).push(link);
    const twin = twinLink(m, link); // the matching edges on the other side of the car get linked too
    if (twin) m.links.push(twin);
    ends = []; snap = null;
    env.mapChanged(`Linked ${nameOf(a1.region)} and ${nameOf(b1.region)}` + (twin ? `, and ${nameOf(twin.a.region)} and ${nameOf(twin.b.region)}` : ''));
  }

  const copied = (added) => (added.length ? `, and ${added.length} link${added.length > 1 ? 's' : ''} copied to the other side` : '');
  const dropAdded = (added) => { const l = map().links || []; for (const t of added) if (l.includes(t)) l.splice(l.indexOf(t), 1); };

  // the panel whose edge is nearest, for a line started off every panel (a wing that sits above the side)
  function nearestPiece(p, not) {
    let best = null;
    for (const r of pieces(map())) {
      if (r.id === not) continue;
      const d = snapToOutline(regionOutline(r), p.x, p.y).d;
      if (!best || d < best.d) best = { r, d };
    }
    return best && best.r;
  }
  function placeUp() {
    const d = drag, a = docToScreen(d.from.x, d.from.y), b = docToScreen(d.to.x, d.to.y);
    drag = null;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8) { env.say(placing ? 'Drag a line, front to back, where the piece sits' : 'Drag a line along the piece, front to back'); requestDraw(); return; }
    if (!placing) { placing = d; env.pickPiece(d.region); return; }
    const m = map(), piece = placing;
    placing = null;
    m.places = (m.places || []).filter(pl => pl.piece.region !== piece.region); // one place per piece: placing again moves it
    m.places.push({ piece, at: d });
    app.piece = piece.region;
    env.mapChanged(`${nameOf(piece.region)} placed over ${nameOf(d.region)}`);
  }

  function down(e, s) {
    if (!map()) return;
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'mplace') {
      const r = pieceAt(map(), p.x, p.y) || (placing ? nearestPiece(p, placing.region) : null);
      if (!r) { env.say('Start on the loose piece'); return; }
      if (placing && r.id === placing.region) { env.say('Now drag the matching line on another panel, where the piece sits on the car'); return; }
      const q = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
      drag = { region: r.id, from: q, to: { ...q } };
      requestDraw();
      return;
    }
    if (app.tool === 'mlink') {
      // a press on a link's end: a drag slides it along the edge, a plain click still counts as a click there
      const grab = !e.altKey && !ends.length ? linkEndAt(s) : null;
      if (grab) grab.pairs = twinsOf(grab.ends);
      if (grab && e.shiftKey) { picked = grab; requestDraw(); env.refreshChrome(); return; } // fine-tune it with the arrow keys
      if (grab) { slide = { ...grab, start: s, moved: false }; picked = grab; }
      else linkClick(p, e.altKey);
      return;
    }
    if (app.tool === 'mcentre') {
      const hit = edgeSnap(p, centreTarget());
      if (!hit) { env.say(pending ? 'Click the matching corner on the same panel' : 'Click closer to the panel\'s edge'); return; }
      if (!pending) { pending = hit; requestDraw(); env.refreshChrome(); return; }
      if (Math.hypot(hit.x - pending.x, hit.y - pending.y) < 2) { env.say('The two corners need to be apart'); return; }
      const r = regionById(map(), hit.region), pt = (c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 });
      const before = r.center, first = pending;
      r.center = { a: pt(pending), b: pt(hit) };
      pending = snap = null;
      app.piece = r.id;
      const added = addTwins(map()); // links made before the centreline get their twins now
      if (app.centreFor) { app.centreFor = null; app.tool = 'mpick'; } // from the panel's button: just that one
      else undos.push(() => { if (before) r.center = before; else delete r.center; dropAdded(added); pending = first; return `Centreline taken off ${r.name}`; });
      env.mapChanged(`Centreline set on ${r.name}${copied(added)}`);
      return;
    }
    if (app.tool === 'mpair') {
      const r = pieceAt(map(), p.x, p.y);
      if (!r) { env.say('Click a panel'); return; }
      if (app.pairOpen) { env.pairPick(r.id); return; } // a row of the list is open: this is the panel to pair it with instead
      if (!pairFirst) { pairFirst = r.id; env.pickPiece(r.id); return; }
      if (r.id === pairFirst) { env.say('Now click its pair, a different panel'); return; }
      const a = regionById(map(), pairFirst), before = map().regions.map(x => [x, x.mirror, x.mirrorKind]);
      setMirror(map(), a, r.id);
      const added = addTwins(map());
      pairFirst = null;
      app.piece = a.id; // shows the pair just made
      undos.push(() => {
        for (const [x, m, k] of before) { if (m) x.mirror = m; else delete x.mirror; if (k) x.mirrorKind = k; else delete x.mirrorKind; }
        dropAdded(added);
        pairFirst = app.piece = a.id;
        return `${a.name} and ${r.name} unpaired`;
      });
      env.mapChanged(`${a.name} paired with ${r.name}${copied(added)}`);
      return;
    }
    const r = pieceAt(map(), p.x, p.y);
    env.pickPiece(r ? r.id : null);
  }

  function move(e, s) {
    if (!map()) return;
    if (app.tool === 'mplace' && drag) {
      const p = screenToDoc(s.x, s.y);
      drag.to = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
      requestDraw();
      return;
    }
    if (app.tool === 'mlink') {
      const p = screenToDoc(s.x, s.y);
      if (slide) {
        if (!slide.moved && Math.hypot(s.x - slide.start.x, s.y - slide.start.y) < 4) return;
        slide.moved = true;
        const to = linkSnap(p, slide.region, Infinity, slide.ends, e.altKey);
        // an end may not land on the other end of its own stretch
        if (to && !clashes(slide.ends, to)) place(slide.ends, to);
        snap = seam = null;
        requestDraw();
        return;
      }
      snap = linkSnap(p);
      const m = matchPoint(map(), p.x, p.y, 10 / app.view.zoom); // where this spot lands on the other panel
      seam = m ? { at: m.at, partner: m.partner } : null;
      requestDraw();
      return;
    }
    if (app.tool !== 'mcentre') return;
    const hit = edgeSnap(screenToDoc(s.x, s.y), centreTarget());
    if ((hit && hit.x) !== (snap && snap.x) || (hit && hit.y) !== (snap && snap.y)) { snap = hit; requestDraw(); }
  }

  function up() {
    if (drag) return placeUp();
    if (!slide) return;
    const d = slide;
    slide = null;
    if (d.moved) { syncTwins(d.pairs); env.mapChanged(); env.refreshChrome(); }
    else { picked = null; linkClick(screenToDoc(d.start.x, d.start.y), false); }
  }

  function key(e) {
    if (app.tool === 'mlink' && picked && !ends.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { nudge(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey ? 10 : 1); return true; }
    if (app.tool === 'mpair' && !pairFirst && (e.key === 'f' || e.key === 'F') && sel() && sel().mirror) { // the next flip for the pair just made
      env.mapFlip(MIRROR_KINDS[(MIRROR_KINDS.indexOf(sel().mirrorKind || 'flip') + 1) % MIRROR_KINDS.length]);
      return true;
    }
    const back = e.key === 'Backspace' || e.key === 'Delete';
    if (app.tool === 'mplace' && (back || e.key === 'Escape') && placing) { placing = null; requestDraw(); env.refreshChrome(); return true; } // the piece's line taken back
    if ((app.tool === 'mcentre' || app.tool === 'mpair') && back) { // takes back the last click
      if (pending || pairFirst) { pending = snap = pairFirst = null; if (app.tool === 'mpair') env.pickPiece(null); else { requestDraw(); env.refreshChrome(); } }
      else if (undos.length) env.mapChanged(undos.pop()());
      return true;
    }
    if (app.tool === 'mlink' && back) { // takes back the last click, or the last link made
      if (ends.length) { ends.pop(); requestDraw(); env.refreshChrome(); }
      else if (map() && (map().links || []).length) { const m = map(), twin = dropLink(m, m.links[m.links.length - 1]); seam = null; env.mapChanged(twin ? 'Last link removed, and its twin' : 'Last link removed'); }
      return true;
    }
    if (e.key !== 'Escape') return false;
    if (app.tool === 'mpair' && app.pairOpen) env.pairClose();
    else if (pending) { pending = null; requestDraw(); env.refreshChrome(); }
    else if (pairFirst) { pairFirst = null; env.pickPiece(null); }
    else if (picked && app.tool === 'mlink') { picked = null; requestDraw(); env.refreshChrome(); }
    else if (ends.length) { ends = []; requestDraw(); env.refreshChrome(); }
    else if (app.tool === 'mcentre' || app.tool === 'mlink' || app.tool === 'mpair' || app.tool === 'mplace') env.setTool('mpick');
    else env.pickPiece(null);
    return true;
  }
  function cancel() { pending = snap = seam = slide = picked = pairFirst = drag = placing = null; ends = []; undos = []; }

  const hint = () => {
    if (app.tool === 'hand') return 'Drag to move the sheet · wheel zooms · H or Esc puts it down';
    if (!map()) return 'Open a blank template to get a map';
    const takeBack = ' · Delete or Backspace takes one back';
    if (app.tool === 'mcentre') return (pending ? 'Click the matching corner on the other side' : 'Click a corner, then its match on the other side') + (app.centreFor ? '' : takeBack);
    if (app.tool === 'mpair' && app.pairOpen) return `Click a panel to pair ${nameOf(app.pairOpen.ids[0])} with it instead · Esc closes the row`;
    if (app.tool === 'mpair') return (pairFirst ? `Now click the pair of ${nameOf(pairFirst)}` : 'Click a panel, then its pair on the other side of the car') + (!pairFirst && sel() && sel().mirror ? ' · F tries the next flip' : '') + takeBack;
    if (app.tool === 'mplace') return placing ? `Now drag the same line, front to back, where ${nameOf(placing.region)} sits on the car: over the panel it lies beside · Delete takes it back` : 'Drag a line along a loose piece (a wing, say), front to back. Placing it again moves it';
    if (app.tool === 'mlink') return [(picked ? '← → nudge this end (Shift: 10 px) · Esc lets go · ' : '') + 'Click one end of an edge that meets another panel · drag a link\'s end to move it (hold Alt to skip snapping), Shift+click it to nudge it with ← → · Alt+click removes a link', 'Click the other end, on the same panel', 'Now the spot on the other panel that meets end 1', 'And the spot that meets end 2'][ends.length] + (ends.length ? takeBack : '');
    return sel() ? 'Name it, pair it or set its centreline on the right' : 'Click a panel';
  };

  // screen space
  function drawOverlay(ctx, accent) {
    const m = map();
    if (!m) return;
    const S = (q) => docToScreen(q.x, q.y);
    const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const a = S(q); i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); }); ctx.closePath(); };
    const list = pieces(m), z = app.view.zoom;
    ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pairing = app.tool === 'mpair';
    list.forEach((r, i) => {
      trace(regionOutline(r));
      if (pairing) { ctx.fillStyle = pairColour(r.id, app.pairOpen && app.pairOpen.ids, app.pairHover); ctx.fill(); }
      else if (app.mapShow.colours) { ctx.fillStyle = hue(i, 0.82); ctx.fill(); }
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.25; ctx.stroke();
    });
    for (const r of m.regions) { // the kit's own number and sponsor boxes
      if (!r.kind) continue;
      const a = S(r), b = S({ x: r.x + r.w, y: r.y + r.h });
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#101114'; ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    for (const r of list) {
      const cl = centerLine(r);
      if (!cl) continue;
      ctx.save();
      trace(regionOutline(r)); ctx.clip();
      const a = S(cl.p0), b = S(cl.p1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([9, 6]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    if (app.mapShow.colours) list.forEach((r, i) => {
      const p = labelOf(r, list.slice(i + 1));
      let size = Math.max(14, Math.min(64, p.room * 0.7)) * z;
      if (size < 7) return; // too small to read at this zoom
      ctx.font = `600 ${size}px "IBM Plex Mono", monospace`;
      const fit = (p.room * 1.7 * z) / ctx.measureText(r.name).width;
      if (fit < 1) { size *= fit; if (size < 7) return; ctx.font = `600 ${size}px "IBM Plex Mono", monospace`; }
      const a = S(p);
      ctx.lineWidth = Math.max(2, size / 4); ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, a.x, a.y);
      ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, a.x, a.y);
    });
    const cur = sel();
    if (cur) {
      const twin = cur.mirror ? regionById(m, cur.mirror) : null;
      if (twin) { trace(regionOutline(twin)); ctx.setLineDash([7, 5]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
      trace(regionOutline(cur));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
    }
    const dot = (q, r, fill) => { const a = S(q); ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); };
    // linked edges: both stretches of a link in one colour, a big dot on the ends that meet each other
    ctx.lineCap = 'round';
    const keys = linkKeys(m);
    (m.links || []).forEach((link, i) => {
      for (const side of ['a', 'b']) {
        const pts = linkPoints(m, link, side);
        if (!pts.length) continue;
        // only on the panel's own side of the edge, so a panel folding back close to itself isn't covered too
        ctx.save(); trace(regionOutline(regionById(m, link[side].region))); ctx.clip();
        ctx.beginPath(); pts.forEach((q, k) => { const a = S(q); k ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); });
        ctx.strokeStyle = '#101114'; ctx.lineWidth = 11.2; ctx.stroke(); // half of each width shows
        ctx.strokeStyle = linkHue(keys[i]); ctx.lineWidth = 6.4; ctx.stroke();
        ctx.restore();
        dot(pts[0], 5, linkHue(keys[i])); dot(pts[pts.length - 1], 3, linkHue(keys[i]));
      }
    });
    ctx.lineCap = 'butt';
    if (app.tool === 'mlink') {
      if (seam) { // this spot, and where it meets the other panel
        const a = S(seam.at), b = S(seam.partner);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.setLineDash([3, 5]); ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.strokeStyle = '#101114'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      if (picked && !ends.length) { const a = S(picked.ends[0]); ctx.beginPath(); ctx.arc(a.x, a.y, 11, 0, Math.PI * 2); ctx.strokeStyle = '#101114'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke(); } // the end the arrow keys move
      if (snap) { const a = S(snap); ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ends.forEach((c, k) => { dot(c, 8, accent); const a = S(c); ctx.fillStyle = '#ffffff'; ctx.fillText(String(k % 2 + 1), a.x, a.y + 0.5); }); // 1 meets 1, 2 meets 2
    }
    // placed pieces: the line along each, and the line it matches where it sits on the car
    const arrow = (a, b, col) => {
      const A = S(a), B = S(b), t = Math.atan2(B.y - A.y, B.x - A.x);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      for (const k of [-1, 1]) { ctx.moveTo(B.x, B.y); ctx.lineTo(B.x - 11 * Math.cos(t + k * 0.45), B.y - 11 * Math.sin(t + k * 0.45)); }
      ctx.lineCap = 'round'; ctx.strokeStyle = '#101114'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineCap = 'butt';
      dot(a, 4, col);
    };
    for (const pl of m.places || []) {
      if (app.tool !== 'mplace' && !(cur && (pl.piece.region === cur.id || pl.at.region === cur.id))) continue;
      arrow(pl.piece.from, pl.piece.to, accent); arrow(pl.at.from, pl.at.to, accent);
    }
    if (placing) arrow(placing.from, placing.to, accent);
    if (drag) arrow(drag.from, drag.to, accent);
    if (pending) dot(pending, 6, accent);
    if (app.tool === 'mcentre' && snap) {
      const a = S(snap);
      ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      if (pending) { // where the centreline would run
        const p0 = S(pending);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(a.x, a.y);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  return { down, move, up, key, cancel, hint, drawOverlay };
}
