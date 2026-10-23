// A flat-colour picture (a logo, a badge) read into outlines: one set of
// closed pieces for each colour in it. Pure, no page: it runs under node --test.
//
// How: find the few colours the picture is made of; every pixel belongs to
// the one it is nearest to; the edge of each colour's area is then followed
// between the pixels, placed where the picture's own soft edge puts it, so a
// smooth edge in the picture is a smooth edge in the shape.

import { evenOddPieces, asOutline } from './svgpath.js';

const far = (px, o, c) => Math.hypot(px[o] - c[0], px[o + 1] - c[1], px[o + 2] - c[2]);
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// The colours a flat picture is made of, most used first: [[r, g, b], …].
// Only pixels with the same colour beside and below them are counted: the
// in-between colours along every edge are not colours of the picture.
// apart: how different two colours must be to count as two.
export function flatColours(px, w, h, { max = 8, apart = 40, least = 0.003 } = {}) {
  const { flat, colours } = flatCounts(px, w, h, { max, apart });
  return colours.filter((o) => o.n >= flat * least).map((o) => o.c);
}
// …with how many flat pixels each has: → { flat (all of them), colours: [{ c, n }] }
function flatCounts(px, w, h, { max = Infinity, apart = 40 } = {}) {
  const bins = new Map();
  let flat = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const o = (y * w + x) * 4, r = o + 4, d = o + w * 4;
    if (px[o + 3] < 250) continue;
    if (Math.abs(px[o] - px[r]) + Math.abs(px[o + 1] - px[r + 1]) + Math.abs(px[o + 2] - px[r + 2]) > 12) continue;
    if (Math.abs(px[o] - px[d]) + Math.abs(px[o + 1] - px[d + 1]) + Math.abs(px[o + 2] - px[d + 2]) > 12) continue;
    flat++;
    const k = (px[o] >> 3) << 10 | (px[o + 1] >> 3) << 5 | (px[o + 2] >> 3);
    let b = bins.get(k);
    if (!b) bins.set(k, b = [0, 0, 0, 0]);
    b[0] += px[o]; b[1] += px[o + 1]; b[2] += px[o + 2]; b[3]++;
  }
  const out = [];
  for (const b of [...bins.values()].sort((p, q) => q[3] - p[3])) {
    const c = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const near = out.find((o) => gap(o.c, c) < apart);
    if (near) near.n += b[3];
    else if (out.length < max) out.push({ c, n: b[3] });
  }
  return { flat, colours: out };
}
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The main colours of a livery's pictures, for the colour list: each one that
// covers `least` of the sheet (`total` pixels) or more, most used first, and
// none within `apart` of a colour in `have` ('#rrggbb'). A picture that is
// (nearly) all one colour gives that colour its name.
// samples: [{ name, px, w, h, weight }], weight: sheet pixels per sample pixel.
// → [{ name (or null), color: '#rrggbb' }]
export function paintColours(samples, { total, least = 0.005, apart = 40, have = [] } = {}) {
  const all = [];
  for (const s of samples) {
    const { flat, colours } = flatCounts(s.px, s.w, s.h, { apart });
    const one = colours.length && colours[0].n >= flat * 0.9;
    colours.forEach((o, i) => {
      const name = one && i === 0 ? s.name : null, near = all.find((a) => gap(a.c, o.c) < apart);
      if (near) { near.n += o.n * s.weight; near.name = near.name || name; } else all.push({ c: o.c, n: o.n * s.weight, name });
    });
  }
  const had = have.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return all.filter((a) => a.n >= total * least && !had.some((h) => gap(h, a.c) < apart))
    .sort((a, b) => b.n - a.n).map((a) => ({ name: a.name, color: hex(a.c) }));
}

// A spec map's finishes (its red, green and blue are metallic, roughness and
// clearcoat) as areas: `base` is its background's finish (the one in three
// corners) or else the most used, and each other finish comes with its outline
// as traceImage makes it. → { base: [r, g, b], areas: [{ rgb, pts }] }, or null with no flat finish
export function specAreas(px, w, h, { max = 12, apart = 16 } = {}) {
  const fs = flatColours(px, w, h, { max, apart });
  if (!fs.length) return null;
  const nearest = (o) => fs.reduce((b, c, i) => (far(px, o, c) < far(px, o, fs[b]) ? i : b), 0);
  const cs = [0, w - 1, w * (h - 1), w * h - 1].map((i) => nearest(i * 4));
  const base = fs[cs.find((c) => cs.filter((v) => v === c).length >= 3) ?? 0];
  const areas = traceImage(px, w, h, { max, apart }).filter((f) => f.color && f.color !== hex(base))
    .map((f) => ({ rgb: fs.find((c) => hex(c) === f.color), pts: f.pts }));
  return { base, areas };
}

