// Overspray region maps — labeled areas over the 2048 UV sheet with mirror
// relationships ("Left Door mirrors Right Door"). Pure data helpers; all
// coordinates are in 2048-sheet space. Every region has a rectangle (x, y, w,
// h); one may also carry "points", an outline of its real shape, in which case
// the rectangle is that outline's bounding box. A map may also carry "links":
// pairs of edge stretches that meet on the car (see the seam links section).
export const REGIONS_FORMAT = 'overspray-regions/1';

// The ways a twin can sit relative to its panel. 'flip' mirrors left to right
// and is what a hand-made pair gets; 'flipV' mirrors top to bottom (twins
// above and below each other on the sheet); 'rot180' is the panel turned half
// way round, no mirroring; 'same' is an unturned copy.
export const MIRROR_KINDS = ['flip', 'flipV', 'rot180', 'same'];

// caps on what a map file may hold, so a shared map that is broken or hostile
// cannot freeze the page; real cars use a small part of each
export const MAP_LIMITS = { regions: 1000, points: 200000, links: 5000, name: 80 };

// an empty map for a car
export const createRegionMap = (car) => ({ format: REGIONS_FORMAT, car: car || 'unknown car', regions: [] });

// Check a map read from JSON and return a clean copy holding only the fields
// known here. Anything wrong throws, with a message fit to show the user.
export function parseRegionMap(data) {
  if (typeof data !== 'object' || data === null) throw new Error('not a region map object');
  if (data.format !== REGIONS_FORMAT) throw new Error(`unknown format "${data.format}" (expected ${REGIONS_FORMAT})`);
  if (!Array.isArray(data.regions)) throw new Error('missing "regions" array');
  if (data.regions.length > MAP_LIMITS.regions) throw new Error(`too many regions (over ${MAP_LIMITS.regions})`);
  const nPoints = data.regions.reduce((n, r) => n + (r && Array.isArray(r.points) ? r.points.length : 0), 0);
  if (nPoints > MAP_LIMITS.points) throw new Error(`outlines are too detailed (over ${MAP_LIMITS.points} corners)`);
  for (const k of ['links', 'places', 'carLines']) {
    if (Array.isArray(data[k]) && data[k].length > MAP_LIMITS.links) throw new Error(`too many ${k} (over ${MAP_LIMITS.links})`);
  }
  const seen = new Set(); // ids so far, then every id once the regions are read
  const regions = [];
  data.regions.forEach((r, i) => {
    if (typeof r !== 'object' || r === null) throw new Error(`region ${i} is not an object`);
    const { id } = r;
    if (!id || typeof id !== 'string') throw new Error(`region ${i} has no id`);
    if (seen.has(id)) throw new Error(`duplicate region id "${id}"`);
    seen.add(id);
    const bad = ['x', 'y', 'w', 'h'].find(k => !Number.isFinite(r[k]));
    if (bad) throw new Error(`region "${id}" has a bad "${bad}"`);
    if (!(r.w > 0 && r.h > 0)) throw new Error(`region "${id}" has a non-positive size`);
    const named = typeof r.name === 'string' && r.name ? r.name : id;
    const out = { id, name: named.slice(0, MAP_LIMITS.name), x: r.x, y: r.y, w: r.w, h: r.h };
    if (!r.kind) out.name = cleanName(out.name) || cleanName(id) || 'panel'; // panel names follow the rule, whoever wrote the file
    if (r.mirror && typeof r.mirror === 'string') out.mirror = r.mirror;
    if (r.center !== undefined) {
      const { a, b } = r.center || {};
      const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
      if (!ok(a) || !ok(b) || (a.x === b.x && a.y === b.y)) throw new Error(`region "${r.id}" has a bad "center"`);
      out.center = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    }
    if (r.points !== undefined) {
      if (!Array.isArray(r.points) || r.points.length < 3
          || !r.points.every(q => q && Number.isFinite(q.x) && Number.isFinite(q.y))) {
        throw new Error(`region "${r.id}" has a bad "points" outline`);
      }
      out.points = r.points.map(q => ({ x: q.x, y: q.y }));
    }
    // zones read from a template (zones.js): sponsor or number box, which way
    // up artwork goes in it, and how its twin is turned
    if (['sponsor', 'number'].includes(r.kind)) out.kind = r.kind;
    if (r.rot === 90 || r.rot === 180 || r.rot === 270) out.rot = r.rot;
    if (out.mirror && MIRROR_KINDS.includes(r.mirrorKind)) out.mirrorKind = r.mirrorKind;
    if (r.noPair === true && !out.mirror) out.noPair = true; // checked: it has no twin (see suggestPairs)
    regions.push(out);
  });
  const orphan = regions.find(r => r.mirror && !seen.has(r.mirror));
  if (orphan) throw new Error(`region "${orphan.id}" mirrors unknown id "${orphan.mirror}"`);
  const car = typeof data.car === 'string' && data.car ? data.car.slice(0, MAP_LIMITS.name) : 'unknown car';
  const map = { format: REGIONS_FORMAT, car, regions };
  if (data.links !== undefined) {
    if (!Array.isArray(data.links)) throw new Error('"links" is not an array');
    const pt = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    map.links = data.links.map((l, i) => {
      const out = {};
      for (const side of ['a', 'b']) {
        const e = l && l[side];
        if (!e || !pt(e.from) || !pt(e.to)) throw new Error(`link ${i} has a bad "${side}" end`);
        if (!seen.has(e.region)) throw new Error(`link ${i} joins unknown region "${e.region}"`);
        out[side] = { region: e.region, from: { x: e.from.x, y: e.from.y }, to: { x: e.to.x, y: e.to.y } };
        if (e.dir === 1 || e.dir === -1) out[side].dir = e.dir;
      }
      return out;
    });
  }
  // a loose piece (a wing, a mirror) placed where it sits on the car: a line
  // along the piece, and the line it matches on another panel (see placeMatrix)
  if (data.places !== undefined) {
    if (!Array.isArray(data.places)) throw new Error('"places" is not an array');
    const pt = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    map.places = data.places.map((pl, i) => {
      const out = {};
      for (const k of ['piece', 'at']) {
        const e = pl && pl[k];
        if (!e || !pt(e.from) || !pt(e.to)) throw new Error(`place ${i} has a bad "${k}" line`);
        if (!seen.has(e.region)) throw new Error(`place ${i} is on unknown region "${e.region}"`);
        out[k] = { region: e.region, from: { x: e.from.x, y: e.from.y }, to: { x: e.to.x, y: e.to.y } };
      }
      return out;
    });
  }
  // which stretch of the car each panel takes a car gradient from: a line
  // dragged over one or more panels, front to back, and where it runs along
  // the car (a, b: 0 front to 1 back)
  if (data.carLines !== undefined) {
    if (!Array.isArray(data.carLines)) throw new Error('"carLines" is not an array');
    const pt = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    map.carLines = data.carLines.map((cl, i) => {
      if (!cl || !Array.isArray(cl.regions) || !pt(cl.from) || !pt(cl.to) || !Number.isFinite(cl.a) || !Number.isFinite(cl.b)) throw new Error(`car line ${i} is malformed`);
      return { regions: cl.regions.filter(id => seen.has(id)), from: { x: cl.from.x, y: cl.from.y }, to: { x: cl.to.x, y: cl.to.y }, a: cl.a, b: cl.b, ...(/^#[0-9a-f]{6}$/i.test(cl.color) ? { color: cl.color } : {}) };
    }).filter(cl => cl.regions.length);
  }
  return map;
}
// How well two maps' traced panels line up, 0..1: the share of outlined
// panels (sponsor/number zones aside) that have a panel of the same box in the
// other map, taken the worse way round. Maps traced from the same template
// score 1; a map made for another car, or before iRacing redrew the template,
// scores low. null when either map has no traced panels to compare.
export function mapFit(a, b, tol = 4) {
  const boxes = (m) => (m ? m.regions : []).filter(r => r.points && !r.kind);
  const A = boxes(a), B = boxes(b);
  if (!A.length || !B.length) return null;
  const share = (P, Q) => P.filter(p => Q.some(q => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol
    && Math.abs(p.w - q.w) <= tol && Math.abs(p.h - q.h) <= tol)).length / P.length;
  return Math.min(share(A, B), share(B, A));
}

export const regionById = (map, id) => map.regions.find(r => r.id === id) ?? null;

// even-odd test: is (x, y) inside the closed outline?
export function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// The region under (x, y). Where regions overlap, the one listed last is on top.
export function regionAt(map, x, y) {
  const hit = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
    && (!r.points || pointInPolygon(r.points, x, y));
  return map.regions.findLast(hit) ?? null;
}

// Which relation (see MIRROR_KINDS) lays src's outline most closely over
// dst's — how a pair of outlined regions should be mirrored when nothing has
// recorded it yet. Plain boxes fit every way equally, and then it is 'flip',
// the default. `kinds` narrows the choice, e.g. to the two reflections. The
// fit is measured both ways round, so which panel is named first can't change it.
// Where they sit on the sheet comes first: twins mirror across the line halfway
// between them, so side by side is a left/right flip and one above the other a
// top/bottom one. Near-symmetric panels (doors) fit several ways about as well,
// so another kind only wins there when it fits clearly better. Placed corner to
// corner, the shape alone decides.
export function guessMirrorKind(src, dst, kinds = MIRROR_KINDS) {
  if (kinds === MIRROR_KINDS) {
    const dx = Math.abs(dst.x + dst.w / 2 - src.x - src.w / 2), dy = Math.abs(dst.y + dst.h / 2 - src.y - src.h / 2);
    const placed = dx > 2 * dy ? 'flip' : dy > 2 * dx ? 'flipV' : null;
    if (placed) {
      const best = guessMirrorKind(src, dst, MIRROR_KINDS.filter(k => k !== placed));
      return mirrorMiss(src, dst, best) < mirrorMiss(src, dst, placed) / 2 ? best : placed;
    }
  }
  let best = kinds[0], bestD = Infinity;
  for (const kind of kinds) {
    const d = mirrorMiss(src, dst, kind);
    if (d < bestD - 1e-6) { best = kind; bestD = d; }
  }
  return best;
}

// how far src and dst land from each other's outlines under a kind, both ways round
function mirrorMiss(src, dst, kind) {
  const miss = (from, to, kind) => {
    const pts = regionOutline(from), onto = regionOutline(to);
    let d = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      for (const r of [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }]) {
        const m = mirrorPointKind(from, to, r.x, r.y, kind);
        d += snapToOutline(onto, m.x, m.y).d;
      }
    }
    return d;
  };
  return miss(src, dst, kind) + miss(dst, src, kind);
}
// Where (x, y) in src lands in its twin dst: the same spot as a share of each
// box, turned or mirrored as the kind says.
export function mirrorPointKind(src, dst, x, y, kind) {
  let u = src.w ? (x - src.x) / src.w : 0, v = src.h ? (y - src.y) / src.h : 0;
  if (kind === 'flip' || kind === 'rot180') u = 1 - u;
  if (kind === 'flipV' || kind === 'rot180') v = 1 - v;
  return { x: dst.x + u * dst.w, y: dst.y + v * dst.h };
}

