// SVG path data read into this app's own outlines (see shapes.js): closed
// pieces of points, each point optionally carrying `c`, the quadratic bend
// handle of the line leaving it. Pure, no page: it runs under node --test.
//
// What an SVG path can hold that an outline here cannot is turned into what
// it can: a cubic curve becomes one or more quadratic ones, an arc becomes a
// run of them. An open piece is closed, as a fill closes it anyway.

import { pointInPolygon } from './regions.js';
import { flatten, reversed, lerp } from './shapes.js';

const same = (a, b, eps) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

// d: the path data. tol: how far a curve may stray from the original, in the
// path's own units (a 24-unit icon wants far less than a 512-unit one).
// closedOnly: leave out pieces that do not come back to where they began
// (a line drawing's open strokes: there is no inside to fill).
// → the pieces, each a list of points [{ x, y, c? }]
export function parsePath(d, tol = 0.25, { closedOnly = false } = {}) {
  const s = String(d || '');
  let i = 0;
  const skip = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  const num = () => {
    skip();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 40));
    if (!m) throw new Error('not a number at ' + i);
    i += m[0].length;
    return +m[0];
  };
  const flag = () => { // an arc's two flags may run straight into the next number: "0110" is 0, 1, 10
    skip();
    const ch = s[i++];
    if (ch !== '0' && ch !== '1') throw new Error('not a flag at ' + (i - 1));
    return ch === '1';
  };
  const more = () => { skip(); return i < s.length && /[\d.+-]/.test(s[i]); };

  const out = [];
  let cur = null, p = { x: 0, y: 0 }, start = { x: 0, y: 0 }, lastCtl = null, lastCmd = '';
  const open = () => { if (!cur) { cur = [{ x: start.x, y: start.y }]; p = { ...start }; } }; // a piece carried on after Z starts where that one did
  const shut = (byZ = false) => { if (cur) out.push({ pts: cur, byZ }); cur = null; };
  const line = (x, y) => { open(); cur.push({ x, y }); p = { x, y }; };
  const quad = (cx, cy, x, y) => { open(); cur[cur.length - 1].c = { x: cx, y: cy }; cur.push({ x, y }); p = { x, y }; };
  // a cubic as quadratics: one where that is close enough, else each half again
  const cubic = (p0, c1, c2, p3, depth = 0) => {
    const ex = p0.x - 3 * c1.x + 3 * c2.x - p3.x, ey = p0.y - 3 * c1.y + 3 * c2.y - p3.y;
    if (depth >= 4 || Math.hypot(ex, ey) * 0.0481 <= tol) { // √3/36: how far the one quadratic strays at most
      quad((3 * c1.x - p0.x + 3 * c2.x - p3.x) / 4, (3 * c1.y - p0.y + 3 * c2.y - p3.y) / 4, p3.x, p3.y);
      return;
    }
    const a = lerp(p0, c1, 0.5), b = lerp(c1, c2, 0.5), c = lerp(c2, p3, 0.5), ab = lerp(a, b, 0.5), bc = lerp(b, c, 0.5), mid = lerp(ab, bc, 0.5);
    cubic(p0, a, ab, mid, depth + 1);
    cubic(mid, bc, c, p3, depth + 1);
  };
  // an elliptical arc as quadratics, an eighth of a turn or less each
  const arc = (rx, ry, turn, large, sweep, x, y) => {
    const p0 = { ...p };
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry || same(p0, { x, y }, 1e-9)) { if (!same(p0, { x, y }, 1e-9)) line(x, y); return; }
    const phi = turn * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (p0.x - x) / 2, dy = (p0.y - y) / 2, x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
    const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (grow > 1) { rx *= Math.sqrt(grow); ry *= Math.sqrt(grow); } // too small to reach: scaled up until it does
    const k = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1))) * (large === sweep ? -1 : 1);
    const cxp = k * rx * y1 / ry, cyp = -k * ry * x1 / rx, cx = cos * cxp - sin * cyp + (p0.x + x) / 2, cy = sin * cxp + cos * cyp + (p0.y + y) / 2;
    const a0 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
    let da = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - a0;
    if (sweep && da < 0) da += 2 * Math.PI;
    if (!sweep && da > 0) da -= 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 4) - 1e-9)), step = da / n, reach = 1 / Math.cos(step / 2);
    const at = (a, r) => ({ x: cx + cos * rx * r * Math.cos(a) - sin * ry * r * Math.sin(a), y: cy + sin * rx * r * Math.cos(a) + cos * ry * r * Math.sin(a) });
    for (let j = 1; j <= n; j++) {
      const ctl = at(a0 + step * (j - 0.5), reach), end = j === n ? { x, y } : at(a0 + step * j, 1);
      quad(ctl.x, ctl.y, end.x, end.y);
    }
  };

  let cmd = '';
  while (true) {
    skip();
    if (i >= s.length) break;
    if (/[a-zA-Z]/.test(s[i])) cmd = s[i++];
    else if (!cmd) throw new Error('path data must start with a command');
    else if (cmd === 'M') cmd = 'L'; // more pairs after a move are lines
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? p.x : 0, oy = rel ? p.y : 0;
    if (C === 'Z') {
      if (cur) p = { ...cur[0] };
      shut(true);
      start = { ...p };
    } else if (C === 'M') {
      shut();
      const x = ox + num(), y = oy + num();
      start = { x, y }; p = { x, y }; cur = [{ x, y }];
    } else if (C === 'L') { const x = ox + num(), y = oy + num(); line(x, y); }
    else if (C === 'H') line(ox + num(), p.y);
    else if (C === 'V') line(p.x, oy + num());
    else if (C === 'Q') { const cx = ox + num(), cy = oy + num(), x = ox + num(), y = oy + num(); quad(cx, cy, x, y); lastCtl = { x: cx, y: cy }; }
    else if (C === 'T') {
      const ctl = lastCtl && /[QT]/i.test(lastCmd) ? { x: 2 * p.x - lastCtl.x, y: 2 * p.y - lastCtl.y } : { ...p };
      const x = ox + num(), y = oy + num();
      quad(ctl.x, ctl.y, x, y); lastCtl = ctl;
    } else if (C === 'C') {
      const c1 = { x: ox + num(), y: oy + num() }, c2 = { x: ox + num(), y: oy + num() }, end = { x: ox + num(), y: oy + num() };
      open(); cubic({ ...p }, c1, c2, end); lastCtl = c2;
    } else if (C === 'S') {
      const c1 = lastCtl && /[CS]/i.test(lastCmd) ? { x: 2 * p.x - lastCtl.x, y: 2 * p.y - lastCtl.y } : { ...p };
      const c2 = { x: ox + num(), y: oy + num() }, end = { x: ox + num(), y: oy + num() };
      open(); cubic({ ...p }, c1, c2, end); lastCtl = c2;
    } else if (C === 'A') {
      const rx = num(), ry = num(), turn = num(), large = flag(), sweep = flag(), x = ox + num(), y = oy + num();
      open(); arc(rx, ry, turn, large, sweep, x, y);
    } else throw new Error('unknown path command ' + cmd);
    lastCmd = cmd;
    if (C === 'Z' && more()) throw new Error('numbers after Z');
  }
  shut();

  const eps = tol / 100;
  return out.filter(({ pts, byZ }) => !closedOnly || byZ || (pts.length > 2 && same(pts[pts.length - 1], pts[0], eps))).map(({ pts: piece }) => {
    // points on top of the one before add nothing (a line of no length)
    let q = piece.filter((a, k) => k === 0 || a.c || piece[k - 1].c || !same(a, piece[k - 1], eps));
    // drawn back to where it began: that last point is the first one over again
    if (q.length > 1 && !q[q.length - 1].c && same(q[q.length - 1], q[0], eps)) q = q.slice(0, -1);
    // an outline here has three points at least: a lens of two bends gets one more on each
    for (let guard = 0; q.length < 3 && q.some(a => a.c) && guard < 3; guard++) {
      q = q.flatMap((a, k) => {
        if (!a.c) return [a];
        const b = q[(k + 1) % q.length], l = lerp(a, a.c, 0.5), r = lerp(a.c, b, 0.5);
        return [{ x: a.x, y: a.y, c: l }, { ...lerp(l, r, 0.5), c: r }];
      });
    }
    return q;
  }).filter(q => q.length >= 3);
}

