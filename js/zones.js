// Facts read from a kit's helper layers (see psd.js): the sponsor and number
// boxes, which boxes are twins, and which way up artwork reads in each, going
// by the stock decals.
//
// Pictures here are plain { width, height, data } RGBA objects, so the tests
// run under node with no canvas. Positions are pixels of the sheet.

import { uniqueRegionId } from './regions.js';

const midY = (r) => r.y + r.h / 2;

// ---------- blocks ----------

// The separate blocks of a picture: groups of pixels with alpha above thresh,
// touching side to side (not corner to corner). Each comes back as its box and
// pixel count, { x, y, w, h, area }, top to bottom, then left to right. Blocks
// under minArea pixels are dropped as crumbs.
export function alphaComponents(img, minArea = 300, thresh = 0) {
  const { width: W, height: H, data } = img;
  const solid = (i) => data[i * 4 + 3] > thresh;
  const done = new Uint8Array(W * H);
  const todo = [];
  const blocks = [];
  for (let first = 0; first < W * H; first++) {
    if (done[first] || !solid(first)) continue;
    const box = { left: W, top: H, right: -1, bottom: -1, area: 0 };
    done[first] = 1;
    todo.push(first);
    while (todo.length) {
      const i = todo.pop();
      const x = i % W, y = (i - x) / W;
      box.area++;
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
      const visit = (j) => { if (!done[j] && solid(j)) { done[j] = 1; todo.push(j); } };
      if (x > 0) visit(i - 1);
      if (x + 1 < W) visit(i + 1);
      if (y > 0) visit(i - W);
      if (y + 1 < H) visit(i + W);
    }
    if (box.area >= minArea) {
      blocks.push({ x: box.left, y: box.top, w: box.right - box.left + 1, h: box.bottom - box.top + 1, area: box.area });
    }
  }
  return blocks.sort((a, b) => a.y - b.y || a.x - b.x);
}

// ---------- twins ----------

// same column and same size, within tol
const lookAlike = (a, b, tol) => Math.abs(a.x - b.x) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

// twins: look alike and sit either side of the fold line `axis`, as far from it
const areTwins = (a, b, axis, tol) => lookAlike(a, b, tol) && Math.abs((midY(a) + midY(b)) / 2 - axis) <= tol;

// Where the sheet folds. Most kits fold at y = 1024, some elsewhere (the BMW
// M4 GT4 at about 766). Every pair of look-alike boxes votes for the line
// halfway between them; the line with most votes within tol wins, the one
// nearer `fallback` on a tie. It needs at least two votes to count, and a
// winner within tol of `fallback` is taken as `fallback` itself.
export function detectMirrorAxis(rects, { tol = 6, fallback = 1024 } = {}) {
  const votes = [];
  rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => {
    if (lookAlike(a, b, tol)) votes.push((midY(a) + midY(b)) / 2);
  }));
  let line = fallback, support = 0;
  for (const v of votes) {
    const n = votes.filter(o => Math.abs(o - v) <= tol).length;
    if (n > support || (n === support && Math.abs(v - fallback) < Math.abs(line - fallback))) { line = v; support = n; }
  }
  if (support < 2 || Math.abs(line - fallback) <= tol) return fallback;
  return Math.round(line);
}

// The twins among rects, as index pairs [i, j] with i < j. Each box is in one
// pair at most: the first twin found after it.
export function pairTwins(rects, axis, tol = 6) {
  const taken = new Set();
  const pairs = [];
  rects.forEach((a, i) => {
    if (taken.has(i)) return;
    const j = rects.findIndex((b, k) => k > i && !taken.has(k) && areTwins(a, b, axis, tol));
    if (j < 0) return;
    pairs.push([i, j]);
    taken.add(i).add(j);
  });
  return pairs;
}

// ---------- boxes as map regions ----------

// The kit's boxes ({ kind, x, y, w, h }) as regions for a map, top to bottom:
// ids sponsor_1, number_2..., names like "Sponsor 3 (349×93)", and twins
// paired as mirrors read top to bottom ('flipV') until the decals say
// otherwise (applyOrientation). `map` is only looked at so ids don't clash.
// → { regions, axis: the fold line used }
export function zonesToRegions(zones, map, { axis, tol = 6 } = {}) {
  const taken = { regions: [...(map?.regions ?? [])] };
  const counts = { sponsor: 0, number: 0 };
  const regions = [...zones].sort((a, b) => a.y - b.y || a.x - b.x).map((z) => {
    const n = counts[z.kind] = (counts[z.kind] ?? 0) + 1;
    const title = { sponsor: 'Sponsor', number: 'Number' }[z.kind] ?? 'Zone';
    const r = { id: uniqueRegionId(`${z.kind}_${n}`, taken), name: `${title} ${n} (${z.w}×${z.h})`, x: z.x, y: z.y, w: z.w, h: z.h, kind: z.kind, rot: 0 };
    taken.regions.push(r);
    return r;
  });
  const fold = Number.isFinite(axis) ? axis : detectMirrorAxis(regions, { tol });
  for (const [i, j] of pairTwins(regions, fold, tol)) {
    const a = regions[i], b = regions[j];
    a.mirror = b.id; b.mirror = a.id;
    a.mirrorKind = b.mirrorKind = 'flipV';
  }
  return { regions, axis: fold };
}

// ---------- which way the decals read ----------