// ---------- centerline ----------
// A region that spans the middle of the car (bonnet, roof, bumpers) can carry
// "center": two twin corners, one each side — { a, b }. Its centerline runs
// through the point halfway between them, square to the line joining them, so
// it comes out right however the region is turned on the sheet.

// { mid, dir (unit vector along the line), angle (degrees, as layers rotate),
//   p0, p1 (the line's ends, spanning the region) } — or null without a center
export function centerLine(r) {
  if (!r.center) return null;
  const { a, b } = r.center;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (!len) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dir = { x: -dy / len, y: dx / len };
  let t0 = Infinity, t1 = -Infinity;
  for (const q of regionOutline(r)) {
    const t = (q.x - mid.x) * dir.x + (q.y - mid.y) * dir.y;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return {
    mid, dir, angle: Math.atan2(dir.y, dir.x) * 180 / Math.PI,
    p0: { x: mid.x + dir.x * t0, y: mid.y + dir.y * t0 },
    p1: { x: mid.x + dir.x * t1, y: mid.y + dir.y * t1 },
  };
}

// (x, y) mirrored across the region's centerline
export function mirrorAcross(r, x, y) {
  const c = centerLine(r);
  if (!c) return { x, y };
  const vx = x - c.mid.x, vy = y - c.mid.y;
  const along = vx * c.dir.x + vy * c.dir.y;
  return { x: c.mid.x + 2 * along * c.dir.x - vx, y: c.mid.y + 2 * along * c.dir.y - vy };
}

// ---------- trimming ----------

// Push an outline outwards by d px (each corner along the average of its two
// edges' outward directions). Good for the few px of bleed a trim needs; not a
// general polygon offset.
export function growOutline(pts, d) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  const sign = area > 0 ? 1 : -1; // which side of an edge is outside
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const e1 = norm(p.x - a.x, p.y - a.y), e2 = norm(b.x - p.x, b.y - p.y);
    // outward normals of the two edges meeting here, averaged
    const m = norm(sign * (e1.y + e2.y), -sign * (e1.x + e2.x));
    return { x: p.x + m.x * d, y: p.y + m.y * d };
  });
}
function norm(x, y) {
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

// The window a layer is trimmed to when the user picks the spot (x, y) in a
// region: the region's outline — or, when it has a centerline, the half of it
// on that spot's side — grown by `bleed` px. The bleed keeps paint under the
// very edge of the piece (the sim blends a little across piece edges) and lets
// the two halves of a centre piece overlap by a hair instead of leaving a seam.
export function trimShape(r, x, y, bleed = 3) {
  let pts = regionOutline(r);
  const c = centerLine(r);
  if (c) {
    // keep the side of the centerline that (x, y) is on
    const nx = -c.dir.y, ny = c.dir.x;
    const side = (q) => (q.x - c.mid.x) * nx + (q.y - c.mid.y) * ny;
    const keep = side({ x, y }) >= 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const sp = side(p) * keep, sq = side(q) * keep;
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    if (out.length >= 3) pts = out;
  }
  return growOutline(pts, bleed).map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }));
}

