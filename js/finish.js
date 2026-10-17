// Finishes: how a painted surface looks (gloss, matte, chrome…), as opposed
// to its colour. iRacing reads them from the spec map; the engine stamps each
// layer's `material` into it. This file decides what that material is.
//
// A finish is set in one of three ways, the more specific winning:
//   an area   — a shape that paints nothing and only carries a finish
//               (a layer with specOnly), drawn on top;
//   a layer   — this layer's own finish (layer.finishOwn, layer.material);
//   a colour  — a rule, "everything this colour" (doc.finishRules). It
//               follows the colour: recolour a shape and its finish changes.
// Anything else is gloss. Pure: no canvas, runs under node --test.

import { MATERIALS, resolveParams } from './engine.js';

// The finishes offered, in the order shown. Each is a starting point: three
// numbers (metallic, roughness, clearcoat — the spec map's three channels)
// that the sliders then move. Sparkle is separate and sits on top of any of
// them: the engine's 'flake' (single-pixel specks) or 'glitter' (chips)
// texture, built round those same three numbers.
export const FINISHES = ['gloss', 'satin', 'matte', 'metallic', 'pearl', 'chrome'];
export const finishName = (key) => (MATERIALS[key] || MATERIALS.gloss).label;
// bright: how much each fleck also lightens the paint under it (0 = a fleck is finish only, and reads dark unless it catches the light)
export const SPARKLE = { amount: 18, size: 1, strength: 100, bright: 50 }; // what ticking Sparkle starts with

// A finish as the panel shows it, read from a material and its params:
// → { met, rough, clear, sparkle: null | { amount, size, strength } }
export function readFinish(material, params) {
  const key = MATERIALS[material] ? material : 'gloss', p = resolveParams(key, params);
  const sparkle = key === 'flake' ? { amount: p.density ?? 18, size: 1, strength: p.contrast ?? 100, bright: p.bright ?? 0 }
    : key === 'glitter' ? { amount: p.density ?? 30, size: Math.max(2, p.scale ?? 4), strength: p.contrast ?? 100, bright: p.bright ?? 0 }
    : null;
  return { met: p.met, rough: p.rough, clear: p.clear, sparkle };
}
// the preset whose three numbers these are, if any
export function presetOf(f) {
  return FINISHES.find(k => MATERIALS[k].met === f.met && MATERIALS[k].rough === f.rough && MATERIALS[k].clear === f.clear) || null;
}
// …and back: the material and params the engine stamps. `hint`: the finish it
// was before, kept as its name when the numbers have been moved off a preset.
export function writeFinish(f, hint = 'gloss') {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const base = { met: n(f.met, 0, 255), rough: n(f.rough, 0, 255), clear: n(f.clear, 0, 255) };
  if (f.sparkle) {
    const size = n(f.sparkle.size, 1, 12), amount = n(f.sparkle.amount, 1, 60), contrast = n(f.sparkle.strength, 0, 100), bright = n(f.sparkle.bright || 0, 0, 100);
    return size <= 1 ? { material: 'flake', params: { ...base, density: amount, contrast, bright } }
      : { material: 'glitter', params: { ...base, density: amount, scale: size, contrast, bright } };
  }
  const key = presetOf(base) || (FINISHES.includes(hint) ? hint : 'gloss');
  return { material: key, params: presetOf(base) ? null : base };
}
// what to call it: "Matte", "Matte + sparkle", "Custom"…
export function finishLabel(material, params) {
  const f = readFinish(material, params), key = presetOf(f);
  const name = key ? finishName(key) : 'Custom';
  return f.sparkle ? `${name} + sparkle` : name;
}

const hex = (c) => (typeof c === 'string' ? c.toLowerCase() : null);
// the one colour a layer is, if it has one (a picture only once it is given one)
export const layerColour = (l) => hex(l.type === 'fill' || l.type === 'image' ? l.color : l.type === 'text' ? l.textColor : null);
// every colour it paints: its own, and its Repeat's extra ones
export const layerColours = (l) => [...new Set([layerColour(l), ...((l.repeat && l.repeat.colors) || []).map(hex)])].filter(Boolean);
export const isArea = (l) => !!l && !!l.specOnly;
// a layer whose finish was set for itself
// a car gradient is many colours, so it always has one of its own
export const hasOwnFinish = (l) => !!l.finishOwn || !!l.car;

