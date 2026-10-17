// Free shapes: a closed outline of points in doc space, [{ x, y, c?, m? }].
// `c` on a point is the bend handle (quadratic control point) of the line that
// leaves it for the next point; without it that line is straight. `m` on a
// point starts a new, separate outline in the same shape (as "move to" does in
// a path), so one shape can be several pieces: what merging shapes makes.
// Each piece closes back on its own first point. The engine
// draws these as a fill layer with shape 'path' (see fillShapePath); this file
// is the geometry around them — pure, no canvas, so it runs under node --test.

import { pointInPolygon } from './regions.js';

export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// where each piece starts and stops in the list: [[start, end), …]
export function pieces(pts) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= pts.length; i++) if (i === pts.length || pts[i].m) { out.push([start, i]); start = i; }
  return out;
}
const pieceOf = (pts, i) => pieces(pts).find(([a, b]) => i >= a && i < b);
// the point the line leaving pts[i] runs to: the next one, or its piece's first
export function nextIndex(pts, i) {
  const [a, b] = pieceOf(pts, i);
  return i + 1 < b ? i + 1 : a;
}
const prevIndex = (pts, i) => { const [a, b] = pieceOf(pts, i); return i > a ? i - 1 : b - 1; };

// the point at t along the line leaving pts[i]
export function pointOn(pts, i, t) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  if (!a.c) return lerp(a, b, t);
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * a.c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * a.c.y + t * t * b.y };
}

// The outline as straight pieces: every point, plus `steps - 1` extra along
// each bent line. What hit-testing and bounds work from.
export function flatten(pts, steps = 12) {
  const out = [];
  pts.forEach((a, i) => {
    out.push({ x: a.x, y: a.y });
    if (a.c) for (let k = 1; k < steps; k++) out.push(pointOn(pts, i, k / steps));
  });
  return out;
}

// bounding box of what is actually drawn (a bend can bulge past its ends)
export function bounds(pts) {
  const f = flatten(pts);
  const xs = f.map(p => p.x), ys = f.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// each piece as its own straight-sided outline
export const outlines = (pts, steps = 12) => pieces(pts).map(([a, b]) => flatten(pts.slice(a, b).map((p, k) => (k ? p : { ...p, m: undefined })), steps));
// inside the shape as it is painted: a piece run the other way round (a ring's
// middle, a hollow shape's) is a hole in what is round it, as the canvas fills it
export const contains = (pts, x, y) => outlines(pts).reduce((n, o) => (pointInPolygon(o, x, y) ? n + (turn(o) < 0 ? -1 : 1) : n), 0) !== 0;

// every point (and bend handle) through f, keeping what else the point carries
export const mapped = (pts, f) => pts.map((p) => {
  const q = f(p);
  if (p.c) q.c = f(p.c);
  if (p.m) q.m = true;
  return q;
});
export const moved = (pts, dx, dy) => mapped(pts, p => ({ x: p.x + dx, y: p.y + dy }));

// Nearest spot on the outline to (x, y), if within `reach`.
// → { i, t, x, y, d }: on the line leaving pts[i], t of the way along it
export function segmentAt(pts, x, y, reach = Infinity, steps = 24) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const n = pts[i].c ? steps : 1; // a straight line is one piece
    let a = pointOn(pts, i, 0);
    for (let k = 1; k <= n; k++) {
      const b = pointOn(pts, i, k / n);
      const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
      const u = len2 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2)) : 0;
      const px = a.x + vx * u, py = a.y + vy * u, d = Math.hypot(x - px, y - py);
      if (d <= reach && (!best || d < best.d)) best = { i, t: (k - 1 + u) / n, x: px, y: py, d };
      a = b;
    }
  }
  return best;
}

// The dot shown half-way along the line leaving pts[i]; drag it to bend.
export const midOf = (pts, i) => pointOn(pts, i, 0.5);