// Panel names are lowercase letters, digits and _ only (left_door, rear_wing_2):
// a space or anything else becomes _. The id is made the same way.
export const cleanName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// An id made from a name, with _2, _3... added when the map already has it.
export function uniqueRegionId(name, map) {
  const base = cleanName(name) || 'region';
  const taken = new Set(map.regions.map(r => r.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

// Rename a region. Its id follows the new name (see uniqueRegionId), and a
// mirror partner pointing at the old id is repointed.
export function renameRegion(map, region, name) {
  if (!region.kind) name = cleanName(name) || region.name;
  const others = map.regions.filter(r => r !== region);
  const id = uniqueRegionId(name, { regions: others });
  for (const r of others) if (r.mirror === region.id) r.mirror = id;
  for (const l of map.links || []) for (const side of ['a', 'b']) if (l[side].region === region.id) l[side].region = id;
  for (const pl of map.places || []) for (const k of ['piece', 'at']) if (pl[k].region === region.id) pl[k].region = id;
  for (const cl of map.carLines || []) cl.regions = cl.regions.map(r => (r === region.id ? id : r));
  region.id = id;
  region.name = name;
  return region;
}

// what each mirrorKind looks like, for the panel settings
export const MIRROR_NAMES = { flip: 'Left/right', flipV: 'Top/bottom', rot180: 'Turned 180°', same: 'Same way' };

// Set how a pair lies on the sheet by hand, when the guess got it wrong. The
// twins of links on either panel are moved to match (each link made first
// keeps its place, its twin follows), and links that can now have a twin get
// one → how many twins were moved or added
export function setMirrorKind(map, region, kind) {
  const partner = region.mirror && regionById(map, region.mirror);
  if (!partner || !MIRROR_KINDS.includes(kind)) return 0;
  const on = (l) => [l.a.region, l.b.region].some(id => id === region.id || id === partner.id);
  const pairs = [], done = new Set();
  for (const l of map.links || []) {
    if (done.has(l) || !on(l)) continue;
    const t = twinOf(map, l); // found under the old kind, before it changes
    done.add(l);
    if (t) { done.add(t); pairs.push([l, t]); }
  }
  region.mirrorKind = partner.mirrorKind = kind;
  for (const [l, t] of pairs) syncTwin(map, l, t);
  return pairs.length + addTwins(map).length;
}

// Pair a region with its mirror partner on the other side of the car (or,
// with no partner id, unpair it). Pairs always point both ways, so whatever
// either region was paired with before is released. How the two lie on the
// sheet is recorded as their mirrorKind, guessed from their outlines.
export function setMirror(map, region, partnerId) {
  const partner = partnerId ? regionById(map, partnerId) : null;
  for (const r of [region, partner]) {
    if (!r) continue;
    const old = r.mirror && regionById(map, r.mirror);
    if (old && old.mirror === r.id) { delete old.mirror; delete old.mirrorKind; }
    delete r.mirror;
    delete r.mirrorKind;
  }
  if (partner && partner !== region) {
    region.mirror = partner.id;
    partner.mirror = region.id;
    region.mirrorKind = partner.mirrorKind = guessMirrorKind(region, partner);
    delete region.noPair; delete partner.noPair;
  }
}

// Twins the map could have but doesn't yet, for the Pair panels list to put to
// the user. Panels already paired, given a centreline (they are their own twin)
// or marked as having no pair are left out. Two panels are a candidate only at
// the same size, give or take 5%; how well one's outline lands on the other's,
// flipped the best way, is the fit (1: exactly, 0: off by a twentieth of their
// size on average). Each panel is suggested with the one it fits best, and only
// when that one fits it best back.
// → { pairs: [{ a, b, fit, exact, weak }] best first, none: [panels with no suggestion] }
// exact: the outlines match to under half a pixel (and 99%), with no other panel that close;
// weak: a loose fit, or another panel fits nearly as well.
export function suggestPairs(map) {
  const open = map.regions.filter(r => !r.kind && !r.mirror && !r.center && !r.noPair);
  const near = (p, q) => Math.abs(p - q) <= 0.05 * Math.max(p, q);
  const score = new Map(), best = new Map();
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    const a = open[i], b = open[j];
    if (!(near(a.w, b.w) && near(a.h, b.h)) && !(near(a.w, b.h) && near(a.h, b.w))) continue;
    const n = 2 * (regionOutline(a).length + regionOutline(b).length);
    const miss = mirrorMiss(a, b, guessMirrorKind(a, b)) / n; // on average, in px
    for (const [p, q] of [[a, b], [b, a]]) {
      const s = score.get(p) || [];
      s.push({ q, miss });
      score.set(p, s);
    }
  }
  for (const [p, s] of score) { s.sort((x, y) => x.miss - y.miss); best.set(p, s); }
  const pairs = [], paired = new Set();
  for (const a of open) {
    const s = best.get(a);
    if (!s || paired.has(a)) continue;
    const b = s[0].q, back = best.get(b);
    if (back[0].q !== a) continue;
    const size = (a.w + a.h + b.w + b.h) / 4, miss = s[0].miss;
    const fit = Math.max(0, 1 - miss / (0.05 * size));
    if (fit <= 0) continue;
    // the runner-up for either panel, as a share of this fit's miss
    const second = Math.min(s[1] ? s[1].miss : Infinity, back[1] ? back[1].miss : Infinity);
    const close = second < Math.max(miss * 1.5, miss + 0.5);
    pairs.push({ a, b, fit, exact: miss < 0.5 && fit >= 0.99 && !close, weak: fit < 0.8 || close });
    paired.add(a); paired.add(b);
  }
  pairs.sort((x, y) => y.fit - x.fit);
  return { pairs, none: open.filter(r => !paired.has(r)) };
}

// the region's shape as corners: its outline, or the four corners of its box
export function regionOutline(r) {
  return r.points || [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ];
}

// distance from (x, y) to the segment a-b
function segDist(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

// A test for spots near a stretch of a panel's edge (pts along it, from
// linkPoints): true when the straight way from the spot to the nearest point of
// the stretch stays inside the panel. Where a panel folds back close to itself,
// a band along one side of a slit stops at the slit instead of jumping across
// it; at a corner it still runs right into the corner. Only outline within
// `reach` px of the stretch is looked at.
export function nearestIsStretch(outline, stretch, reach) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of stretch) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const near = [];
  outline.forEach((b, i) => {
    const a = outline[(i || outline.length) - 1];
    if (Math.max(a.x, b.x) >= x0 - reach && Math.min(a.x, b.x) <= x1 + reach && Math.max(a.y, b.y) >= y0 - reach && Math.min(a.y, b.y) <= y1 + reach) near.push([a, b]);
  });
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const crosses = (p, q, a, b) => cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0;
  return (x, y) => {
    let best = null, bd = Infinity;
    for (let k = 1; k < stretch.length; k++) {
      const a = stretch[k - 1], b = stretch[k], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      const q = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best || bd < 0.5) return true;
    // stop half a px short of the edge, so the edge the point sits on doesn't count
    const p = { x, y }, q = { x: best.x + (x - best.x) * 0.5 / bd, y: best.y + (y - best.y) * 0.5 / bd };
    return !near.some(([a, b]) => crosses(p, q, a, b));
  };
}

// A point well inside the region to hang a label on, and how much room it has
// there (px to the nearest edge). Points inside any `avoid` region are skipped,
// so a label keeps clear of smaller regions sitting on top of this one.
// ponytail: best of a 24x24 grid over the box, not the true widest point —
// swap in a proper pole-of-inaccessibility search if labels land badly.
export function labelPoint(r, avoid = []) {
  const pts = regionOutline(r);
  const N = 24;
  let best = { x: r.x + r.w / 2, y: r.y + r.h / 2, room: 0 };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = r.x + (i + 0.5) * r.w / N, y = r.y + (j + 0.5) * r.h / N;
      if (!pointInPolygon(pts, x, y) || regionAt({ regions: avoid }, x, y)) continue;
      let room = Infinity;
      for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) room = Math.min(room, segDist(pts[m], pts[k], x, y));
      if (room > best.room) best = { x, y, room };
    }
  }
  return best;
}