// The closed lines round everything above `level` in a field of w × h values
// (one per pixel, taken at the pixel's middle). → [[{ x, y }, …], …] in pixel units.
export function contours(field, w, h, level = 0.5) {
  const W = w + 2, H = h + 2; // a ring of nothing round the picture, so a shape at its edge still closes
  const F = (i, j) => (i < 1 || j < 1 || i > w || j > h ? 0 : field[(j - 1) * w + (i - 1)]);
  const point = new Map(), links = new Map();
  const link = (a, b) => { (links.get(a) || links.set(a, []).get(a)).push(b); (links.get(b) || links.set(b, []).get(b)).push(a); };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = F(i, j), b = F(i + 1, j), c = F(i + 1, j + 1), d = F(i, j + 1);
    const kind = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if (kind === 0 || kind === 15) continue;
    // where the line crosses each side of this square of four pixels
    const T = 2 * (j * W + i), L = T + 1, B = 2 * ((j + 1) * W + i), R = 2 * (j * W + i + 1) + 1;
    const at = (id, x, y) => { if (!point.has(id)) point.set(id, { x: x - 0.5, y: y - 0.5 }); return id; };
    const top = () => at(T, i + (level - a) / (b - a), j), left = () => at(L, i, j + (level - a) / (d - a));
    const bottom = () => at(B, i + (level - d) / (c - d), j + 1), right = () => at(R, i + 1, j + (level - b) / (c - b));
    const mid = (a + b + c + d) / 4 > level; // two opposite corners in: joined through the middle, or apart?
    switch (kind) {
      case 1: case 14: link(left(), bottom()); break;
      case 2: case 13: link(bottom(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(top(), right()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(top(), left()); break;
      case 5: if (mid) { link(top(), left()); link(right(), bottom()); } else { link(top(), right()); link(left(), bottom()); } break;
      case 10: if (mid) { link(top(), right()); link(left(), bottom()); } else { link(top(), left()); link(right(), bottom()); } break;
    }
  }
  const loops = [], done = new Set();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !done.has(cur)) {
      done.add(cur); loop.push(point.get(cur));
      const [n0, n1] = links.get(cur), next = n0 !== prev && !done.has(n0) ? n0 : n1;
      prev = cur; cur = done.has(next) ? undefined : next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// A closed line with the points that add nothing taken out: none of what is
// left strays more than tol from the line as it was (Douglas-Peucker). The
// tol used is under a third of a pixel: any more and a square corner, which
// the line cuts half a pixel across, comes out slanted.
export function simplify(loop, tol = 0.3) {
  if (loop.length < 5) return loop;
  let far0 = 0, best = -1; // split the loop at its first point and the one farthest from it
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y); if (d > best) { best = d; far0 = i; } }
  const keep = new Uint8Array(loop.length + 1);
  const pts = [...loop, loop[0]];
  keep[0] = keep[far0] = keep[loop.length] = 1;
  const stack = [[0, far0], [far0, loop.length]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = pts[a], B = pts[b], dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return loop.filter((_, i) => keep[i]);
}

// A closed line with its pixel steps taken out. Each point is drawn towards
// its two neighbours and then pushed back out by a little more (Taubin's way
// of smoothing): drawing in alone would shrink every shape. The points of a
// line followed between pixels sit about a pixel apart, so this takes off
// wobble of a pixel or so and leaves the shape the size it was.
export function smooth(loop, rounds = 2) {
  let q = loop;
  const step = (k) => { q = q.map((p, i) => { const a = q[(i + q.length - 1) % q.length], b = q[(i + 1) % q.length]; return { x: p.x + k * ((a.x + b.x) / 2 - p.x), y: p.y + k * ((a.y + b.y) / 2 - p.y) }; }); };
  for (let n = 0; n < rounds; n++) { step(0.5); step(-0.53); }
  return q;
}

const area2 = (q) => q.reduce((s, a, i) => { const b = q[(i + 1) % q.length]; return s + a.x * b.y - b.x * a.y; }, 0);
const round = (v) => Math.round(v * 100) / 100;

// px: the picture's RGBA pixels, w × h.
// → [{ color: '#rrggbb', pts }], one for each colour: pts is an outline as the
// rest of the app has them (see shapes.js), a point marked `m` starting each
// further piece, holes turned the way that leaves them empty.
// A picture with a solid background and see-through cut-outs in it is a mask:
// the cut-outs are the artwork, and come back as one more entry with color: null.
// The colour in three or four of the picture's corners is its background: what of it reaches
// the picture's edge is left out, and what is shut inside a shape is kept.
export function traceImage(px, w, h, { tol = 0.3, max = 8, apart = 40 } = {}) {
  const colours = flatColours(px, w, h, { max, apart });
  if (!colours.length) return [];
  const n = w * h;
  // For every pixel: the colour it is nearest to, the runner-up, and how much
  // of the pixel is the first one's: 1 on that colour, 0.5 where the runner-up
  // is as near. The half mark then sits where the picture's own soft edge is
  // half way across. `solid` is how much of the pixel is there at all.
  const first = new Int8Array(n), next = new Int8Array(n), share = new Float32Array(n), solid = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let d0 = Infinity, d1 = Infinity, c0 = -1, c1 = -1;
    for (let c = 0; c < colours.length; c++) { const d = far(px, o, colours[c]); if (d < d0) { d1 = d0; c1 = c0; d0 = d; c0 = c; } else if (d < d1) { d1 = d; c1 = c; } }
    first[i] = c0; next[i] = c1; solid[i] = px[o + 3] / 255;
    share[i] = c1 < 0 ? 1 : d1 / ((d0 + d1) || 1);
  }
  const which = (i) => (solid[i] < 0.5 ? -1 : first[i]);
  // the background: the colour most of the four corners have, flooded in from the picture's edge
  const corners = [0, w - 1, n - w, n - 1].map(which).filter((c) => c >= 0);
  const tally = (c) => corners.filter((v) => v === c).length;
  const most = [...corners].sort((a, b) => tally(b) - tally(a))[0];
  const bg = corners.length && tally(most) >= 3 ? most : -1; // three corners alike, or there is no background
  const outside = new Uint8Array(n);
  if (bg >= 0) {
    const todo = [];
    const seed = (i) => { if (!outside[i] && which(i) === bg) { outside[i] = 1; todo.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed(n - w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (todo.length) {
      const i = todo.pop(), x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
  }
  const out = [];
  const field = new Float32Array(n);
  const pieced = (color) => {
    const pieces = contours(field, w, h).map((q) => simplify(smooth(q), tol)).filter((q) => {
      if (q.length < 3) return false;
      const a = Math.abs(area2(q)) / 2;
      const round0 = q.reduce((s, p, i) => { const b = q[(i + 1) % q.length]; return s + Math.hypot(b.x - p.x, b.y - p.y); }, 0);
      return a >= 4 && a / round0 >= 0.45; // not a speck, and not a sliver along an edge between two other colours
    });
    if (!pieces.length) return;
    const pts = asOutline(evenOddPieces(pieces)).map((p) => (p.m ? { x: round(p.x), y: round(p.y), m: true } : { x: round(p.x), y: round(p.y) }));
    out.push({ color, pts });
  };
  if (bg >= 0) { // what is cut out of a solid background
    let clear = 0;
    for (let i = 0; i < n; i++) { field[i] = 1 - solid[i]; if (solid[i] < 0.5) clear++; }
    if (clear >= n * 0.003) pieced(null);
  }
  for (let c = 0; c < colours.length; c++) {
    // how much of every pixel is this colour (the background's own colour only where it is shut inside a shape)
    let any = false;
    for (let i = 0; i < n; i++) {
      const v = c === bg && outside[i] ? 0 : first[i] === c ? share[i] * solid[i] : next[i] === c ? (1 - share[i]) * solid[i] : 0;
      field[i] = v;
      if (v > 0.5) any = true;
    }
    if (!any) continue;
    pieced(hex(colours[c]));
  }
  return out;
}