// Bend the line leaving pts[i] so its half-way dot sits at m. Dropped within
// `slack` of the straight line's middle, the bend is removed again.
export function bendTo(pts, i, m, slack = 0) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  const mid = lerp(a, b, 0.5);
  const out = pts.map(p => ({ ...p }));
  if (Math.hypot(m.x - mid.x, m.y - mid.y) <= slack) delete out[i].c;
  else out[i].c = { x: 2 * m.x - mid.x, y: 2 * m.y - mid.y }; // B(0.5) = m
  return out;
}

// A new point at t along the line leaving pts[i]. A bent line is split into
// two bends that trace the same curve (de Casteljau).
export function insertAt(pts, i, t) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  const out = pts.map(p => ({ ...p }));
  const p = pointOn(pts, i, t);
  if (a.c) {
    out[i].c = lerp(a, a.c, t);
    p.c = lerp(a.c, b, t);
  }
  out.splice(i + 1, 0, p);
  return out;
}

// Remove pts[i]; the lines either side become one straight line. Never goes
// below a triangle.
export function removeAt(pts, i) {
  const [a, b] = pieceOf(pts, i);
  if (b - a <= 3) return pts; // its piece would stop being a shape
  const out = pts.map(p => ({ ...p }));
  delete out[prevIndex(pts, i)].c;
  if (out[i].m) out[i + 1].m = true; // the piece now starts at the next point
  out.splice(i, 1);
  return out;
}

// ---------- several shapes as one ----------

// twice the signed area of a piece's corners: its sign says which way round it runs
const turn = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0);
// the same outline, run the other way. A bend handle belongs to the line
// leaving its point, so each moves to the point at that line's other end.
export function reversed(pts) {
  const n = pts.length;
  return pts.map((_, j) => {
    const p = pts[(n - j) % n], before = pts[(n - j - 1 + n) % n]; // new point j is old point n-j; its line runs to old n-j-1
    const q = { x: p.x, y: p.y };
    if (before.c) q.c = { x: before.c.x, y: before.c.y };
    return q;
  });
}
// Outlines joined into one shape's point list. Every piece is made to run the
// same way round, so where two overlap they add up instead of cutting a hole.
export function joined(list) {
  const out = [];
  for (const pts of list) {
    const parts = pieces(pts).map(([a, b]) => pts.slice(a, b).map(p => (p.c ? { x: p.x, y: p.y, c: { ...p.c } } : { x: p.x, y: p.y })));
    // A shape is turned as a whole, by its biggest piece: a hole in it (a ring's
    // middle, run the other way round on purpose) then stays a hole.
    const turns = parts.map(q => turn(flatten(q))), lead = turns.reduce((m, t) => (Math.abs(t) > Math.abs(m) ? t : m), 0);
    for (let piece of parts) {
      if (lead < 0) piece = reversed(piece);
      if (out.length) piece[0].m = true;
      out.push(...piece);
    }
  }
  return out;
}