// ---------- piece detection ----------
// A template's wireframe draws every piece of the sheet as its own connected
// network of lines, with clear space between pieces. So each connected network
// is one piece, and the outer edge of the network is the piece's outline.

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(a) / 2;
}

// Walk the outer edge of the 8-connected blob whose first pixel in scan order
// is (x0, y0), along pixel edges with the blob on the right. Returns the
// corners, clockwise on screen.
function traceOutline(mask, w, h, x0, y0) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // E S W N
  const RX = [0, -1, -1, 0], RY = [0, 0, -1, -1]; // pixel ahead-right of a corner, per heading
  const pts = [];
  let x = x0, y = y0, d = 0;
  do {
    x += DX[d]; y += DY[d];
    const l = (d + 3) % 4; // ahead-left is ahead-right of the heading one turn left
    const nd = at(x + RX[l], y + RY[l]) ? l : at(x + RX[d], y + RY[d]) ? d : (d + 1) % 4;
    if (nd !== d) pts.push({ x, y });
    d = nd;
  } while (x !== x0 || y !== y0 || d !== 0);
  return pts;
}

// Douglas-Peucker on a closed ring: drop corners that sit within `tol` pixels
// of the line between the corners kept either side.
export function simplifyOutline(pts, tol) {
  const n = pts.length;
  if (n < 4 || tol <= 0) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]]; // index n is pts[0] again, closing the ring
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b % n];
    let idx = -1, max = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(A, B, pts[i].x, pts[i].y);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// mask: w*h bytes, non-zero where the wireframe has a line. Returns one
