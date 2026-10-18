// Overspray: the finish preview — a gently domed, rounded
// rectangle of the target's colour, lit so that gloss, matte, metallic and
// chrome read differently, with any sparkle shown at its real grain.
//
// It is drawn from the same three numbers per pixel that go into the spec map
// (metallic, roughness, clearcoat), sampled from the engine's own texture when
// the finish has sparkle, so the preview and the file sent to the sim agree.
// The shading is the original screen's shader ball, on a different shape, plus
// a soft horizon for metal to mirror.

import { MATERIALS, paintSparkle, sparkleLightCanvas, resolveParams } from '../js/engine.js';
import { hexToRgb } from './picker.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const L1 = norm([-0.5, -0.6, 0.62]);   // key light, upper left
const L2 = norm([0.45, 0.55, 0.35]);   // faint fill, lower right
const H = [L1, L2].map(l => norm([l[0], l[1], l[2] + 1])); // Blinn half vectors, view straight on

// material + params: as the engine stamps them. colour: '#rrggbb', or a car
// gradient's stops ([{ at, color }], see engine.js carStops) laid left to right.
export function renderTile(canvas, material, params, colour) {
  const W = canvas.width, Ht = canvas.height;
  const ctx = canvas.getContext('2d');
  const key = MATERIALS[material] ? material : 'gloss', p = resolveParams(key, params);
  // the spec values for every pixel of the tile
  const sc = document.createElement('canvas');
  sc.width = W; sc.height = Ht;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = `rgb(${p.met},${p.rough},${p.clear})`;
  sctx.fillRect(0, 0, W, Ht);
  if (MATERIALS[key].tex) paintSparkle(sctx, MATERIALS[key].tex, p, 0, 0, W, Ht); // a 1:1 crop: the grain at its real size
  const spec = sctx.getImageData(0, 0, W, Ht).data;
  const rgb = (c) => hexToRgb(c).map(v => v / 255);
  // the paint colour of each column of the tile
  const cols = Array.from({ length: W }, (_, x) => {
    if (!Array.isArray(colour)) return rgb(colour);
    const t = (x + 0.5) / W, s = colour, k = s.findIndex(o => o.at >= t);
    if (!s.length) return [0.6, 0.63, 0.67];
    if (k <= 0) return rgb(s[k < 0 ? s.length - 1 : 0].color);
    const a = s[k - 1], b = s[k], f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1, ca = rgb(a.color), cb = rgb(b.color);
    return ca.map((v, j) => v + (cb[j] - v) * f);
  });
  // Sparkle with Brightness: each fleck lightens the paint under it by this much (0 to 1), per pixel
  let lit = null;
  if (MATERIALS[key].tex && p.bright > 0) {
    sctx.clearRect(0, 0, W, Ht);
    sctx.drawImage(sparkleLightCanvas(MATERIALS[key].tex, p), 0, 0, W, Ht, 0, 0, W, Ht);
    lit = sctx.getImageData(0, 0, W, Ht).data;
  }
  const out = ctx.createImageData(W, Ht), d = out.data;
  const rad = Ht * 0.2; // corner radius
  for (let y = 0; y < Ht; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // rounded-rectangle edge, softened over a pixel
      const qx = Math.abs(x + 0.5 - W / 2) - (W / 2 - rad), qy = Math.abs(y + 0.5 - Ht / 2) - (Ht / 2 - rad);
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      if (dist > 0.5) { d[i + 3] = 0; continue; }
      // a shallow dome: the surface leans away towards every edge
      const nx = (x + 0.5 - W / 2) / (W / 2) * 0.62, ny = (y + 0.5 - Ht / 2) / (Ht / 2) * 0.62;
      const nz = Math.sqrt(1 - nx * nx - ny * ny);
      const metallic = spec[i] / 255, roughness = spec[i + 1] / 255, clearcoat = spec[i + 2] / 255;
      const base = cols[x], lift = lit ? lit[i + 3] / 255 * p.bright / 100 : 0, alb = lift ? base.map(a => a + (1 - a) * lift) : base;
      const shininess = 4 + 252 * (1 - roughness) * (1 - roughness);
      const specCol = alb.map(a => 1 + (a - 1) * metallic);
      let r = 0, g = 0, b = 0;
      [[L1, 0.7, 1.0], [L2, 0.18, 0.35]].forEach(([light, kDiff, kSpec], n) => {
        const ndl = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
        const ndh = Math.max(0, nx * H[n][0] + ny * H[n][1] + nz * H[n][2]);
        const specAmt = Math.pow(ndh, shininess) * (0.25 + clearcoat * 0.9 + metallic * 0.35) * kSpec;
        const diff = (0.22 + ndl * kDiff) * (1 - metallic * 0.55);
        r += alb[0] * diff + specCol[0] * specAmt;
        g += alb[1] * diff + specCol[1] * specAmt;
        b += alb[2] * diff + specCol[2] * specAmt;
      });
      // what metal mirrors: a bright sky above a dark ground, sharper the smoother the surface
      const up = -ny / 0.62, sharp = 1 - roughness;
      const sky = 0.5 + (Math.max(-1, Math.min(1, up * (1 + 5 * sharp))) * 0.5) * (0.35 + 0.65 * sharp);
      const env = sky * metallic * (0.35 + 0.65 * sharp) * 0.9;
      r += specCol[0] * env; g += specCol[1] * env; b += specCol[2] * env;
      d[i] = Math.min(255, (r / (1 + r * 0.12)) * 255);
      d[i + 1] = Math.min(255, (g / (1 + g * 0.12)) * 255);
      d[i + 2] = Math.min(255, (b / (1 + b * 0.12)) * 255);
      d[i + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - dist)));
    }
  }
  ctx.putImageData(out, 0, 0);
}