// A box of an RGBA picture as brightness weighted by alpha: { w, h, data }.
export function blobGray(img, r) {
  const data = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const px = img.data;
    let i = ((r.y + y) * img.width + r.x) * 4;
    for (let x = 0; x < r.w; x++, i += 4) data[y * r.w + x] = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) * (px[i + 3] / 255);
  }
  return { w: r.w, h: r.h, data };
}

// How alike two grey blobs are, -1..1 (Pearson correlation), with A's pixels
// moved by from(x, y, w, h) → [x, y] first. Both are cut to the size they
// share, about their middles, so twins a pixel or two apart still line up.
function likeness(A, B, from) {
  const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h), n = w * h;
  const ax = (A.w - w) >> 1, ay = (A.h - h) >> 1, bx = (B.w - w) >> 1, by = (B.h - h) >> 1;
  const each = (fn) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [sx, sy] = from(x, y, w, h);
        fn(A.data[(ay + sy) * A.w + ax + sx], B.data[(by + y) * B.w + bx + x]);
      }
    }
  };
  let sumA = 0, sumB = 0;
  each((a, b) => { sumA += a; sumB += b; });
  const meanA = sumA / n, meanB = sumB / n;
  let cross = 0, varA = 0, varB = 0;
  each((a, b) => {
    const da = a - meanA, db = b - meanB;
    cross += da * db; varA += da * da; varB += db * db;
  });
  const scale = Math.sqrt(varA * varB);
  return scale > 0 ? cross / scale : 0;
}

// How blob B relates to blob A: kind 'rot180' (A turned half way round),
// 'flipV' (A mirrored top to bottom) or 'same' (an unturned copy), with each
// score and the margin the best leads the next by. Below about 0.1 the blob
// is too even to tell.
export function twinRelation(A, B) {
  const scores = {
    rot180: likeness(A, B, (x, y, w, h) => [w - 1 - x, h - 1 - y]),
    flipV: likeness(A, B, (x, y, w, h) => [x, h - 1 - y]),
    same: likeness(A, B, (x, y) => [x, y]),
  };
  const [[kind, best], [, next]] = Object.entries(scores).sort((p, q) => q[1] - p[1]);
  return { kind, margin: best - next, scores };
}

// The twin decals on the kit's stock-decal picture and how each pair reads:
// [{ a: the upper blob, b: the lower, kind, margin }], keeping only pairs
// read with a margin of at least minMargin. Decals are matched more loosely
// than boxes: relTol of their size, plus 4 px.
export function inferDecalPairs(img, { minArea = 400, axis = 1024, relTol = 0.15, minMargin = 0.1 } = {}) {
  const blobs = alphaComponents(img, minArea);
  const greys = new Map();
  const grey = (r) => greys.get(r) ?? greys.set(r, blobGray(img, r)).get(r);
  const pairs = [];
  blobs.forEach((a, i) => blobs.slice(i + 1).forEach((b) => {
    if (!areTwins(a, b, axis, relTol * Math.max(a.w, a.h) + 4)) return;
    const { kind, margin } = twinRelation(grey(a), grey(b));
    if (margin < minMargin) return;
    const [upper, lower] = midY(a) <= midY(b) ? [a, b] : [b, a];
    pairs.push({ a: upper, b: lower, kind, margin });
  }));
  return pairs;
}

// Each region takes the reading of the nearest decal pair, measured to that
// pair's decal on the region's own side of the fold. In a 'rot180' pair the
// upper region gets rot 180 and the lower keeps 0; a region with a twin gets
// mirrorKind 'rot180', 'same' or 'flipV' to match. A region across the fold
// (one in the middle of the car) is left as it is. Twins must agree: where
// they don't, both take the reading of the one nearer its decal.
// → how many regions changed
export function applyOrientation(regions, pairs, axis = 1024) {
  if (!pairs.length) return 0;
  const reads = new Map(); // region → { kind, dist, top }
  for (const r of regions) {
    const y = midY(r), x = r.x + r.w / 2;
    if (Math.abs(y - axis) < r.h / 2) continue;
    const top = y < axis;
    for (const p of pairs) {
      const d = top ? p.a : p.b;
      const dist = Math.hypot(d.x + d.w / 2 - x, midY(d) - y);
      if (!reads.has(r) || dist < reads.get(r).dist) reads.set(r, { kind: p.kind, dist, top });
    }
  }
  const byId = new Map(regions.map(r => [r.id, r]));
  for (const r of regions) {
    const twin = byId.get(r.mirror);
    const mine = reads.get(r), theirs = twin && reads.get(twin);
    if (!mine || !theirs || mine.kind === theirs.kind) continue;
    const kind = (mine.dist <= theirs.dist ? mine : theirs).kind;
    reads.set(r, { ...mine, kind });
    reads.set(twin, { ...theirs, kind });
  }
  let changed = 0;
  for (const [r, { kind, top }] of reads) {
    const rot = kind === 'rot180' && top ? 180 : 0;
    const mirrorKind = r.mirror ? ({ rot180: 'rot180', same: 'same' }[kind] ?? 'flipV') : null;
    if ((r.rot || 0) !== rot || (mirrorKind && r.mirrorKind !== mirrorKind)) changed++;
    r.rot = rot;
    if (mirrorKind) r.mirrorKind = mirrorKind;
  }
  return changed;
}