// outline (array of { x, y }) per piece, largest first.
// minArea drops specks; tolerance is how far (px) a simplified outline may
// stray from the traced one — raise it for fewer points, lower for a closer fit.
export function detectPieces(mask, w, h, { minArea = 300, tolerance = 2 } = {}) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!mask[p0] || seen[p0]) continue;
    // flood the whole network so it is traced once, from its first pixel
    let n = 0;
    stack[n++] = p0; seen[p0] = 1;
    while (n) {
      const p = stack[--n], x = p % w, y = (p - x) / w;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[n++] = q; }
        }
      }
    }
    const x0 = p0 % w;
    const pts = simplifyOutline(traceOutline(mask, w, h, x0, (p0 - x0) / w), tolerance);
    const area = polygonArea(pts);
    if (pts.length >= 3 && area >= minArea) found.push({ pts, area });
  }
  return found.sort((a, b) => b.area - a.area).map(f => f.pts);
}

// a region map with one outlined region per detected piece, "Panel 1" being
// the largest — small pieces come last so they win the hover inside big ones
export function piecesRegionMap(car, outlines) {
  const map = createRegionMap(car);
  outlines.forEach((outline, i) => {
    const points = outline.map(q => ({ x: Math.round(q.x), y: Math.round(q.y) }));
    const xs = points.map(q => q.x), ys = points.map(q => q.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    map.regions.push({
      id: `piece_${i + 1}`, name: `panel_${i + 1}`, // the id keeps its old word: maps already saved use it
      x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, points,
    });
  });
  return map;
}

// ---------- seam links ----------
// A link says "this stretch of one region's edge meets that stretch of
// another's on the car": { a: { region, from, to }, b: { region, from, to } }.
// a.from meets b.from and a.to meets b.to; in between, equal fractions of the
// two stretches are taken to meet. Where the regions sit on the sheet, and how
// they are turned, does not matter. A long edge that meets two regions simply
// carries two links. A side may also say which way round the outline it runs
// from `from` to `to` (dir: 1 = the order the corners are listed, -1 = the
// other way); without it, the shorter way is meant.

// distance along the outline to each corner, plus the full way round
function arcs(pts) {
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

function atArc(pts, cum, s) {
  const L = cum[pts.length];
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < pts.length - 1 && cum[i + 1] < s) i++;
  const a = pts[i], b = pts[(i + 1) % pts.length], seg = cum[i + 1] - cum[i];
  const t = seg ? (s - cum[i]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The spot on the outline nearest (x, y): { x, y, s (distance along the
// outline), d (distance from the given point) }. A corner within `corner` px
// wins over the bare edge, so a click near a corner lands exactly on it.
export function snapToOutline(pts, x, y, corner = 0) {
  const cum = arcs(pts);
  let best = { d: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { x: px, y: py, s: cum[i] + t * Math.sqrt(len2), d };
  }
  let near = corner;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(x - pts[i].x, y - pts[i].y);
    if (d <= near) { near = d; best = { x: pts[i].x, y: pts[i].y, s: cum[i], d }; }
  }
  return best;
}

// The stretch of outline between the sharp corners (a turn of `deg` or more) either
// side of the spot nearest (x, y): { start, len } as distances round the outline,
// or null when there are no sharp corners. On a corner, `d`'s sign picks the side.
// Gentle bends don't count: a traced curve is lots of short straight bits.
export function edgeSpan(pts, x, y, d, deg = 45) {
  const cum = arcs(pts), L = cum[pts.length], s = snapToOutline(pts, x, y).s, n = pts.length;
  const cs = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, k = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (k && Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / k))) >= deg * Math.PI / 180) cs.push(cum[i]);
  }
  if (!cs.length) return null;
  const ahead = (u) => (u - s + L) % L, behind = (u) => (s - u + L) % L, eps = 1e-6;
  const at = cs.find((u) => ahead(u) < eps || ahead(u) > L - eps); // the corner s sits on, if any
  const others = cs.filter((u) => u !== at);
  const next = others.length ? others.reduce((p, u) => (ahead(u) < ahead(p) ? u : p)) : at;
  const prev = others.length ? others.reduce((p, u) => (behind(u) < behind(p) ? u : p)) : at;
  const [start, end] = at === undefined ? [prev, next] : d > 0 ? [at, next] : [prev, at];
  return { start, len: ((end - start) % L + L) % L || L };
}

