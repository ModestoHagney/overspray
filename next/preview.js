// Overspray: the finish preview — a ball of the target's colour, lit by and
// mirroring a real 360° photo of a race track corner (Zwartkops, from Poly
// Haven, CC0), with any sparkle shown at its real grain.
//
// It is drawn from the same three numbers per pixel that go into the spec map
// (metallic, roughness, clearcoat), sampled from the engine's own texture when
// the finish has sparkle, so the preview and the file sent to the sim agree.
//
// The photo (track-corner.png) is 256 x 128, stored as two halves: the top is
// each pixel's colour, the bottom its brightness exponent (RGBE), so the sun
// can be thousands of times brighter than the sky. It is already turned so the
// sun is behind the viewer, up and to the left. Rough finishes look it up in
// blurred copies: 8 of them, about 3 MB, made once when the panel first opens.

import { SIZE, MATERIALS, paintSparkle, sparkleLights, resolveParams } from '../js/engine.js';
import { hexToRgb } from './picker.js';

const EW = 256, EH = 128, LV = 8;
let levels = null, loading = false, again = null; // again: the last draw, redone once the photo is in

// a sliding box blur, across (wrapping round) then down
function boxH(P, r) {
  const O = new Float32Array(P.length);
  for (let j = 0; j < EH; j++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += P[(j * EW + ((d + EW) % EW)) * 3 + c];
    for (let i = 0; i < EW; i++) {
      O[(j * EW + i) * 3 + c] = s / (2 * r + 1);
      s += P[(j * EW + ((i + r + 1) % EW)) * 3 + c] - P[(j * EW + ((i - r + EW) % EW)) * 3 + c];
    }
  }
  return O;
}
function boxV(P, r) {
  const O = new Float32Array(P.length), cl = (j) => Math.max(0, Math.min(EH - 1, j));
  for (let i = 0; i < EW; i++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += P[(cl(d) * EW + i) * 3 + c];
    for (let j = 0; j < EH; j++) {
      O[(j * EW + i) * 3 + c] = s / (2 * r + 1);
      s += P[(cl(j + r + 1) * EW + i) * 3 + c] - P[(cl(j - r) * EW + i) * 3 + c];
    }
  }
  return O;
}
function load() {
  loading = true;
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = EW; c.height = EH * 2;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0);
    const px = cx.getImageData(0, 0, EW, EH * 2).data, L = new Float32Array(EW * EH * 3);
    for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) {
      const o = (j * EW + i) * 4, x = 2 ** (px[o + EH * EW * 4] - 128) / 255;
      for (let k = 0; k < 3; k++) L[(j * EW + i) * 3 + k] = px[o + k] * x;
    }
    const lv = [L];
    for (let k = 1; k < LV; k++) {
      const r = Math.round(2 ** (k - 2) * 3) || 1;
      let P = lv[k - 1];
      for (let t = 0; t < 2; t++) P = boxV(boxH(P, r), r);
      lv.push(P);
    }
    levels = lv;
    if (again && again[0].isConnected) renderTile(...again);
  };
  im.onerror = () => { loading = false; };
  im.src = new URL('./track-corner.png', import.meta.url).href;
}
// the photo in direction d, blurred for a roughness of 0 to 1
function envAt(d, rough) {
  const az = Math.atan2(d[0], d[2]), el = Math.asin(Math.max(-1, Math.min(1, d[1])));
  const u = (az + Math.PI) / (2 * Math.PI) * EW - 0.5, v = Math.max(0, Math.min(EH - 1.001, (Math.PI / 2 - el) / Math.PI * EH - 0.5));
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const ia = (i0 + EW) % EW, ib = (i0 + 1 + EW) % EW, j1 = Math.min(EH - 1, j0 + 1);
  const f = Math.min(LV - 1, Math.sqrt(rough) * (LV - 1)), k = Math.floor(f), t = f - k, out = [0, 0, 0];
  for (const [L, w] of [[levels[k], 1 - t], [levels[Math.min(LV - 1, k + 1)], t]]) {
    if (!w) continue;
    for (let c = 0; c < 3; c++) out[c] += w * ((L[(j0 * EW + ia) * 3 + c] * (1 - fu) + L[(j0 * EW + ib) * 3 + c] * fu) * (1 - fv)
      + (L[(j1 * EW + ia) * 3 + c] * (1 - fu) + L[(j1 * EW + ib) * 3 + c] * fu) * fv);
  }
  return out;
}