export function ruleFor(doc, colour) {
  const c = hex(colour);
  return (c && (doc.finishRules || []).find(r => r.color === c)) || null;
}

// a colour's rule as a finish, plain gloss without one
const specOf = (r) => r ? { material: r.material, params: r.params || null } : { material: 'gloss', params: null };

// the finish a layer ends up with: { material, params }
export function finishSpec(doc, layer) {
  if (isArea(layer) || hasOwnFinish(layer)) return { material: layer.material || 'gloss', params: layer.matParams || null };
  const r = ruleFor(doc, layerColour(layer));
  return specOf(r);
}
// a Repeat's copies in its extra colours take those colours' finishes:
// → [the layer's own, then one per extra colour], or null when all match
function copyFinishes(doc, l, own) {
  const cs = (l.repeat && l.repeat.colors) || [];
  if (!cs.length) return null;
  const fs = [own, ...cs.map((c) => { const r = ruleFor(doc, c); return specOf(r); })];
  const key = (f) => f.material + JSON.stringify(f.params);
  return fs.some(f => key(f) !== key(own)) ? fs : null;
}
export function baseSpec(doc) {
  if (doc.baseMaterial && doc.baseMaterial !== 'gloss') return { material: doc.baseMaterial, params: doc.baseMatParams || null };
  const r = ruleFor(doc, doc.baseColor);
  return specOf(r);
}

// The doc as it is painted and finished: each layer carrying the finish it
// ends up with. The doc itself is returned when there is nothing to change.
export function withFinishes(doc) {
  if (!(doc.finishRules || []).length) return doc;
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (isArea(l) || hasOwnFinish(l)) return l; // it already carries its own, copies and all
    const f = finishSpec(doc, l), copies = copyFinishes(doc, l, f);
    if (f.material === (l.material || 'gloss') && !f.params && !copies) return l;
    changed = true;
    return copies ? { ...l, material: f.material, matParams: f.params, copyFinishes: copies } : { ...l, material: f.material, matParams: f.params };
  });
  const base = baseSpec(doc), ownBase = doc.baseMaterial && doc.baseMaterial !== 'gloss';
  if (!changed && (ownBase || base.material === 'gloss')) return doc;
  return ownBase ? { ...doc, layers } : { ...doc, layers, baseMaterial: base.material, baseMatParams: base.params };
}

// "everything this colour is <material>". A colour set to plain gloss keeps
// its rule: it is something the user chose, and it stays in the Finishes list
// until they take it out (clearRule).
export function setRule(doc, colour, material, params = null) {
  const c = hex(colour);
  if (!c || !material) return;
  const rule = params ? { color: c, material, params: { ...params } } : { color: c, material };
  const at = (doc.finishRules || []).findIndex(r => r.color === c);
  if (at === -1) doc.finishRules = [...(doc.finishRules || []), rule];
  else doc.finishRules[at] = rule; // it keeps its place in the list
}
export function clearRule(doc, colour) {
  const c = hex(colour);
  doc.finishRules = (doc.finishRules || []).filter(r => r.color !== c);
}

// The Finishes list. Nothing is ever without a finish, so every colour in the
// livery is listed with the one it has (gloss until it is changed), then the
// layers given a finish of their own, then the areas.
// → [{ kind: 'colour', colour, material, params, used } | { kind: 'layer' | 'area', id, name, material, params }]
// `used`: how many layers (and the base coat) that colour is on. A rule for a
// colour no longer in the livery is kept, unlisted, in case the colour returns.
export function finishList(doc) {
  const used = new Map(); // colour → count, base coat first, then back to front
  const count = (c) => { if (c) used.set(c, (used.get(c) || 0) + 1); };
  count(hex(doc.baseColor));
  for (const l of doc.layers) if (l.visible !== false && !isArea(l) && !hasOwnFinish(l)) layerColours(l).forEach(count);
  const out = [];
  for (const [colour, n] of used) {
    const r = ruleFor(doc, colour);
    out.push({ kind: 'colour', colour, material: r ? r.material : 'gloss', params: (r && r.params) || null, used: n });
  }
  for (const l of doc.layers) {
    if (isArea(l)) out.push({ kind: 'area', id: l.id, name: l.name, material: l.material || 'gloss', params: l.matParams || null });
    else if (hasOwnFinish(l)) out.push({ kind: 'layer', id: l.id, name: l.name, material: l.material || 'gloss', params: l.matParams || null });
  }
  return out;
}