// The spot `d` px further round the outline from the outline spot nearest (x, y);
// negative goes back. Kept inside `span` (from edgeSpan) when one is given.
export function slideAlong(pts, x, y, d, span = null) {
  const cum = arcs(pts), L = cum[pts.length], s = snapToOutline(pts, x, y).s;
  if (!span) return atArc(pts, cum, s + d);
  let u = ((s - span.start) % L + L) % L; // how far into the span s is
  if (L - u < 1e-6) u = 0;
  if (span.len === L && u < 1e-6 && d < 0) u = L; // the only corner: going back starts from its far side
  return atArc(pts, cum, span.start + Math.max(0, Math.min(span.len, u + d)));
}

// One side of a link as a run along its region's outline: where it starts,
// how long it is and which way round it goes. Null if the region is gone.
function linkStretch(map, link, side) {
  const region = regionById(map, link[side].region);
  if (!region) return null;
  const pts = regionOutline(region), cum = arcs(pts), L = cum[pts.length];
  const s0 = snapToOutline(pts, link[side].from.x, link[side].from.y).s;
  const s1 = snapToOutline(pts, link[side].to.x, link[side].to.y).s;
  const fwd = (s1 - s0 + L) % L;
  const dir = link[side].dir || (fwd <= L / 2 ? 1 : -1);
  return { pts, cum, L, start: s0, len: dir === 1 ? fwd : (L - fwd) % L, dir };
}

// Which way round its outline a link side currently runs (1 or -1). Storing
// this on the side as `dir` keeps it running that way while an end is moved,
// even once the stretch grows past half the outline.
export function linkDir(map, link, side) {
  const st = linkStretch(map, link, side);
  return st ? st.dir : 1;
}

// points along one side of a link from fraction t0 to t1 of its stretch,
// about every `step` px — for drawing it
export function linkPoints(map, link, side, t0 = 0, t1 = 1, step = 6) {
  const st = linkStretch(map, link, side);
  if (!st) return [];
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) * st.len / step));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(atArc(st.pts, st.cum, st.start + st.dir * st.len * (t0 + (t1 - t0) * k / n)));
  return out;
}

// length in px of the longer side of a link
export function linkLength(map, link) {
  const a = linkStretch(map, link, 'a'), b = linkStretch(map, link, 'b');
  return Math.max(a ? a.len : 0, b ? b.len : 0);
}