// twice the signed area of an outline: which way round it runs
const area = (q) => { const f = flatten(q); return f.reduce((sum, a, k) => { const b = f[(k + 1) % f.length]; return sum + a.x * b.y - b.x * a.y; }, 0); };

// A shape drawn to the even-odd rule (a piece inside another is a hole, one
// inside that is solid again) made to fill the same under the non-zero rule
// this app draws by: each piece is turned to run the way its depth calls for.
export function evenOddPieces(pieces) {
  const flat = pieces.map(q => flatten(q));
  return pieces.map((q, k) => {
    // a spot just inside the piece's own first corner would be better; its first point does for outlines that do not touch
    const depth = flat.reduce((n, other, j) => n + (j !== k && pointInPolygon(other, q[0].x, q[0].y) ? 1 : 0), 0);
    return (area(q) > 0) === (depth % 2 === 0) ? q : reversed(q);
  });
}

// the pieces as one point list: each after the first marked as starting a new piece
export const asOutline = (pieces) => pieces.flatMap(q => q.map((a, k) => {
  const o = { x: a.x, y: a.y };
  if (a.c) o.c = { x: a.c.x, y: a.c.y };
  if (k === 0) o.m = true;
  return o;
})).map((a, k) => { if (k === 0) delete a.m; return a; });