// The ready-made shapes, by the name each goes by on screen: the plain ones,
// then a round-cornered version of each one that has corners (see roundedOf).
// 'round' is the rounded box's name from before the others had one.
const PLAIN = {
  ellipse: 'Circle', rect: 'Square', triangle: 'Triangle', star: 'Star', diamond: 'Diamond', hexagon: 'Hexagon',
  chevron: 'Chevron', cross: 'Cross', arrow: 'Arrow', bolt: 'Lightning bolt', shield: 'Shield', flame: 'Flame', ring: 'Ring',
};
const NO_CORNERS = new Set(['ellipse', 'flame', 'ring']);
export const roundedOf = (shape) => (NO_CORNERS.has(shape) || !PLAIN[shape] ? null : shape === 'rect' ? 'round' : shape + '-r');
export const plainOf = (shape) => (shape === 'round' ? 'rect' : shape.endsWith('-r') ? shape.slice(0, -2) : null);
// and a hollow version of each one: only a band round its edge (a ring
// already is one; a flame's flick is too thin to have a middle to cut out)
const NO_HOLLOW = new Set(['ring', 'flame']);
export const hollowOf = (shape) => (PLAIN[shape] && !NO_HOLLOW.has(shape) ? shape + '-h' : null);
const solidOf = (shape) => (shape.endsWith('-h') && PLAIN[shape.slice(0, -2)] ? shape.slice(0, -2) : null);
// the ones offered to pick: the ring is left out, as the hollow circle is the
// same thing (a livery that already has one keeps it)
export const PLAIN_SHAPES = Object.keys(PLAIN).filter(k => k !== 'ring');
export const SHAPES = {
  ...PLAIN,
  ...Object.fromEntries(PLAIN_SHAPES.filter(roundedOf).map(k => [roundedOf(k), 'Rounded ' + PLAIN[k].toLowerCase()])),
  ...Object.fromEntries(PLAIN_SHAPES.filter(hollowOf).map(k => [hollowOf(k), 'Hollow ' + PLAIN[k].toLowerCase()])),
};
// corners of the straight-sided ones in a box 1 by 1
const ring = (n, r = () => 1, from = -Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = from + i * 2 * Math.PI / n;
  return [Math.cos(a) * r(i), Math.sin(a) * r(i)];
});
const boxed = (pts) => { // stretched to fill the box exactly
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return pts.map(p => [(p[0] - x) / (Math.max(...xs) - x), (p[1] - y) / (Math.max(...ys) - y)]);
};
const UNIT = {
  rect: [[0, 0], [1, 0], [1, 1], [0, 1]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  chevron: [[0, 0], [0.5, 0], [1, 0.5], [0.5, 1], [0, 1], [0.5, 0.5]],
  cross: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]].map(([a, b]) => [a / 3, b / 3]),
  hexagon: boxed(ring(6, () => 1, 0)),
  star: boxed(ring(10, i => (i % 2 ? 0.382 : 1))),
  arrow: [[0, 0.3], [0.55, 0.3], [0.55, 0], [1, 0.5], [0.55, 1], [0.55, 0.7], [0, 0.7]],
  bolt: boxed([[0.5, 0], [0.05, 0.58], [0.42, 0.58], [0.28, 1], [0.95, 0.38], [0.56, 0.38], [0.78, 0]]),
};
// the ones with bends: [x, y] or [x, y, bend x, bend y] (the handle of the line leaving the point), in a box 1 by 1
const CURVED = {
  shield: [[0, 0], [1, 0], [1, 0.5, 1, 0.88], [0.5, 1, 0, 0.88], [0, 0.5]],
  flame: [[0.6, 0, 0.56, 0.3], [0.86, 0.52, 1.04, 0.9], [0.5, 1, -0.04, 0.9], [0.14, 0.56, 0.2, 0.36], [0.36, 0.26, 0.38, 0.42], [0.47, 0.44, 0.38, 0.2]],
};
// height over width of the ones that are not as tall as wide when regular
const ASPECT = { hexagon: Math.sqrt(3) / 2, star: 0.951, arrow: 0.8, bolt: 1.45, shield: 1.15, flame: 1.35 };
export const aspect = (shape) => ASPECT[plainOf(shape) || solidOf(shape) || shape] || 1;
// how round a rounded corner is, as a share of the shape's shorter side
const ROUND = 0.12;
// how thick a hollow shape's band is, as a share of its shorter side
const HOLLOW = 0.1;