// The same link on the other side of the car: each side carried to its
// panel's twin (or, for a panel with no twin, across its own centreline) and
// landed on that panel's edge. Null when a side's panel has neither, or when
// the result is already in the map (a link that spans the centreline is its
// own twin).
export function twinLink(map, link) {
  const out = carriedLink(map, link);
  return out && !(map.links || []).some(l => sameLink(l, out, 2)) ? out : null;
}
// every link that has no twin yet but could have one now (after a pairing or a
// centreline is added) gets its twin → the twins added
export function addTwins(map) {
  const added = [];
  for (const l of [...(map.links || [])]) {
    const t = !twinOf(map, l) && twinLink(map, l);
    if (t) { map.links.push(t); added.push(t); }
  }
  return added;
}
// the link already in the map that is this one's twin (made with it, and maybe
// nudged a little since), or null
export function twinOf(map, link) {
  const out = carriedLink(map, link);
  return (out && (map.links || []).find(l => l !== link && sameLink(l, out, 30))) || null;
}
// after a link is edited: its twin (from twinOf, found before the edit) set to
// match it again, carried across the same way it was made → false if it can't be
export function syncTwin(map, link, twin) {
  const out = carriedLink(map, link);
  if (out) { twin.a = out.a; twin.b = out.b; }
  return !!out;
}
// the same two stretches, either way round, ends within tol px
function sameLink(l, o, tol) {
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < tol;
  const same = (s, t) => s.region === t.region && ((near(s.from, t.from) && near(s.to, t.to)) || (near(s.from, t.to) && near(s.to, t.from)));
  return (same(l.a, o.a) && same(l.b, o.b)) || (same(l.a, o.b) && same(l.b, o.a));
}
function carriedLink(map, link) {
  const out = {};
  for (const side of ['a', 'b']) {
    const src = regionById(map, link[side].region);
    const dst = src && (src.mirror ? regionById(map, src.mirror) : centerLine(src) ? src : null);
    if (!dst) return null;
    const kind = MIRROR_KINDS.includes(src.mirrorKind) ? src.mirrorKind : src.mirror && guessMirrorKind(src, dst);
    const pts = regionOutline(dst);
    const carry = (q) => {
      const p = src.mirror ? mirrorPointKind(src, dst, q.x, q.y, kind) : mirrorAcross(src, q.x, q.y);
      const s = snapToOutline(pts, p.x, p.y);
      return { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 };
    };
    const e = { region: dst.id, from: carry(link[side].from), to: carry(link[side].to) };
    if (Math.hypot(e.from.x - e.to.x, e.from.y - e.to.y) < 2) return null;
    // run round the outline the way that passes where the original's middle lands
    const mid = carry(linkPoints(map, link, side, 0.5, 0.5)[0]);
    const off = (dir) => { const q = linkPoints(map, { [side]: { ...e, dir } }, side, 0.5, 0.5)[0]; return Math.hypot(q.x - mid.x, q.y - mid.y); };
    e.dir = off(1) <= off(-1) ? 1 : -1;
    out[side] = e;
  }
  return out;
}

// Where does the spot at (x, y) meet the other piece? If (x, y) is within
// maxDist of a linked stretch, returns { index, side, t, at, partner } — `at`
// is the spot on that stretch, `partner` the spot it meets on the other side.
export function matchPoint(map, x, y, maxDist) {
  let best = null;
  (map.links || []).forEach((link, index) => {
    for (const side of ['a', 'b']) {
      const st = linkStretch(map, link, side);
      if (!st) continue;
      const p = snapToOutline(st.pts, x, y);
      if (p.d > maxDist || (best && p.d >= best.d)) continue;
      const along = st.dir === 1 ? (p.s - st.start + st.L) % st.L : (st.start - p.s + st.L) % st.L;
      if (along > st.len + 1e-6) continue;
      const other = linkStretch(map, link, side === 'a' ? 'b' : 'a');
      if (!other) continue;
      const t = st.len ? along / st.len : 0;
      best = {
        index, side, t, d: p.d, at: { x: p.x, y: p.y },
        partner: atArc(other.pts, other.cum, other.start + other.dir * other.len * t),
      };
    }
  });
  return best;
}

// The matrix { a, b, c, d, e, f } (a canvas transform) that lands p0 on q0
// and p1 on q1: turned and scaled to fit, after reflecting about the line
// p0-p1 when `reflect`. Null if either line has no length.
function fit(p0, p1, q0, q1, reflect) {
  const ux = p1.x - p0.x, uy = p1.y - p0.y, wx = q1.x - q0.x, wy = q1.y - q0.y;
  const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
  if (!lu || !lw) return null;
  // turn and scale this line onto the other...
  const k = lw / lu, cos = (ux * wx + uy * wy) / (lu * lw), sin = (ux * wy - uy * wx) / (lu * lw);
  let a = k * cos, c = -k * sin, b = k * sin, d = k * cos;
  if (reflect) {
    // ...after reflecting about this line itself
    const nx = ux / lu, ny = uy / lu, r00 = 2 * nx * nx - 1, r01 = 2 * nx * ny, r11 = 2 * ny * ny - 1;
    [a, c, b, d] = [a * r00 + c * r01, a * r01 + c * r11, b * r00 + d * r01, b * r01 + d * r11];
  }
  return { a, b, c, d, e: q0.x - (a * p0.x + c * p0.y), f: q0.y - (b * p0.x + d * p0.y) };
}