// material + params: as the engine stamps them. colour: '#rrggbb', or a car
// gradient's stops ([{ at, color }], see engine.js carStops) laid left to right.
export function renderTile(canvas, material, params, colour) {
  again = [canvas, material, params, colour];
  if (!levels) { if (!loading) load(); return; } // drawn when the photo is in
  const W = canvas.width, Ht = canvas.height;
  const ctx = canvas.getContext('2d');
  const key = MATERIALS[material] ? material : 'gloss', p = resolveParams(key, params);
  // the spec values for every pixel of the canvas
  const sc = document.createElement('canvas');
  sc.width = W; sc.height = Ht;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
  sctx.fillRect(0, 0, W, Ht);
  if (MATERIALS[key].tex) paintSparkle(sctx, MATERIALS[key].tex, p, 0, 0, W, Ht); // a 1:1 crop: the grain at its real size
  const spec = sctx.getImageData(0, 0, W, Ht).data;
  const rgb = (c) => hexToRgb(c).map(v => v / 255);
  // the ball, centred, as tall as the canvas less a little room
  const R0 = Ht / 2 - 4, cx0 = W / 2, cy0 = Ht / 2, x0 = cx0 - R0;
  // the paint colour of each column of the ball
  const cols = Array.from({ length: W }, (_, x) => {
    if (!Array.isArray(colour)) return rgb(colour);
    const t = Math.max(0, Math.min(1, (x + 0.5 - x0) / (2 * R0))), s = colour, k = s.findIndex(o => o.at >= t);
    if (!s.length) return [0.6, 0.63, 0.67];
    if (k <= 0) return rgb(s[k < 0 ? s.length - 1 : 0].color);
    const a = s[k - 1], b = s[k], f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1, ca = rgb(a.color), cb = rgb(b.color);
    return ca.map((v, j) => v + (cb[j] - v) * f);
  });
  // Sparkle with Brightness: each fleck lightens the paint under it by this much (0 to 1), per pixel
  let lit = null;
  if (MATERIALS[key].tex && p.bright > 0) lit = sparkleLights(MATERIALS[key].tex, p); // by the pixel on the sheet: the canvas is its top left corner
  const out = ctx.createImageData(W, Ht), d = out.data;
  for (let y = 0; y < Ht; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const nx = (x + 0.5 - cx0) / R0, ny = -(y + 0.5 - cy0) / R0, rr = nx * nx + ny * ny, edge = (1 - Math.sqrt(rr)) * R0;
      if (edge < -0.5) continue; // outside the ball: left see-through
      const nz = Math.sqrt(Math.max(0, 1 - rr)), n = [nx, ny, nz];
      const metallic = spec[i] / 255, roughness = spec[i + 1] / 255, coat = 1 - spec[i + 2] / 255;
      const base = cols[x], lift = lit ? lit[y * SIZE + x] / 255 * p.bright / 100 : 0, alb = lift ? base.map(a => a + (1 - a) * lift) : base;
      // the light falling on it, and what it mirrors: straight back towards the viewer from the ball's middle
      const irr = envAt(n, 1), env = envAt([2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1], roughness);
      const fr = (1 - nz) ** 5, a = (0.04 + 0.96 * fr) * coat * (1 - roughness) ** 2; // the clear coat's own shine, stronger at the edge
      for (let k = 0; k < 3; k++) {
        const F0 = 0.04 * (1 - metallic) + alb[k] * metallic, F = F0 + (1 - F0) * fr;
        let v = (alb[k] * (1 - metallic) * irr[k] * 1.6 + env[k] * 1.5 * (1 - 0.85 * roughness) * F) * (1 - a) + env[k] * 1.5 * a;
        v = v / (1 + v * 0.5);
        d[i + k] = Math.min(1, Math.pow(v, 1 / 1.1) * 1.1) * 255;
      }
      d[i + 3] = 255 * Math.max(0, Math.min(1, edge + 0.5));
    }
  }
  ctx.putImageData(out, 0, 0);
}