// The same outline with its corners rounded off by r. Only a corner between
// two straight lines is rounded; one next to a bend is left as it is.
export function rounded(pts, r) {
  const n = pts.length, out = [];
  pts.forEach((p, i) => {
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    if (prev.c || p.c) { out.push(p.c ? { x: p.x, y: p.y, c: { ...p.c } } : { x: p.x, y: p.y }); return; }
    // a point a little way down each line from the corner, never past its middle; the corner itself becomes the bend between them
    const along = (q) => { const len = Math.hypot(q.x - p.x, q.y - p.y) || 1, d = Math.min(r, len * 0.45) / len; return { x: p.x + (q.x - p.x) * d, y: p.y + (q.y - p.y) * d }; };
    out.push({ ...along(prev), c: { x: p.x, y: p.y } }, along(next));
  });
  return out;
}
// the outline moved and stretched so that what is drawn fills the box exactly
function fitted(pts, x, y, w, h) {
  const b = bounds(pts);
  return mapped(pts, p => ({ x: x + (p.x - b.x) / (b.w || 1) * w, y: y + (p.y - b.y) / (b.h || 1) * h }));
}

// a plain shape with its corners rounded by r, still filling its box
export const softened = (plain, x, y, w, h, r) => fitted(rounded(boxOutline(plain, x, y, w, h), r), x, y, w, h);

// The same outline moved in by t all round (bends taken in short straight
// steps). Each corner moves along the line halfway between its two sides, so
// every side keeps the same thickness t.
// ponytail: a part of the shape narrower than 2t folds over itself; fine at HOLLOW's thickness.
export function inset(pts, t) {
  const f = flatten(pts).filter((p, i, a) => { const q = a[(i + 1) % a.length]; return Math.hypot(q.x - p.x, q.y - p.y) > 1e-9; });
  const s = turn(f) < 0 ? -1 : 1, n = f.length; // which side is inside
  const normal = (a, b) => { const len = Math.hypot(b.x - a.x, b.y - a.y); return { x: -(b.y - a.y) / len * s, y: (b.x - a.x) / len * s }; };
  return f.map((p, i) => {
    const n1 = normal(f[(i - 1 + n) % n], p), n2 = normal(p, f[(i + 1) % n]);
    const k = t / Math.max(0.1, 1 + n1.x * n2.x + n1.y * n2.y); // a sharp corner moves further, so its sides stay t thick
    return { x: p.x + (n1.x + n2.x) * k, y: p.y + (n1.y + n2.y) * k };
  });
}
// a plain shape with its middle cut out, leaving a band t thick: the hole is a
// second piece run the other way round, as a ring's is
export function hollowed(plain, x, y, w, h, t) {
  const outer = boxOutline(plain, x, y, w, h), hole = reversed(inset(outer, t));
  hole[0].m = true;
  return [...outer, ...hole];
}

// a ready-made shape drawn in a box, as an outline: so it can join another,
// repeat, or simply be a shape of its own
export function boxOutline(shape, x, y, w, h) {
  const plain = plainOf(shape);
  if (plain) return softened(plain, x, y, w, h, Math.min(w, h) * ROUND);
  const solid = solidOf(shape);
  if (solid) return hollowed(solid, x, y, w, h, Math.min(w, h) * HOLLOW);
  if (UNIT[shape]) return UNIT[shape].map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
  if (CURVED[shape]) {
    return fitted(CURVED[shape].map(([u, v, cu, cv]) => (cu === undefined ? { x: u, y: v } : { x: u, y: v, c: { x: cu, y: cv } })), x, y, w, h);
  }
  // eight arcs: close enough to an ellipse that the eye cannot tell
  const cx = x + w / 2, cy = y + h / 2, k = 1 / Math.cos(Math.PI / 8);
  const oval = (rw, rh) => Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, m = a + Math.PI / 8;
    return { x: cx + Math.cos(a) * rw, y: cy + Math.sin(a) * rh, c: { x: cx + Math.cos(m) * k * rw, y: cy + Math.sin(m) * k * rh } };
  });
  if (shape === 'ring') {
    // the hole is a second piece run the other way round: where the two overlap they cancel
    const hole = reversed(oval(w * 0.29, h * 0.29));
    hole[0].m = true;
    return [...oval(w / 2, h / 2), ...hole];
  }
  if (shape === 'ellipse') return oval(w / 2, h / 2);
  return UNIT.rect.map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
}