// which side of the line s-(s+v) a panel lies on (+1 / -1), judged from a point well inside it
const sideOf = (r, s, vx, vy) => { const c = labelPoint(r); return Math.sign(vx * (c.y - s.y) - vy * (c.x - s.x)) || 1; };
// which side of one side of a link its panel lies on, as the stretch runs (+1:
// to the left of the way it runs, as sideOf): tried just either side of the
// edge all along it, so a thin, curved or slit panel whose middle sits beyond
// the line between the stretch's ends is still read right
function sideAlong(map, link, side, r) {
  const pts = linkPoints(map, link, side, 0, 1, 3), out = regionOutline(r);
  let vote = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (!l) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -(b.y - a.y) / l * 1.5, ny = (b.x - a.x) / l * 1.5;
    vote += pointInPolygon(out, mx + nx, my + ny) - pointInPolygon(out, mx - nx, my - ny);
  }
  const end = pts[pts.length - 1];
  return Math.sign(vote) || (pts.length ? sideOf(r, pts[0], end.x - pts[0].x, end.y - pts[0].y) : 1);
}

// How the sheet beside one side of a link carries onto the other side,
// following the edge as it bends: the link cut into short stretches
// (about every 48 px), each carried by its own matrix onto the matching
// stretch of the other side, and kept to a strip running `depth` px into the
// other panel from that stretch: → [{ m, strip }]. Strips meet along lines
// square to the edge, so neighbours join up. (Paint that hangs past the
// link's ends, or deeper than `depth`, is not carried.)
// ponytail: on an edge that curves in tightly, strips deeper than its
// curve's radius overlap; shrink depth if that shows.
export function seamPieces(map, link, side, depth = 200) {
  const o = side === 'a' ? 'b' : 'a';
  const ra = regionById(map, link[side].region), rb = regionById(map, link[o].region);
  if (!ra || !rb) return [];
  const n = Math.max(1, Math.min(32, Math.round(linkLength(map, link) / 48)));
  const at = (sd, t) => linkPoints(map, link, sd, t, t)[0];
  const A = [], B = [];
  for (let k = 0; k <= n; k++) { A.push(at(side, k / n)); B.push(at(o, k / n)); }
  const p0 = A[0], p1 = A[n], q0 = B[0], q1 = B[n];
  if (!p0 || !q0) return [];
  const into = sideAlong(map, link, o, rb);
  const reflect = sideAlong(map, link, side, ra) === into;
  // into the other panel, square to its edge at each cut
  const normal = B.map((q, k) => {
    const s = B[Math.max(0, k - 1)], e = B[Math.min(n, k + 1)], tx = e.x - s.x, ty = e.y - s.y, l = Math.hypot(tx, ty) || 1;
    return { x: -ty / l * into, y: tx / l * into, tx: tx / l, ty: ty / l };
  });
  const out = [];
  for (let k = 0; k < n; k++) {
    const m = fit(A[k], A[k + 1], B[k], B[k + 1], reflect);
    if (!m) continue;
    // a hair wider along the edge, and a few px out past it, so neighbours and the edge leave no gap
    const u = normal[k], v = normal[k + 1];
    const s = { x: B[k].x - u.tx, y: B[k].y - u.ty }, e = { x: B[k + 1].x + v.tx, y: B[k + 1].y + v.ty };
    out.push({ m, strip: [
      { x: s.x - u.x * 4, y: s.y - u.y * 4 }, { x: e.x - v.x * 4, y: e.y - v.y * 4 },
      { x: e.x + v.x * depth, y: e.y + v.y * depth }, { x: s.x + u.x * depth, y: s.y + u.y * depth },
    ] });
  }
  return out;
}

// How the sheet round a placed piece's spot on the car lands on the piece
// itself: the line drawn on the other panel laid onto the line drawn along the
// piece (turned, scaled and moved to fit). Null if either line has no length.
// ponytail: never reflected; add a Flip if a piece turns out to lie mirrored on the sheet.
export function placeMatrix(place) {
  return fit(place.at.from, place.at.to, place.piece.from, place.piece.to, false);
}

// Where a car line puts the front and back of the car on the sheet: its line
// (from → to) runs from a to b along the car, so the whole car (0 → 1) spans
// p0 → p1. Null if the line or its stretch of the car has no length.
// The car lines with every paired panel's twin added: a panel with no line of
// its own whose pair (Map › Pair panels) has one takes that line, its arrow
// mirrored onto it. The twins are marked `twin` (and `of`, the index of
// the line they copy) and are not saved.
export function carLinesWithTwins(map) {
  const ls = (map && map.carLines) || [], lined = new Set(ls.flatMap(cl => cl.regions)), out = [...ls];
  ls.forEach((cl, of) => { for (const id of cl.regions) {
    const src = regionById(map, id), dst = src && src.mirror && regionById(map, src.mirror);
    if (!dst || lined.has(dst.id)) continue;
    const kind = MIRROR_KINDS.includes(src.mirrorKind) ? src.mirrorKind : guessMirrorKind(src, dst);
    const m = (q) => mirrorPointKind(src, dst, q.x, q.y, kind);
    out.push({ ...cl, regions: [dst.id], from: m(cl.from), to: m(cl.to), twin: true, of });
    lined.add(dst.id);
  } });
  return out;
}

export function carLineEnds(cl) {
  const d = cl.b - cl.a;
  if (Math.abs(d) < 1e-4 || (cl.from.x === cl.to.x && cl.from.y === cl.to.y)) return null;
  const at = (t) => ({ x: cl.from.x + (t - cl.a) / d * (cl.to.x - cl.from.x), y: cl.from.y + (t - cl.a) / d * (cl.to.y - cl.from.y) });
  return { p0: at(0), p1: at(1) };
}