// `to`, moved so the line from `from` runs at a multiple of `step` degrees
// (same length)
export function snapAngle(from, to, step = 45) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
  if (!len) return { x: to.x, y: to.y };
  const s = step * Math.PI / 180, a = Math.round(Math.atan2(dy, dx) / s) * s;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

// ---------- a shape repeated: Repeat's shapes and stamps ----------

// A motif is the shape that repeats: { kind } names a ready-made one, and
// { kind: 'own', pts, w, h } carries an outline of its own (a library shape).
// → its outline in its own box: { pts, w, h }
export function motifOutline(m) {
  if (m.kind === 'own') return { pts: m.pts, w: m.w, h: m.h };
  const h = aspect(m.kind);
  return { pts: boxOutline(m.kind, 0, 0, 1, h), w: 1, h };
}
// One copy as numbers [a, b, c, d, e, f] (a canvas matrix): its longer side
// `size`, turned `turn` degrees about its middle, its middle on (x, y).
export function placing(o, x, y, size, turn = 0) {
  const k = size / Math.max(o.w, o.h), t = turn * Math.PI / 180, a = k * Math.cos(t), b = k * Math.sin(t);
  return [a, b, -b, a, x - (a * o.w - b * o.h) / 2, y - (b * o.w + a * o.h) / 2];
}
const through = (f) => (p) => ({ x: f[0] * p.x + f[2] * p.y + f[4], y: f[1] * p.x + f[3] * p.y + f[5] });
// that copy as an outline on the sheet: what Stamp places. back: { x, y },
// turned over along its own across or down first (a Repeat's mirrored side)
export function placed(m, x, y, size, turn = 0, back = null) {
  const o = motifOutline(m);
  const pts = back && (back.x || back.y) ? mapped(o.pts, p => ({ x: back.x ? o.w - p.x : p.x, y: back.y ? o.h - p.y : p.y })) : o.pts;
  return mapped(pts, through(placing(o, x, y, size, turn)));
}

// ---------- holes ----------

// which pieces lie inside another piece of the same shape: a hole, or
// something drawn inside a hole (an outline-style icon is a thin ring: its
// outer edge, and its inner edge as a hole)
const innerPieces = (pts) => {
  const parts = pieces(pts), flat = parts.map(([a, b]) => flatten(pts.slice(a, b).map((p, k) => (k ? p : { ...p, m: undefined }))));
  return parts.map(([a], k) => flat.some((other, j) => j !== k && pointInPolygon(other, pts[a].x, pts[a].y)));
};
export const hasInner = (pts) => innerPieces(pts).some(Boolean);
// the shape filled in: only its outermost pieces, each one solid
export function outerOnly(pts) {
  const inner = innerPieces(pts), out = [];
  pieces(pts).forEach(([a, b], k) => {
    if (inner[k]) return;
    const piece = pts.slice(a, b).map(p => (p.c ? { x: p.x, y: p.y, c: { ...p.c } } : { x: p.x, y: p.y }));
    if (out.length) piece[0].m = true;
    out.push(...piece);
  });
  return out;
}

// ---------- wrap ----------

// One outline pulled tight round all the given ones, like a rubber band: two
// circles become a slot whose straight sides are tangent to both, a circle and
// a point a teardrop. (The hull of every outline, bends taken in short steps.)
// ponytail: where it follows a bend it is many short straight lines, close
// enough to round that the eye cannot tell; fit bends back if point counts matter.
export function wrapped(list, steps = 12) {
  const pts = list.flatMap(q => flatten(q, steps)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts.map(p => ({ x: p.x, y: p.y }));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (seq) => { // one side of the band: a point is dropped when the band would turn inward at it (or run straight through it)
    const h = [];
    for (const p of seq) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(pts), ...half([...pts].reverse())].map(p => ({ x: p.x, y: p.y }));
}
