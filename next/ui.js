// Overspray: everything around the canvas — menus, tool strip,
// the panel cards, dialogs, the right-click menu and the toast. It reads the
// app state and calls back into `actions`; it holds no livery state itself.

import { pieces, hue, pairList, PAIR_COLOURS } from './map.js';
import { SHAPES, PLAIN_SHAPES, roundedOf, plainOf, hollowOf, hollowed, softened, boxOutline, aspect, hasInner } from '../js/shapes.js';
import { TEXT_FONTS, GOOGLE_FONTS, fadeStyleOf, carStops } from '../js/engine.js';
import { FINISHES, finishName, finishLabel, finishList, layerColour, isArea, readFinish, presetOf } from '../js/finish.js';
import { MIRROR_NAMES } from '../js/regions.js';
import { renderTile } from './preview.js';
import { initPicker } from './picker.js';
import { carCss } from './cargrad.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const I = { // 20x20 line icons
  select: '<path d="M5 3v12l3.5-3 2.2 5 2-.9-2.2-5H15z"/>',
  pen: '<path d="M4 15 7 5l9 2-3 9z"/><circle cx="4" cy="15" r="1.4"/><circle cx="7" cy="5" r="1.4"/><circle cx="16" cy="7" r="1.4"/><circle cx="13" cy="16" r="1.4"/>',
  ellipse: '<circle cx="10" cy="10" r="6.5"/>',
  rect: '<rect x="4" y="4.5" width="12" height="11" rx="1"/>',
  triangle: '<path d="M10 4 17 16H3z"/>',
  star: '<path d="m10 3 2.1 4.6 5 .5-3.8 3.3 1.1 4.9L10 13.8l-4.4 2.5 1.1-4.9L2.9 8.1l5-.5z"/>',
  diamond: '<path d="M10 3 17 10 10 17 3 10z"/>',
  hexagon: '<path d="M6.5 4h7l3.5 6-3.5 6h-7L3 10z"/>',
  chevron: '<path d="M4 4h5l6 6-6 6H4l6-6z"/>',
  cross: '<path d="M8 3h4v5h5v4h-5v5H8v-5H3V8h5z"/>',
  round: '<rect x="3.5" y="4.5" width="13" height="11" rx="3.5"/>',
  // a rubber stamp: handle, neck, pad
  stamp: '<path d="M8 3.5h4v3.2l-1 3.3h4a1.5 1.5 0 0 1 1.5 1.5V13h-13v-1.5A1.5 1.5 0 0 1 5 10h4L8 6.7z"/><path d="M4 16.5h12"/>',
  edit: '<path d="M4 16h3l8-8-3-3-8 8z"/><path d="m11 6 3 3"/>',
  band: '<path d="M3 13 13 3M7 17 17 7"/>',
  text: '<path d="M4 5h12M10 5v11M8 16h4"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="m4 14 4-3.5 3 2.5 2-1.5 3 2.5"/>',
  // a tipped paint can with a drip
  piece: '<path d="M8.5 3.5 3.6 8.4a1.6 1.6 0 0 0 0 2.2l4.3 4.3a1.6 1.6 0 0 0 2.2 0l5.4-5.4z"/><path d="M6.2 5.8 9.6 2.4"/><path d="M4 9.6h10.6"/><path d="M16.6 12.6c.8 1.2 1.3 2 1.3 2.7a1.3 1.3 0 0 1-2.6 0c0-.7.5-1.5 1.3-2.7z"/>',
  mcentre: '<path d="M10 2v3M10 8v4M10 15v3"/><path d="M4 6h3M13 6h3M4 14h3M13 14h3"/>',
  // two panels either side of the car's middle
  mpair: '<rect x="2.5" y="5" width="5.5" height="10" rx="1"/><rect x="12" y="5" width="5.5" height="10" rx="1"/><path d="M10 3v2M10 9v2M10 15v2"/>',
  // two edges that meet: a link of chain
  mlink: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  // a loose piece and the spot it sits at
  mplace: '<rect x="2.5" y="11" width="6" height="6" rx="1"/><path d="M11 3h6v6h-6z" stroke-dasharray="2 2"/><path d="m7 9 4.5-4.5M8.5 4.5h3v3"/>',
  // a bar of colour blocks: one fade over the whole car
  // a toolbox: the car's own colours beyond the paint, such as the pit box's
  extras: '<rect x="3" y="7" width="14" height="9" rx="1.5"/><path d="M7.5 7V5h5v2M3 11h14"/>',
  cargrad: '<rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M6.5 6v8M9.5 6v8M11.5 6v8M12.8 6v8"/>',
  eye: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
  float: '<rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M8 16h8V8"/>',
  dock: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
  fold: '<path d="m5 8 5 5 5-5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  reset: '<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1"/><path d="M4 3.5v3.4h3.4"/>',
  // an open hand
  hand: '<path d="M7.2 10.5V5.2a1.15 1.15 0 0 1 2.3 0V9.4m0-.4V3.9a1.15 1.15 0 0 1 2.3 0V9m0 .2V4.9a1.15 1.15 0 0 1 2.3 0v5m0-1.6a1.15 1.15 0 0 1 2.3 0v3.9c0 3-1.9 4.8-4.8 4.8h-.9c-1.9 0-3-.8-4.1-2.5l-2.2-3.4a1.15 1.15 0 0 1 1.9-1.3l.9 1.2"/>',
};
I.mpick = I.select;
// an outline as SVG path data (a point marked `m` starts a separate piece)
function pathData(pts, f = (v) => v) {
  let start = 0;
  return pts.map((a, i) => {
    const head = !i || a.m ? ((start = i), `M${f(a.x)} ${f(a.y)}`) : '';
    const last = i + 1 === pts.length || !!pts[i + 1].m, b = pts[last ? start : i + 1];
    return head + (a.c ? `Q${f(a.c.x)} ${f(a.c.y)} ${f(b.x)} ${f(b.y)}` : `L${f(b.x)} ${f(b.y)}`) + (last ? 'Z' : '');
  }).join('');
}
// every ready-made shape that has no icon drawn by hand gets one from its own outline
for (const kind of Object.keys(SHAPES)) {
  if (I[kind]) continue;
  const a = aspect(kind), w = a > 1 ? 14 / a : 14, h = a > 1 ? 14 : 14 * a, x = 10 - w / 2, y = 10 - h / 2, f = (v) => +v.toFixed(2);
  // a rounded one is drawn rounder than it really is: at this size its true corners would not show
  // and a hollow one's band is drawn thicker, so its two edges stand apart
  const solid = PLAIN_SHAPES.find((k) => hollowOf(k) === kind);
  const pts = plainOf(kind) ? softened(plainOf(kind), x, y, w, h, 2.3) : solid ? hollowed(solid, x, y, w, h, 3) : boxOutline(kind, x, y, w, h);
  I[kind] = `<path d="${pathData(pts, f)}"/>`;
}
const svg = (name) => `<svg viewBox="0 0 20 20">${I[name]}</svg>`;
// a shape's own outline, drawn small: { pts, w, h } or a ready-made { shape, w, h }
const shapeSvg = (it) => {
  const pad = Math.max(it.w, it.h) * 0.06, box = `${-pad} ${-pad} ${it.w + 2 * pad} ${it.h + 2 * pad}`;
  let d;
  if (it.pts) d = pathData(it.pts);
  else if (it.shape === 'ellipse') d = `M0 ${it.h / 2}A${it.w / 2} ${it.h / 2} 0 1 0 ${it.w} ${it.h / 2}A${it.w / 2} ${it.h / 2} 0 1 0 0 ${it.h / 2}Z`;
  else if (it.shape === 'triangle') d = `M${it.w / 2} 0L${it.w} ${it.h}L0 ${it.h}Z`;
  else d = `M0 0H${it.w}V${it.h}H0Z`;
  return `<svg viewBox="${box}" aria-hidden="true"><path d="${d}" fill="currentColor" fill-rule="nonzero"/></svg>`;
};

// [id, name]
const TOOLS = [
  ['select', 'Select (V)'],
  ['hand', 'Hand (H)'],
  ['pen', 'Pen (P)'],
  ['shape', 'Shape (U)'],
  ['band', 'Band (B)'],
  ['stamp', 'Stamp (S)'],
  ['text', 'Text (T)'],
  ['image', 'Library'],
  ['piece', 'Fill panel (G). Shift+click adds to the same layer'],
  ['cargrad', 'New car gradient'],
  ['extras', 'Car extras: pit box, cockpit and pitboard'],
];
// Finish mode: the same drawing tools, but what they draw is an area
const FINISH_TOOLS = [
  ['select', 'Pick what to finish (V)'],
  ['hand', 'Hand (H)'],
  ['pen', 'Draw an area (P)'],
  ['shape', 'Area from a shape (U)'],
  ['piece', 'A whole panel (G). Shift+click adds to the same area'],
];
const MAP_TOOLS = [
  ['mpick', 'Select a panel: name it, set its twin'],
  ['hand', 'Hand (H)'],
  ['mcentre', 'Centreline: for a panel that crosses the middle (bonnet, roof)'],
  ['mpair', 'Pair panels: the left and right twins, so Mirrored paints both'],
  ['mlink', 'Link edges: where two panels meet, so paint carries across'],
  ['mplace', 'Place a piece: where a loose part (a wing, say) sits on the car'],
];
const PANELS = ['start', 'layers', 'props'];
const FINISH_TIPS = { gloss: 'Shiny clear coat, like new paint', satin: 'A soft sheen, between gloss and matte', matte: 'Flat, no shine', metallic: 'Shiny, with a metal glint', pearl: 'Metallic with a softer glow', chrome: 'A mirror: it reflects everything' };
const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi bold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
// A slider as one bar that fills up: its name inside on the left, its value
// on the right. Dragged anywhere along it (Shift: slowly), or clicked to type.
// The range input underneath holds the value and is what the panels listen to;
// it still takes the arrow keys.
const slider = (id, min, max, v, label, title = '') => {
  const n = Math.round(v);
  return `<div class="fillbar" style="--p:${((n - min) / (max - min)) * 100}%"${title ? ` title="${title}"` : ''}><input id="${id}" type="range" min="${min}" max="${max}" value="${n}" aria-label="${label}">` +
    `<span class="bname">${label}</span><input class="nbox" data-for="${id}" type="number" min="${min}" max="${max}" step="1" value="${n}" aria-label="${label}: exact value" tabindex="-1"></div>`;
};
const hexOf = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v).trim()) ? '#' + String(v).trim().replace('#', '').toLowerCase() : null);

export function initUI(app, actions, version) {
  const panels = {};
  for (const key of PANELS) {
    const p = document.createElement('section');
    p.className = 'panel';
    p.dataset.panel = key;
    p.innerHTML = `<header><h2></h2><button class="icon" data-p="float" title="Float" aria-label="Float">${svg('float')}</button><button class="icon" data-p="fold" title="Fold" aria-label="Fold">${svg('fold')}</button><button class="icon" data-p="close" title="Hide" aria-label="Hide">${svg('close')}</button></header><div class="body"></div>`;
    panels[key] = p;
    $('dock').append(p);
  }
  // Getting started: the few steps from nothing to the car in iRacing. Shown on
  // the first visit; Help > Getting started brings it back
  panels.start.querySelector('h2').textContent = 'Getting started';
  panels.start.querySelector('.body').innerHTML = '<ol class="steps">' +
    '<li>Load the car\'s template. <button class="link" data-act="pickTemplate">Load template…</button> or <button class="link" data-act="getTemplate">get one</button></li>' +
    '<li>Pick a colour in Properties, then click panels with Fill panel (G), or draw with Pen, Shape, Text and Library on the left.</li>' +
    '<li>Spec tab: click a colour and pick Gloss, Matte, Chrome…</li>' +
    '<li><button class="link" data-act="linkFolder">Link your iRacing paints folder</button>, then turn on Live: every change shows on the car in iRacing.</li>' +
    '</ol><div class="note">Mirrored paints both sides once the car has a map: Map tab, Browse maps. Hover a button to see what it does; the line at the bottom says how to use the tool you have. F1 lists the keys.</div>';
  // the Layers list is made taller or shorter by its bottom edge
  panels.layers.insertAdjacentHTML('beforeend', '<div class="grip" title="Drag to make the list taller or shorter" aria-hidden="true"></div>');
  panels.layers.lastChild.addEventListener('pointerdown', (e) => {
    const body = panels.layers.querySelector('.body'), y0 = e.clientY, h0 = body.offsetHeight;
    const most = $('stage').clientHeight - 200; // Properties keeps some room
    const move = (ev) => { body.style.maxHeight = Math.max(60, Math.min(most, h0 + ev.clientY - y0)) + 'px'; };
    e.target.setPointerCapture(e.pointerId);
    e.target.addEventListener('pointermove', move);
    e.target.addEventListener('pointerup', () => e.target.removeEventListener('pointermove', move), { once: true });
  });

  // ---------- menus ----------
  // [label, shortcut, action, { off, tick, tip }]
  const hasLayer = () => app.sel !== null && app.sel !== 'base' && !actions.swatchAt(app.sel);
  // what can be done to the selected shapes as shapes, and whether each applies now
  const shapeCan = () => {
    const ls = actions.selectedLayers(), fills = ls.filter((l) => l.type === 'fill' && !l.specOnly), one = ls.length === 1 ? ls[0] : null;
    const parts = one && Array.isArray(one.pts) && one.pts.some((q) => q.m);
    return { merge: ls.length > 1, wrap: fills.length > 0 && fills.length === ls.length, split: !!parts, fillIn: !!parts && hasInner(one.pts) };
  };
  const shapeItems = () => {
    const can = shapeCan();
    return [['Merge', 'Ctrl+E', 'merge', { off: !can.merge }], ['Wrap', '', 'wrap', { off: !can.wrap }], ['Split', '', 'split', { off: !can.split }], ['Fill in', '', 'fillIn', { off: !can.fillIn }]];
  };
  const layerItems = () => [
    ['Copy', 'Ctrl+C', 'copy', { off: !hasLayer() }], ['Paste', 'Ctrl+V', 'paste', { off: !app.clipboard }], ['Duplicate', 'Ctrl+D', 'duplicate', { off: !hasLayer() }], 0,
    ['Bring to front', 'Ctrl+Shift+]', 'front', { off: !hasLayer() }], ['Bring forward', 'Ctrl+]', 'forward', { off: !hasLayer() }],
    ['Send backward', 'Ctrl+[', 'backward', { off: !hasLayer() }], ['Send to back', 'Ctrl+Shift+[', 'back', { off: !hasLayer() }], 0,
    ['Save to library', '', 'saveShape', { off: (actions.selected() || {}).type !== 'fill' && actions.selectedLayers().length < 2 }],
    ['Export PNG', '', 'exportLayerPng', { off: !hasLayer() }],
    ...shapeItems(), 0,
    ['Mirrored', 'Ctrl+M', 'mirror', { off: !hasLayer(), tick: !!(actions.selected() || {}).mirrored }], ['Trim to panels', '', 'trim', { off: !hasLayer() }], 0,
    ['Delete', 'Del', 'remove', { off: !hasLayer() }],
  ];
  const menuDefs = () => ({
    File: [
      ['New', '', 'newLivery', { tip: 'Start an empty livery' }], ['Open…', '', 'open', { tip: 'A livery you saved in this browser' }], ['Save', 'Ctrl+S', 'save', { tip: 'Keep this livery in this browser' }], 0,
      ['Load template…', '', 'pickTemplate', { tip: "The car's template from Trading Paints (PSD is best): its panels and lines" }],
      ['Import paint…', '', 'pickPaint', { tip: 'A paint you already have (TGA, PNG, PSD or XCF), to change it here' }],
      ['Get a template…', '', 'getTemplate', { tip: "Where to download your car's template" }],
      ['Car setup…', '', 'carSetup', { tip: 'Your iRacing customer number and which car this is, for the paint file names' }],
      ['Livery colours…', '', 'liveryColours', { tip: 'Every colour in this livery, to change them in one go' }],
      ['Palettes…', '', 'openPalettes', { tip: 'Named colour sets you can keep and use again' }],
      ['Link iRacing paints folder…', '', 'linkFolder', { tip: 'Documents\\iRacing\\paint, so Save to iRacing and Live can write there' }],
      ['Save to iRacing', '', 'saveIracing', { tip: 'Writes the paint and spec map into the linked folder; iRacing shows it on the car' }], 0,
      ['Export TGA', '', 'exportTga', { tip: 'Download the paint as a TGA file, to copy into iRacing yourself' }],
      ['Export PNG', '', 'exportPng', { tip: 'Download the paint as a picture' }],
      ['Send to Trading Paints', '', 'sendTp', { tip: 'Upload it to Trading Paints so other drivers see it' }],
    ],
    Edit: [
      ['Undo', 'Ctrl+Z', 'undo', { off: !app.canUndo }], ['Redo', 'Ctrl+Y', 'redo', { off: !app.canRedo }], 0,
      ...layerItems(), 0,
      ['Select all', 'Ctrl+A', 'selectAll'], 0,
      ['Group', 'Ctrl+G', 'group', { off: actions.selectedLayers().length < 2 }],
      ['Ungroup', 'Ctrl+Shift+G', 'ungroup', { off: !actions.selectedLayers().some((l) => l.groupId) }],
    ],
    View: [
      ['Layers', '', 'show:layers', { tick: app.show.layers }], ['Properties', '', 'show:props', { tick: app.show.props }], 0,
      ['Panel colours on car', 'C', 'toggleGuide', { tick: actions.guideOn() }], ['Panel outlines', '', 'show:outlines', { tick: app.show.outlines }], ['Template lines', '', 'show:lines', { tick: app.show.lines }], ['Mesh', '', 'show:mesh', { tick: app.show.mesh }], 0,
      ['Light', '', 'theme:light', { tick: app.theme === 'light' }], ['Dark', '', 'theme:dark', { tick: app.theme === 'dark' }], ['Match system', '', 'theme:system', { tick: app.theme === 'system' }], 0,
      ['Fit to screen', 'F', 'fit'],
    ],
    Help: [['Getting started', '', 'show:start', { tick: app.show.start }], ['Keyboard shortcuts…', 'F1', 'shortcuts'], ['About…', '', 'about']],
  });
  const itemHtml = (it) => {
    if (!it) return '<hr>';
    const [label, key, act, o = {}] = it;
    const cls = 'tick' in o ? (o.tick ? 'tick' : 'notick') : '';
    return `<button data-act="${act}" class="${cls}"${o.off ? ' disabled' : ''}${o.tip ? ` title="${o.tip}"` : ''}><span>${label}</span><kbd>${key}</kbd></button>`;
  };
  function drawMenus() {
    const open = document.querySelector('.menu.open')?.dataset.menu;
    $('menus').innerHTML = Object.entries(menuDefs()).map(([name, items]) =>
      `<div class="menu${name === open ? ' open' : ''}" data-menu="${name}"><button aria-haspopup="true">${name}</button><div class="drop"${name === open ? '' : ' hidden'}>${items.map(itemHtml).join('')}</div></div>`).join('');
  }
  const closeMenus = () => document.querySelectorAll('.menu.open').forEach((m) => { m.classList.remove('open'); m.querySelector('.drop').hidden = true; });

  // ---------- the strip, modes, hint ----------
  function drawChrome() {
    drawMenus();
    $('modes').innerHTML = [['map', 'Map', 'Map: which panel is which, their twins and where they meet. Mirrored uses it'], ['paint', 'Paint', 'Paint: shapes, text and logos'], ['finish', 'Spec', 'Spec map: gloss, matte, chrome']].map(([id, name, tip]) =>
      `<button data-mode="${id}"${tip ? ` title="${tip}"` : ''} aria-pressed="${app.mode === id}">${name}</button>`).join('');
    // drawing a shape: text is a picture and there are no panels to fill, so those two tools are put away
    const strip = app.workshop ? TOOLS.filter(([id]) => id !== 'text' && id !== 'piece' && id !== 'hand' && id !== 'cargrad' && id !== 'extras') : app.mode === 'map' ? MAP_TOOLS : app.mode === 'finish' ? FINISH_TOOLS : TOOLS;
    $('tools').innerHTML = strip.map(([id, name]) =>
      `<button class="tool" data-tool="${id}" data-tip="${name}" aria-label="${name}" aria-pressed="${id === 'extras' ? !!actions.swatchAt(app.sel) : app.tool === id}">${svg(id === 'shape' ? app.shapeKind : id)}</button>`).join('');
    // the armed tool's own choices sit right beside the strip
    const opts = $('toolopts');
    if (app.tool === 'shape') {
      // the plain shapes in a row, under each one its round-cornered version,
      // and under that its hollow version (a gap where there is none)
      const pick = (k, up) => (k ? `<button class="tool${up ? ' up' : ''}" data-kind="${k}" data-tip="${SHAPES[k]}" aria-label="${SHAPES[k]}" aria-pressed="${app.shapeKind === k}">${svg(k)}</button>` : '<span></span>');
      opts.innerHTML = PLAIN_SHAPES.map((k) => pick(k, true)).join('') + PLAIN_SHAPES.map((k) => pick(roundedOf(k), false)).join('') + PLAIN_SHAPES.map((k) => pick(hollowOf(k), false)).join('');
      opts.style.gridTemplateColumns = `repeat(${PLAIN_SHAPES.length}, auto)`;
    } else if (app.tool === 'band') {
      opts.innerHTML = `<label class="optrow" title="How wide the band is, in pixels"><span>Width</span><input id="f-band" type="range" min="4" max="300" value="${app.bandWidth}"><output id="f-band-n" class="num">${app.bandWidth}</output></label>`;
    } else if (app.tool === 'stamp') {
      opts.innerHTML = `<label class="optrow" title="What each click stamps"><span>Shape</span><select id="f-stamp">${motifOptions(app.stamp.key)}</select></label>` +
        `<label class="optrow" title="How big each stamp is, in pixels"><span>Size</span><input id="f-stamp-size" type="range" min="10" max="600" value="${app.stamp.size}"><output id="f-stamp-n" class="num">${app.stamp.size}</output></label>`;
    }
    // drawing a shape: its window's own buttons follow what is selected
    if (app.workshop) { const can = shapeCan(); for (const k of ['wrap', 'split', 'fillIn']) $('sb-' + k).disabled = !can[k]; }
    opts.classList.toggle('rows', app.tool === 'stamp');
    opts.classList.toggle('grid', app.tool === 'shape');
    opts.hidden = app.tool !== 'shape' && app.tool !== 'band' && app.tool !== 'stamp';
    // level with the button it belongs to
    const btn = $('tools').querySelector('.tool[aria-pressed="true"]');
    if (btn && !opts.hidden) {
      const r = btn.getBoundingClientRect();
      opts.style.top = Math.max(4, r.top + r.height / 2 - $('stage').getBoundingClientRect().top - opts.offsetHeight / 2) + 'px';
    }
    $('hint').textContent = actions.hint();
    const live = $('btn-live');
    live.setAttribute('aria-pressed', app.live);
    const paused = app.live && app.liveBad;
    live.classList.toggle('bad', paused);
    live.innerHTML = `<i></i>${paused ? 'Live paused' : 'Live'}`;
    live.title = paused ? 'Click to reconnect to the iRacing paints folder' : 'Send every change to the car in iRacing';
    for (const key of PANELS) panels[key].hidden = !app.show[key];

    $('dock').hidden = ![...$('dock').children].some((p) => !p.hidden);
  }

  // ---------- panels ----------
  const swatch = (l) => {
    if (l.car) return `background:${carCss(l.car.blocks)}`;
    if (l.type === 'fill' && l.color) return `background:${esc(l.color)}`;
    // ponytail: the layer's own picture as the swatch; skip the very large ones
    if (l.src && l.src.length < 300000 && /^data:image\/[\w+.-]+;base64,[\w+/=]+$/.test(l.src)) return `background-image:url(${l.src})`;
    return 'background:var(--hover)';
  };
  // a group's own colour down the side of its rows: from its id, so it never changes
  const groupHue = (id) => hue([...String(id)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7));
  function layersHtml() {
    const d = app.doc;
    const picked = new Set(actions.selectedLayers().map((l) => l.id));
    const groups = new Map((d.groups || []).map((g) => [g.id, g]));
    const shown = [...d.layers].reverse().filter((l) => !isArea(l)); // an area is Finish mode's, and shows there
    const one = (l) => `<div class="row${picked.has(l.id) ? ' sel' : ''}${l.groupId ? ' grouped' : ''}" data-layer="${esc(l.id)}" draggable="true"${l.groupId ? ` style="--g:${groupHue(l.groupId)}" title="In a group"` : ''}><span class="sw" style="${swatch(l)}"></span><span class="name">${esc(l.name)}</span>${l.mirrored ? '<span class="tags"><i title="Mirrored">⇄</i></span>' : ''}<button class="rowx" data-del="${esc(l.id)}" title="Delete" aria-label="Delete ${esc(l.name)}">${svg('close')}</button><button class="eye${l.visible ? '' : ' off'}" data-eye="${esc(l.id)}" title="Show or hide" aria-label="Show or hide ${esc(l.name)}">${svg('eye')}</button></div>`;
    // A group is one row when it is folded: its name, its colours in the swatch,
    // and how many layers it holds. Unfolded, that row heads its layers.
    const head = (g, ms) => {
      const cols = [...new Set(ms.map((l) => layerColour(l)).filter(Boolean))].slice(0, 4), n = cols.length;
      const sw = n ? `background:linear-gradient(90deg, ${cols.map((c, i) => `${esc(c)} ${i / n * 100}% ${(i + 1) / n * 100}%`).join(', ')})` : swatch(ms[0]);
      const seen = ms.some((l) => l.visible), open = !g.collapsed;
      return `<div class="row grouped ghead${ms.some((l) => picked.has(l.id)) ? ' sel' : ''}" data-layer="${esc(ms[0].id)}" data-group="${esc(g.id)}" draggable="true" style="--g:${groupHue(g.id)}" title="A group of ${ms.length} layers. Double-click its name to rename it.">` +
        `<button class="twist" data-fold="${esc(g.id)}" aria-expanded="${open}" title="${open ? 'Fold it to one row' : 'Show its layers'}" aria-label="${open ? 'Fold' : 'Unfold'} ${esc(g.name)}">${open ? '▾' : '▸'}</button>` +
        `<span class="sw" style="${sw}"></span><span class="name">${esc(g.name)}</span><span class="count">${ms.length}</span>` +
        `<button class="rowx" data-delg="${esc(g.id)}" title="Delete the group and its layers" aria-label="Delete ${esc(g.name)}">${svg('close')}</button><button class="eye${seen ? '' : ' off'}" data-eyeg="${esc(g.id)}" title="Show or hide" aria-label="Show or hide ${esc(g.name)}">${svg('eye')}</button></div>`;
    };
    const rows = [], headed = new Set();
    for (const l of shown) {
      const g = l.groupId && groups.get(l.groupId);
      if (g && !headed.has(g.id)) { headed.add(g.id); rows.push(head(g, shown.filter((x) => x.groupId === g.id))); }
      if (!g || !g.collapsed) rows.push(one(l));
    }
    rows.push(`<div class="row${app.sel === 'base' ? ' sel' : ''}" data-layer="base"><span class="sw" style="background:${esc(d.baseColor)}"></span><span class="name">Base coat</span></div>`);
    return rows.join('');
  }
  const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
  // Across, or from the middle: which way the fade line runs. Shown with
  // the paint's fade.
  const fadeWay = (l) => `<div class="seg"><button data-fade="linear" aria-pressed="${fadeStyleOf(l) === 'linear'}">Across</button><button data-fade="radial" aria-pressed="${fadeStyleOf(l) === 'radial'}">From the middle</button></div>`;
  const aimNote = '<div class="note">Drag the two dots on the shape to aim it</div>';
  // A shape's paint can fade to a second colour, or to nothing.
  // `l`: the shape whose settings show (the first, when several are selected).
  function fadeHtml(l) {
    const fading = l.fillType === 'linear' || l.fillType === 'radial';
    const out = fading && typeof l.color2 === 'string' && l.color2.length === 9 && l.color2.endsWith('00');
    return `<label class="switch" title="The paint fades to a second colour, or to nothing">Fade<input id="f-fade" type="checkbox"${fading ? ' checked' : ''}></label>` + (!fading ? '' :
      fadeWay(l) +
      // the colours it passes through on the way, each placed along it
      (l.stops || []).map((o, k) => `<div class="with">${slider(`f-stop-${k}`, 1, 99, o.at * 100, `Colour ${k + 2}`, 'How far along the fade this colour sits')}<input id="f-stop-c${k}" data-fstop="${k}" type="color" value="${esc(hexOf(o.color) || '#ffffff')}" aria-label="Colour ${k + 2} of the fade"><button type="button" class="icon" data-fstopdrop="${k}" title="Take this colour out" aria-label="Take colour ${k + 2} out">${svg('close')}</button></div>`).join('') +
      ((l.stops || []).length < 8 ? '<div class="acts"><button class="btn" data-act="addFadeColour" title="Add a colour for the fade to pass through on the way">Add a colour</button></div>' : '') +
      field('Fades to', `<span class="pair"><input id="f-fade-to" type="color" value="${esc(out ? '#ffffff' : hexOf(l.color2 || '') || '#ffffff')}"${out ? ' disabled' : ''} aria-label="The colour it fades to"><label class="inline"><input id="f-fade-out" type="checkbox"${out ? ' checked' : ''}>Nothing</label></span>`) +
      aimNote);
  }
  // Repeat: the layer copied in a line, a grid, or scattered, from where it
  // is. `l`: the layer whose settings show (the first, when several are selected).
  function repeatHtml(l) {
    const r = l.repeat, way = r && r.way, grid = way === 'grid', scatter = way === 'scatter';
    const across = way === 'across' || grid, down = way === 'down' || grid;
    const out = (attr, k, what) => `<button type="button" class="mx" ${attr}="${k}" title="Take this ${what} out" aria-label="Take ${what} ${k + 2} out">${svg('close')}</button>`;
    const tile = (sh, k) => `<span class="mwrap"><span class="mtile" title="${esc(sh.kind === 'own' ? sh.name : SHAPES[sh.kind])}">${sh.kind === 'own' ? shapeSvg(sh) : svg(sh.kind)}</span>${out('data-repsdrop', k, 'shape')}</span>`;
    const several = r && (r.colors.length || r.shapes.length);
    // the layer's own colour and shape come first: changed or taken out like the others
    const ownColour = r ? hexOf(layerColour(l) || '') || '#ffffff' : '';
    const ownShape = !r || l.type !== 'fill' ? '' : l.shape === 'path' && Array.isArray(l.pts)
      ? shapeSvg({ pts: l.pts.map((q) => ({ x: q.x - l.rx, y: q.y - l.ry, ...(q.c ? { c: { x: q.c.x - l.rx, y: q.c.y - l.ry } } : {}), ...(q.m ? { m: true } : {}) })), w: l.rw, h: l.rh })
      : SHAPES[l.shape] ? svg(l.shape) : shapeSvg({ shape: l.shape, w: l.rw, h: l.rh });
    return fold('f-repfold', 'Repeat', `<label class="switch" title="Copies of this layer in a line, a grid, or scattered, starting from where it is. They follow every change to it.">Repeat<input id="f-rep-on" type="checkbox"${r ? ' checked' : ''}></label>` +
      (!r ? '' :
        field('Way', `<select id="f-rep-way">${[['across', 'Across'], ['down', 'Down'], ['grid', 'Grid'], ['scatter', 'Scatter']].map(([v, n]) => opt(v, n, v === way)).join('')}</select>`) +
        (scatter ?
          `<div class="note">Scattered over the panels it is trimmed to, or the whole sheet</div>` +
          slider('f-rep-count', 1, 500, r.count, 'Amount') +
          slider('f-rep-space', -400, 400, r.space, 'Space') :
          `<label class="switch" title="As many as reach the edge of the sheet. Trim it to keep them to a panel.">To the edge<input id="f-rep-fill" type="checkbox"${r.fill ? ' checked' : ''}></label>` +
          (r.fill ? '' : (across ? slider('f-rep-count', 1, 100, r.count, grid ? 'Across' : 'Copies') : '') +
            (down ? slider('f-rep-rows', 1, 100, r.rows, grid ? 'Down' : 'Copies') : '')) +
          (across ? slider('f-rep-gapX', -200, 400, r.gapX, grid ? 'Gap across' : 'Gap') : '') +
          (down ? slider('f-rep-gapY', -200, 400, r.gapY, grid ? 'Gap down' : 'Gap') : '') +
          slider('f-rep-angle', -180, 180, r.angle, 'Angle')) +
        // more colours, and for a shape more outlines: the copies take turns with the layer's own, or pick by their roll
        `<div class="field tiles"><span>Colours</span><span class="pair wrap">` +
          `<span class="mwrap"><input class="mini" data-repc="-1" id="f-rep-cown" type="color" value="${esc(ownColour)}" title="The layer's own colour: click to change it" aria-label="The layer's own colour">${r.colors.length ? out('data-repcdrop', -1, 'colour') : ''}</span>` +
          r.colors.map((c, k) => `<span class="mwrap"><input class="mini" data-repc="${k}" id="f-rep-c${k}" type="color" value="${esc(c)}" title="Click to change this colour" aria-label="Copy colour ${k + 2}">${out('data-repcdrop', k, 'colour')}</span>`).join('') +
          (r.colors.length < 6 ? `<button type="button" class="icon" data-act="addRepeatColour" title="Add a colour for the copies to take, along with the layer's own" aria-label="Add a colour for the copies">+</button>` : '') +
        '</span></div>' +
        (l.type !== 'fill' ? '' :
          `<div class="field tiles"><span>Shapes</span><span class="pair wrap"><span class="mwrap"><span class="mtile" title="The layer's own shape">${ownShape}</span>${r.shapes.length ? out('data-repsdrop', -1, 'shape') : ''}</span>${r.shapes.map(tile).join('')}` +
          (r.shapes.length < 6 ? `<span class="plusbox" title="Add a shape for the copies to take, along with this one"><span class="icon" aria-hidden="true">+</span><select id="f-rep-addshape" aria-label="Add a shape for the copies">${opt('', 'Add a shape…', true)}${motifOptions('', null)}</select></span>` : '') +
          '</span></div>') +
        (!several ? '' : field('Mix', `<select id="f-rep-mix">${opt('turn', 'In turn', r.mix === 'turn')}${opt('random', 'Random', r.mix === 'random')}</select>`)) +
        slider('f-rep-rSize', 0, 100, r.rSize, 'Random size') +
        slider('f-rep-rTurn', 0, 100, r.rTurn, 'Random turn') +
        `<div class="acts"><button class="btn" data-act="repeatReroll" title="Roll again"${scatter || r.rSize || r.rTurn || (several && r.mix === 'random') ? '' : ' disabled'}>Re-roll</button></div>` +
        `<label class="switch" title="The copies get fainter the further they are from the layer">Fade out<input id="f-rep-fadeOut" type="checkbox"${r.fadeOut ? ' checked' : ''}></label>` +
        `<label class="switch" title="The copies get smaller the further they are from the layer">Shrink<input id="f-rep-shrink" type="checkbox"${r.shrink ? ' checked' : ''}></label>`), r ? 'On' : 'Off');
  }
  // what a repeat's copies can take or a stamp place: the ready-made shapes,
  // then the library's. `current`: its key; `kept`: a shape of its own that
  // has since left the library, so the list can still name it.
  const motifOptions = (current, kept) => {
    const own = actions.ownShapes();
    const group = (label, keys) => section(label) + keys.filter(Boolean).map((k) => opt(k, SHAPES[k], k === current)).join('');
    return PLAIN_SHAPES.map((k) => opt(k, SHAPES[k], k === current)).join('') +
      group('Rounded', PLAIN_SHAPES.map(roundedOf)) + group('Hollow', PLAIN_SHAPES.map(hollowOf)) +
      (own.length || kept ? section('Your shapes') + own.map((it) => opt('own:' + it.id, it.name, 'own:' + it.id === current)).join('') + (kept && !own.some((it) => 'own:' + it.id === current) ? opt(current, kept, true) : '') : '');
  };
  // The top of Properties: the colour, big, and the name beside it; then the
  // colours the livery uses and has saved, to pick from, and an arrow that opens its saved
  // colours, two to a row. What is set to a saved colour follows it when it
  // is changed. `name`: the markup that goes beside the colour.
  function colourHead(name) {
    const d = app.doc, sel = actions.selected(), open = openFolds.has('f-saved');
    const pit = actions.swatchAt(app.sel), linked = app.sel === 'base' ? d.baseRef : pit ? pit.ref : sel ? sel.colorRef : null;
    const saved = d.palette.map((c) => `<span class="chipwrap"><button class="chip${c.id === linked ? ' on' : ''}" data-pal="${esc(c.id)}" title="${esc(c.name)} · ${esc(c.color.toUpperCase())}. Set to it, and it follows when this colour is changed. Right-click to rename or change."><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span></button><button class="chipedit" data-edit="${esc(c.id)}" title="Rename or change" aria-label="Edit ${esc(c.name)}">${svg('edit')}</button></span>`).join('');
    // the colour's name under the selection's: its saved colour's, or the next "Colour n"
    const cur = actions.currentColour(), named = d.palette.find((c) => c.id === linked) || d.palette.find((c) => c.color === cur);
    const cname = `<input id="f-cname" class="cname" type="text" maxlength="40" value="${esc(named ? named.name : 'Colour ' + (d.palette.length + 1))}" title="Click to name this colour. A named colour is saved, and everything set to it changes with it." aria-label="Colour name">`;
    return `<div class="phead"><input data-colour="pick" id="c-pick" type="color" value="${esc(cur)}" title="Choose a colour" aria-label="Colour"><span class="pnames">${name}${cname}</span></div>` +
      `<div class="chips">${[...new Set([...usedColours(), ...d.palette.map((c) => c.color)])].map((c) => `<button class="dot" data-col="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="${c}"></button>`).join('')}` +
      `<button class="savedarrow" data-savedfold aria-expanded="${open}" title="Saved colours${d.palette.length ? ' · ' + d.palette.length : ''}" aria-label="Saved colours">${open ? '▾' : '▸'}</button></div>` +
      (!open ? '' : (saved ? `<div class="saved">${saved}</div>` : '') +
        '<div class="acts"><button class="btn" data-act="saveColour" title="Save the current colour with this livery, and set what is selected to it">Save colour</button><button class="btn" data-act="liveryColours" title="Name and change every colour in the livery, everywhere it is used (File › Livery colours)">Edit colours</button></div>');
  }
  // Place, Look and Repeat fold away, and only one is open at a time (the
  // browser closes the others: they share a name). An empty one is left out.
  // a fold opens and closes by itself; `state`: a word shown on its title, such as On or Off
  const fold = (id, title, body, state = '') => (!body ? '' : `<details class="more fold" id="${id}"${openFolds.has(id) ? ' open' : ''}><summary>${title}<span class="st">${state}</span></summary>${body}</details>`);
  // where the selection's top-left corner is on the sheet, typed to move it there
  const posBoxes = () => {
    const at = actions.selCorner();
    const box = (k, v) => `<label class="field"><span>${k.toUpperCase()}</span><input id="f-pos-${k}" class="num" type="number" step="1" value="${v}"></label>`;
    return !at ? '' : `<div class="two" title="Where its top-left corner is on the sheet, in pixels. Type a number to move it there.">${box('x', at.x)}${box('y', at.y)}</div>`;
  };
  const mirroredBtn = (on) => `<button class="btn" data-act="mirror" aria-pressed="${!!on}" title="Paint it on the twin panel too, or across the centreline (Ctrl+M)">Mirrored</button>`;
  function propsHtml() {
    if (app.sel === 'base') return colourHead('<span class="pname">Base coat</span>');
    if (actions.swatchAt(app.sel)) { // Car extras: the pit box, cockpit and pitboard colours, one at a time
      const all = app.doc.swatches, board = !!actions.swatchAt(app.sel).points;
      return colourHead(`<span class="pname">${esc(actions.swatchAt(app.sel).name)}</span>`) +
        (all.length < 2 ? '' : `<div class="seg">${all.map((p, i) => `<button data-swpick="sw${i}" aria-pressed="${app.sel === 'sw' + i}">${esc(p.name)}</button>`).join('')}</div>`) +
        (board ? '<div class="note">The board\'s background. Anything you add now (a logo, text, a shape) stays inside the board.</div>'
          : '<div class="note">iRacing colours these parts from small squares on the sheet. Flat colours only: a fade there just blends or makes patterns.</div>');
    }
    const many = actions.selectedLayers();
    if (many.length > 1) { // several: what can be done to them together
      const grouped = many.some((x) => x.groupId);
      const fills = many.filter((x) => x.type === 'fill' && !x.specOnly);
      const l0 = many.find((x) => x.id === app.sel) || many[0], turn = actions.manyTurn(); // null: nothing among them can turn
      return colourHead(`<span class="pname">${many.length} layers</span>`) +
        fold('f-place', 'Place', posBoxes() + (turn === null ? '' : slider('f-turn', -180, 180, turn, 'Turn', 'They turn as one, about their middle. A group keeps its angle; a loose selection starts at 0 each time.')) +
          `<label class="switch" title="Where they hang over an edge linked in Map, they carry on onto the panel that edge meets. A piece placed over their panel in Map shows them too">Continue across edges<input id="f-continues" type="checkbox"${many.some((x) => x.continues) ? ' checked' : ''}></label>` +
          `<div class="acts">${trimButtons(l0)}${mirroredBtn(many.some((x) => x.mirrored))}${trimClear(many.find((x) => trimCount(x)) || l0)}</div>`) +
        fold('f-look', 'Look', (fills.length ? fadeHtml(fills.find((x) => x.fillType === 'linear' || x.fillType === 'radial') || fills[0]) : '') +
          slider('f-opacity', 0, 100, (l0.opacity ?? 1) * 100, 'Opacity') +
          field('Blend', `<select id="f-blend" title="Multiply darkens what is under it, for a texture such as worn cardboard">${opt('', 'Normal', !l0.blend)}${opt('multiply', 'Multiply', l0.blend === 'multiply')}</select>`)) +
        repeatHtml(many.find((x) => x.repeat) || many[0]) +
        `<div class="acts"><button class="btn" data-act="merge" title="Join them into one. It asks first if they differ in colour or kind. (Ctrl+E)">Merge</button>` +
        `<button class="btn" data-act="wrap" title="One shape pulled tight round them, like a rubber band: two circles become a slot"${shapeCan().wrap ? '' : ' disabled'}>Wrap</button>` +
        `<button class="btn" data-act="group" title="Pick them up together from now on (Ctrl+G)"${grouped ? ' disabled' : ''}>Group</button>` +
        `<button class="btn" data-act="ungroup" title="They stop being picked up together (Ctrl+Shift+G)"${grouped ? '' : ' disabled'}>Ungroup</button></div>`;
    }
    const l = app.doc.layers.find((x) => x.id === app.sel);
    if (!l) return colourHead('<span class="pname muted">New shapes</span>');
    if (l.car) { // one fade over the whole car: its colours and car lines are set in its own window
      return `<div class="phead"><span class="cgsw" style="background:${carCss(l.car.blocks)}"></span><span class="pnames"><input id="f-name" class="pname" type="text" value="${esc(l.name)}" title="Its name in the Layers list" aria-label="Name"></span></div>` +
        `<div class="acts"><button class="btn" data-act="openCarGradient" title="Its colours along the car, and which stretch of the car each panel is">Edit gradient…</button></div>` +
        slider('f-opacity', 0, 100, (l.opacity ?? 1) * 100, 'Opacity') +
        field('Blend', `<select id="f-blend" title="Multiply darkens what is under it, for a texture such as worn cardboard">${opt('', 'Normal', !l.blend)}${opt('multiply', 'Multiply', l.blend === 'multiply')}</select>`) +
        `<div class="acts">${trimButtons(l)}${trimClear(l)}</div>`;
    }
    const isText = l.type === 'text', isPic = isText || l.type === 'image';
    const fx = l.fx || {};
    // this livery's fonts first: the Google fonts added to it, the uploaded ones, the
    // others its text uses; then the rest. Each under a heading when it has any.
    const google = [...new Set(app.doc.googleFonts || [])], uploaded = (app.doc.customFonts || []).map((f) => f.name).filter((f) => !google.includes(f));
    const used = [...new Set(app.doc.layers.filter((x) => x.type === 'text' && x.font).map((x) => x.font))].filter((f) => !google.includes(f) && !uploaded.includes(f));
    const mine = [...google, ...uploaded, ...used], rest = [...new Set([...TEXT_FONTS, ...GOOGLE_FONTS])].filter((f) => !mine.includes(f));
    for (const list of [google, uploaded, used, rest]) list.sort((a, b) => a.localeCompare(b)); // A to Z within each heading
    const fontOpts = (list, label) => (!list.length ? '' : (mine.length ? section(label) : '') + list.map((f) => opt(f, f, f === l.font)).join(''));
    const weights = isText ? actions.fontWeights(l.font) : [];
    const weight = weights.length < 2 ? '' : field('Weight', `<select id="f-fontWeight">${weights.map((w) => opt(w, WEIGHT_NAMES[w], w === (l.fontWeight || 400))).join('')}</select>`);
    const lined = isText && String(l.text || '').includes('\n'); // settings that only mean something with several lines
    // the colour and name, then for text what it says and in what
    const head = colourHead(`<input id="f-name" class="pname" type="text" value="${esc(l.name)}" title="Its name in the Layers list" aria-label="Name">`) + (!isText ? '' :
      field('Text', `<textarea id="f-text" rows="2" spellcheck="false" title="Enter starts a new line">${esc(l.text)}</textarea>`) +
      field('Font', `<select id="f-font">${fontOpts(google, 'Google fonts added')}${fontOpts(uploaded, 'Uploaded fonts')}${fontOpts(used, 'Used in this livery')}${fontOpts(rest, 'All fonts')}${section('Add a font')}<option class="act" value="__google">Google font by name…</option><option class="act" value="__upload">Upload a font file…</option></select>`) +
      weight +
      slider('f-fontSize', 40, 400, l.fontSize || 160, 'Size'));
    const inPieces = Array.isArray(l.pts) && l.pts.some((q) => q.m);
    const place = l.locked ? '' : posBoxes() +
      (isPic ? slider('f-rotation', -180, 180, Math.round(l.rotation || 0), 'Turn') :
        l.type === 'fill' ? slider('f-turn', -180, 180, ((l.turn || 0) % 360 + 540) % 360 - 180, 'Turn') : '') +
      (isPic ? `<label class="switch" title="Off: it reads the right way round on both sides. On: a true mirror image.">Reverse the other side<input id="f-mirrorFlip" type="checkbox"${l.mirrorFlip ? ' checked' : ''}${l.mirrored ? '' : ' disabled'}></label>` : '') +
      `<label class="switch" title="Where it hangs over an edge linked in Map, it carries on onto the panel that edge meets. A piece placed over its panel in Map shows it too">Continue across edges<input id="f-continues" type="checkbox"${l.continues ? ' checked' : ''}></label>` +
      `<div class="acts">${trimButtons(l)}${mirroredBtn(l.mirrored)}<button class="btn" data-act="separate" title="Make the mirrored side a layer of its own"${l.mirrored ? '' : ' disabled'}>Separate</button>${trimClear(l)}</div>`;
    // a shape's fill can fade to a second colour, or to nothing
    const look = (l.type !== 'fill' ? '' : fadeHtml(l)) +
      (!isText ? '' :
      `<div class="with">${slider('f-outlineWidth', 0, 30, l.outlineWidth || 0, 'Outline')}<input id="f-outlineColor" type="color" value="${esc(hexOf(l.outlineColor || '') || '#000000')}" aria-label="Outline colour"></div>` +
      slider('f-letterSpacing', -40, 40, l.letterSpacing || 0, 'Spacing') +
      slider('f-curve', -180, 180, l.curve || 0, 'Curve') +
      (!lined ? '' : slider('f-lineSpacing', 60, 300, l.lineSpacing || 120, 'Line spacing') +
        field('Lines', `<select id="f-align">${[['left', 'Left'], ['center', 'Centred'], ['right', 'Right']].map(([v, n]) => opt(v, n, v === (l.align || 'center'))).join('')}</select>`)) +
      `<label class="switch" title="Slanted letters">Italic<input id="f-italic" type="checkbox"${l.italic ? ' checked' : ''}></label>`) +
      (!isPic ? '' :
      `<div class="with">${slider('f-fx-shadow', 0, 60, fx.shadow || 0, 'Shadow')}<input id="f-fx-shadowColor" type="color" value="${esc(hexOf(fx.shadowColor || '') || '#000000')}" aria-label="Shadow colour"></div>` +
      `<div class="two">${slider('f-fx-shadowDX', -60, 60, fx.shadowDX ?? 8, 'X', 'Where the shadow falls: across')}${slider('f-fx-shadowDY', -60, 60, fx.shadowDY ?? 8, 'Y', 'Where the shadow falls: down')}</div>`) +
      slider('f-opacity', 0, 100, (l.opacity ?? 1) * 100, 'Opacity') +
      field('Blend', `<select id="f-blend" title="Multiply darkens what is under it, for a texture such as worn cardboard">${opt('', 'Normal', !l.blend)}${opt('multiply', 'Multiply', l.blend === 'multiply')}</select>`);
    // what turns it into something else
    const off = (can) => (can ? '' : ' disabled');
    const shapeHow = l.type === 'image' ? 'For a flat-colour picture such as a logo: one shape for each colour in it, with the background left out. Each shape then takes a colour like any other.'
      : isText ? 'The lettering becomes a shape, so it can fade and be reshaped. It can no longer be retyped.' : 'For a picture or text';
    const turnInto = l.locked ? '' : `<div class="acts"><button class="btn" data-act="split" title="Undo a merge: one shape for each piece again"${off(inPieces)}>Split</button>` +
      `<button class="btn" data-act="fillIn" title="Make it solid: its holes are filled"${off(inPieces && hasInner(l.pts))}>Fill in</button>` +
      `<button class="btn" data-act="makeShapes" title="${shapeHow}"${off(isPic)}>Make shapes</button>` +
      `<button class="btn" data-act="ownColours" title="Take the colour off again"${off(l.type === 'image' && l.color)}>Original colours</button></div>`;
    return head + fold('f-place', 'Place', place) + fold('f-look', 'Look', look) + (l.specOnly ? '' : repeatHtml(l)) + fold('f-shape', 'Shape', turnInto);
  }
  // the folds left open stay open while the panel is redrawn, and next visit
  const openFolds = new Set(['f-place']);
  try { const kept = JSON.parse(localStorage.getItem('next-folds')); if (Array.isArray(kept)) { openFolds.clear(); kept.forEach((id) => openFolds.add(id)); } } catch { /* Place open */ }
  const trimCount = (l) => (Array.isArray(l.clip) ? l.clip.length : 0);
  // Trim keeps its name: lit while panels are being picked, with how many it is trimmed to
  function trimButtons(l) {
    const n = trimCount(l);
    return `<button class="btn" data-act="trim" aria-pressed="${!!app.trimming}" title="${app.trimming ? 'Click again when done' : 'Choose the panels it shows in'}">${n ? `Trim · ${n}` : 'Trim'}</button>`;
  }
  const trimClear = (l) => `<button class="btn" data-act="trimClear" title="Show it everywhere again"${trimCount(l) ? '' : ' disabled'}>Clear trim</button>`;
  // ---------- Finish mode's two panels ----------
  // what has a finish of its own; everything else is gloss
  function finishesHtml() {
    const t = app.ftarget;
    const rows = finishList(app.doc).map((f) => {
      const key = f.kind === 'colour' ? f.colour : f.id;
      const on = t && [t, ...app.fmore].some((x) => x.kind === f.kind && (f.kind === 'colour' ? x.colour === f.colour : x.id === f.id));
      const layer = f.kind === 'colour' ? null : app.doc.layers.find((l) => l.id === f.id);
      const sw = f.kind === 'colour' ? `background:${esc(f.colour)}` : f.kind === 'area' ? 'background:var(--accent-soft);border-style:dashed' : swatch(layer);
      const what = f.kind === 'colour' ? finishLabel(f.material, f.params) : `${esc(f.name)} · ${finishLabel(f.material, f.params)}`;
      // already the default: nothing to put back
      const plain = f.material === 'gloss' && !f.params;
      const reset = plain ? '' : `<button class="eye" data-findef="${f.kind}:${esc(key)}" title="Back to Gloss, the default" aria-label="Reset this finish to Gloss">${svg('reset')}</button>`;
      return `<div class="row${on ? ' sel' : ''}" data-fin="${f.kind}:${esc(key)}"><span class="sw" style="${sw}"></span><span class="name">${what}</span>${reset}</div>`;
    });
    return rows.join('');
  }
  // the colour the preview is shown in: the target's own, or neutral grey
  // for an area (it paints nothing) or a picture; a car gradient's colours, left to right
  function targetColour() {
    const t = app.ftarget;
    if (!t) return '#9aa0ab';
    if (t.kind === 'colour') return t.colour;
    const layer = app.doc.layers.find((l) => l.id === t.id);
    if (layer && layer.car) return carStops(layer.car.blocks);
    return (t.kind === 'layer' && layer && layerColour(layer)) || '#9aa0ab';
  }
  // the preview and the finish's name, redrawn in place while a slider moves
  function drawTile() {
    const c = $('f-tile'), now = c && actions.finishNow();
    if (!now) return;
    try { renderTile(c, now.material, now.params, targetColour()); } catch { c.hidden = true; }
    const name = $('f-label');
    if (name) name.textContent = finishLabel(now.material, now.params);
  }
  function finishHtml() {
    const t = app.ftarget, d = app.doc;
    if (!t) return '<div class="note">Click a colour or a layer on the sheet</div>';
    const layer = t.kind === 'colour' ? null : d.layers.find((l) => l.id === t.id);
    const now = actions.finishNow() || { material: 'gloss', params: null };
    const f = readFinish(now.material, now.params), preset = presetOf(f);
    const many = app.fmore.length + 1;
    const label = many > 1 ? `${many} picked` : t.kind === 'colour' ? `<span class="dot" style="background:${esc(t.colour)}"></span>Everything this colour` : t.kind === 'area' ? esc(layer ? layer.name : 'Area') : `Just ${esc(layer ? layer.name : 'this layer')}`;
    // a shape or text can be finished with its whole colour, or by itself
    const canScope = many === 1 && ((t.kind === 'colour' && t.layerId) || (t.kind === 'layer' && layer && !layer.car && layerColour(layer)));
    const scope = !canScope ? '' : `<div class="seg"><button data-scope="colour" aria-pressed="${t.kind === 'colour'}" title="Everything painted this colour gets the finish">All this colour</button><button data-scope="layer" aria-pressed="${t.kind === 'layer'}" title="Only this layer, whatever its colour">Just this layer</button></div>`;
    // the finish of anything else in the livery, taken over whole: no numbers to match by eye
    const others = finishList(d).filter((o) => !(o.kind === t.kind && (o.kind === 'colour' ? o.colour === t.colour : o.id === t.id)));
    const same = !others.length ? '' : field('Same as', `<select id="fn-same" title="Take the finish another colour or layer has, exactly">${opt('', 'Choose…', true)}${others.map((o) =>
      opt(`${o.kind}:${o.kind === 'colour' ? o.colour : o.id}`, `${o.kind === 'colour' ? o.colour.toUpperCase() : o.name} · ${finishLabel(o.material, o.params)}`, false)).join('')}</select>`);
    return '<canvas id="f-tile" class="ftile" width="472" height="176" aria-hidden="true"></canvas>' +
      `<div class="ftarget">${label}<b id="f-label"></b></div>` + scope +
      `<div class="finishes">${FINISHES.map((k) => `<button data-finish="${k}" aria-pressed="${k === preset}" title="${FINISH_TIPS[k]}">${finishName(k)}</button>`).join('')}</div>` +
      same +
      slider('fn-met', 0, 255, f.met, 'Metallic') + slider('fn-rough', 0, 255, f.rough, 'Roughness') + slider('fn-clear', 0, 255, f.clear, 'Clearcoat') +
      `<div class="acts"><button class="btn" data-act="resetFinish" title="Put the three sliders back"${preset ? ' disabled' : ''}>Reset</button></div>` +
      `<label class="switch" title="Specks or chips that catch the light, over this finish">Sparkle<input id="fn-sparkle" type="checkbox"${f.sparkle ? ' checked' : ''}></label>` +
      (!f.sparkle ? '' : slider('fn-amount', 1, 60, f.sparkle.amount, 'Amount') + slider('fn-size', 1, 12, f.sparkle.size, 'Size') + slider('fn-strength', 0, 100, f.sparkle.strength, 'Strength') + slider('fn-bright', 0, 100, f.sparkle.bright, 'Brightness', 'Each fleck also lightens the paint under it, so it shows bright even when it has nothing to mirror')) +
      (t.kind === 'area' && layer && many === 1 ? `<label class="switch" title="The same area on the twin panel too, or across the centreline">Mirrored<input id="f-mirrored" type="checkbox"${layer.mirrored ? ' checked' : ''}></label>` : '');
  }

  // ---------- Map mode's two panels ----------
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  // a heading between a list's sections: not indented like a group's, and not pickable
  const section = (label) => `<option class="sect" disabled>${esc(label)}</option>`;
  function piecesHtml() {
    const list = pieces(app.doc.regionMap);
    if (!list.length) return '<div class="note">Load a template to get a map</div>';
    if (app.tool === 'mpair') return pairsHtml(list);
    return list.map((r, i) => `<div class="row${r.id === app.piece ? ' sel' : ''}" data-piece="${esc(r.id)}"><span class="sw" style="background:${hue(i)}"></span><span class="name">${esc(r.name)}</span><span class="tags">${r.mirror ? '<i title="Has a twin">⇄</i>' : ''}${r.center ? '<i title="Has a centreline">┆</i>' : ''}</span></div>`).join('');
  }
  // Pair panels: the twins suggested, to check one by one; then the panels
  // with no suggestion, the pairs made, and the panels checked as having none.
  // A row opens (its panels go pink, on the car too) to name, confirm or change it.
  function pairsHtml(list) {
    const m = app.doc.regionMap, { pairs, none } = pairList(m), o = app.pairOpen;
    const nameOf = (id) => (list.find((r) => r.id === id) || { name: id }).name;
    const box = () => {
      const [a, b] = o.ids.map((id) => list.find((r) => r.id === id)), together = a && b && a.mirror === b.id;
      if (!a) return '';
      const btn = (act, label, title = '') => `<button class="btn" data-act="${act}"${title ? ` title="${title}"` : ''}>${label}</button>`;
      return '<div class="pairbox">' + [a, b].filter(Boolean).map((r, i) => `<label class="pname"><span class="sw" style="background:${PAIR_COLOURS[i]}"></span><input type="text" data-rname="${esc(r.id)}" value="${esc(r.name)}" aria-label="Name of the ${i ? 'blue' : 'pink'} panel"></label>`).join('') +
        '<div class="acts">' + (together ? btn('pairUnpair', 'Unpair')
          : a.noPair ? btn('pairHasPair', 'Has a pair', 'Puts it back in the list to pair')
          : (b ? btn('pairConfirm', 'Confirm', 'These two are twins') : '') + btn('pairNone', 'No pair', b ? 'Neither of these has a twin' : 'It has no twin')) + '</div>' +
        (together || a.noPair ? '' : `<div class="note">${b ? 'Wrong one? Click its pair on the sheet' : 'Click its pair on the sheet'}</div>`) + '</div>';
    };
    // label: one name, or a pair's two: the first at the left, the second at the right, ⇄ between
    const row = (key, label, tag = '', weak = false) => {
      const on = o && o.key === key;
      const names = Array.isArray(label) ? `<span class="name two"><span>${esc(label[0])}</span><i>⇄</i><span>${esc(label[1])}</span></span>` : `<span class="name">${esc(label)}</span>`;
      return `<div class="row${on ? ' sel' : ''}" data-pairrow="${esc(key)}">${names}<span class="tags${weak ? ' weak' : ''}">${tag}</span></div>` + (on ? box() : '');
    };
    const twins = list.filter((r) => r.mirror && list.findIndex((x) => x.id === r.mirror) > list.indexOf(r));
    const singles = list.filter((r) => r.noPair);
    const part = (title, rows) => (rows.length ? `<div class="sub">${title}</div>` + rows.join('') : '');
    return (pairs.length || none.length ? '' : '<div class="note">Every panel is checked</div>') +
      part('Check these', pairs.map((p) => row(`${p.a.id}|${p.b.id}`, [p.a.name, p.b.name], `${Math.round(p.fit * 100)}%`, p.weak))) +
      part('No match found', none.map((r) => row(r.id, r.name))) +
      part('Paired', twins.map((r) => row(`${r.id}|${r.mirror}`, [r.name, nameOf(r.mirror)]))) +
      part('No pair', singles.map((r) => row(r.id, r.name)));
  }
  // the shared map library: browse and share for everyone; review for admins
  // (see maplib.js), only offered when the page was opened with ?admin
  function libraryHtml() {
    const rv = app.review;
    if (rv) {
      return `<div class="note">Reviewing ${esc(rv.pr.file.replace(/^cars\//, ''))} · #${rv.pr.number} by ${esc(rv.pr.by)}</div>` +
        `<div class="seg"><button data-act="reviewOld" aria-pressed="${rv.side === 'old'}"${rv.old ? '' : ' disabled title="A new car: there is no map for it yet"'}>Old</button><button data-act="reviewNew" aria-pressed="${rv.side === 'new'}">New</button></div>` +
        `<div class="acts"><button class="btn" data-act="reviewApprove" title="Merges it, with any fixes you made to New"${rv.busy ? ' disabled' : ''}>${rv.busy === 'merge' ? 'Merging…' : 'Merge'}</button><button class="btn" data-act="reviewReject" title="Closes the pull request without merging"${rv.busy ? ' disabled' : ''}>${rv.busy === 'reject' ? 'Closing…' : 'Reject'}</button></div>` +
        '<div class="acts"><button class="btn" data-act="reviewStop" title="Back to this livery\'s own map; the pull request stays open">Stop</button></div>';
    }
    return '<div class="acts"><button class="btn" data-act="browseMaps" title="Maps other people have made, ready to load">Browse maps…</button><button class="btn" data-act="shareMap" title="Send this map to the shared library, through GitHub">Share map…</button></div>' +
      (app.admin ? '<div class="acts"><button class="btn" data-act="reviewMaps">Review maps…</button><button class="btn" data-act="adminSignOut">Sign out</button></div>'
        : app.adminAsk ? '<div class="acts"><button class="btn" data-act="adminSignIn">Sign in to review…</button></div>' : '');
  }
  function pieceHtml() {
    const m = app.doc.regionMap, list = pieces(m);
    if (!list.length) return '<div class="note">Load a template to get a map</div>' + libraryHtml();
    const r = list.find((x) => x.id === app.piece);
    const top = !r ? '<div class="note">Click a panel</div>'
      : field('Name', `<input id="m-name" type="text" value="${esc(r.name)}">`) +
        field('Twin', `<select id="m-pair">${opt('', 'None', !r.mirror)}${list.filter((x) => x !== r).map((x) => opt(x.id, x.name, x.id === r.mirror)).join('')}</select>`) +
        (r.mirror ? field('Flip', `<select id="m-flip" title="How the twin lies on the sheet compared with this panel">${Object.entries(MIRROR_NAMES).map(([k, v]) => opt(k, v, k === (r.mirrorKind || 'flip'))).join('')}</select>`) : '') +
        (() => { // a loose piece placed where it sits on the car
          const pl = (m.places || []).find((x) => x.piece.region === r.id), on = pl && list.find((x) => x.id === pl.at.region);
          return !pl ? '' : field('Placed over', `<span>${esc(on ? on.name : '')}</span>`) + '<div class="acts"><button class="btn" data-act="unplace" title="It stops showing what is painted over its spot on the car">Remove place</button></div>';
        })() +
        `<div class="acts"><button class="btn" data-act="centreStart" title="Two matching corners, one each side"${r.center ? ' disabled' : ''}>Set centreline</button><button class="btn" data-act="centreRemove"${r.center ? '' : ' disabled'}>Remove centreline</button></div>`;
    return top + '<hr class="rule">' +
      `<label class="switch" title="Each panel in its own colour on the sheet, so you can tell them apart">Panel colours<input id="m-colours" type="checkbox"${app.mapShow.colours ? ' checked' : ''}></label>` +
      `<label class="switch" title="Paints the panel colours and names onto the car, so you can see which panel is which in the sim">Show on car<input id="m-guide" type="checkbox"${actions.guideOn() ? ' checked' : ''}></label>` +
      '<div class="acts"><button class="btn" data-act="pickMapFile" title="A map saved as a file">Load map…</button><button class="btn" data-act="saveMap" title="Download this map as a file">Save map…</button></div>' +
      '<hr class="rule">' + libraryHtml();
  }
  // colours in use; `max`: how many, for the swatches
  function usedColours(max = 14) {
    const n = new Map();
    const add = (c) => { const h = hexOf(c || ''); if (h) n.set(h, (n.get(h) || 0) + 1); };
    add(app.doc.baseColor);
    for (const l of app.doc.layers) if (l.visible) add(layerColour(l));
    // in the order they sit in the livery (base coat, then back to front), so
    // a swatch does not jump about when a colour is used more or less
    return [...n.keys()].slice(0, max);
  }
  function drawPanels() {
    const inMap = app.mode === 'map', inFinish = app.mode === 'finish';
    panels.layers.querySelector('h2').textContent = inMap ? 'Panels' : inFinish ? 'Spec map' : 'Layers';
    panels.props.querySelector('h2').textContent = inMap ? 'Panel' : inFinish ? 'Finish' : 'Properties';
    panels.layers.querySelector('.body').innerHTML = inMap ? piecesHtml() : inFinish ? finishesHtml() : layersHtml();
    panels.props.querySelector('.body').innerHTML = inMap ? pieceHtml() : inFinish ? finishHtml() : propsHtml();
    drawTile();
    const cur = panels.layers.querySelector('.row.sel');
    if (inMap && cur) cur.scrollIntoView({ block: 'nearest' });
  }
  const refreshChrome = () => drawChrome();
  const refresh = () => { drawChrome(); drawPanels(); };

  // A slider and the box beside it are one control. A value typed in the box
  // moves the slider and is announced as the slider's own change, so nothing
  // else needs to know about the box; a dragged slider fills the box in.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('nbox')) {
      const s = $(t.dataset.for), v = Math.max(+t.min, Math.min(+t.max, +t.value));
      if (!s || t.value === '' || !Number.isFinite(v)) return; // half-typed
      s.value = v;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (t.type === 'range') {
      const bar = t.closest('.fillbar'), box = bar && bar.querySelector('.nbox');
      if (bar) bar.style.setProperty('--p', `${((t.value - t.min) / (t.max - t.min)) * 100}%`);
      if (box && document.activeElement !== box) box.value = t.value; // not under a half-typed number
    }
  }, true);
  // A bar is dragged by how far the pointer moves, not to where it is, so a
  // short bar still steps one at a time; Shift goes slower still. A click
  // that does not move opens its box for typing.
  document.addEventListener('pointerdown', (e) => {
    const bar = e.button === 0 && e.target.closest && e.target.closest('.fillbar');
    const r = bar && bar.querySelector('input[type="range"]'), box = bar && bar.querySelector('.nbox');
    if (!r || r.disabled || document.activeElement === box) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const min = +r.min, max = +r.max, per = (max - min) / Math.max(1, bar.clientWidth);
    let x = e.clientX, v = +r.value, went = 0;
    const move = (m) => {
      const dx = m.clientX - x; x = m.clientX; went += Math.abs(dx);
      if (went < 3) return;
      v = Math.max(min, Math.min(max, v + dx * (m.shiftKey ? Math.min(per, Math.max(per / 8, 0.05)) : per)));
      if (Math.round(v) === +r.value) return;
      r.value = Math.round(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      if (went >= 3) r.dispatchEvent(new Event('change', { bubbles: true }));
      else if (box) { box.focus(); box.select(); }
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  }, true);
  // A box that is done with says so as its slider's 'change'. That waits until
  // the boxes are left altogether: some panels are rebuilt on it, which would
  // take the next box from under a click that goes straight from one to another.
  const isBox = (el) => !!(el && el.classList && el.classList.contains('nbox'));
  let owed = null;
  const settleBoxes = () => {
    if (isBox(document.activeElement) || !owed) return;
    const s = owed; owed = null;
    if (s.isConnected) s.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.addEventListener('change', (e) => {
    const t = e.target, s = isBox(t) && $(t.dataset.for);
    if (!s) return;
    t.value = s.value; // what it came to, held within its range
    owed = s;
    setTimeout(settleBoxes, 0);
  }, true);
  document.addEventListener('focusout', (e) => { if (isBox(e.target)) setTimeout(settleBoxes, 0); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isBox(e.target)) { e.preventDefault(); e.target.blur(); } }, true); // Enter: done with the box

  // controls inside Properties: these must not rebuild the panel they sit in
  // the colour box at the top of Properties
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.colour) return;
    const v = t.value;
    const sw = panels.layers.querySelector(`[data-layer="${CSS.escape(String(app.sel))}"] .sw`);
    if (sw && (app.sel === 'base' || (actions.selected() || {}).type === 'fill')) sw.style.background = v;
    actions.setColour(v);
    // a picture's first colour: "Original colours" comes on (the colour boxes are left alone, one is in use)
    if (app.mode === 'paint' && (actions.selected() || {}).type === 'image' && panels.props.querySelector('[data-act="ownColours"]:disabled')) panels.props.querySelector('.body').innerHTML = propsHtml();
  });
  panels.props.addEventListener('input', (e) => {
    const t = e.target;
    const layer = app.doc.layers.find((x) => x.id === app.sel);
    // Finish mode's sliders: the finish's numbers; the preview follows in place
    const fn = /^fn-(met|rough|clear|amount|size|strength|bright)$/.exec(t.id || '');
    if (fn) { actions.tweakFinish(fn[1], +t.value); drawTile(); return; }
    if (t.id === 'f-fade-to') { actions.setFade('to', t.value); return; }
    if (t.dataset.fstop !== undefined) { actions.fadeColour(+t.dataset.fstop, { color: t.value }); return; }
    const stop = /^f-stop-(\d+)$/.exec(t.id || '');
    if (stop) { actions.fadeColour(+stop[1], { at: +t.value / 100 }); return; }
    if (t.dataset.repc !== undefined) { if (+t.dataset.repc < 0) actions.setColour(t.value); else actions.repeatColour(+t.dataset.repc, t.value); return; } // -1: the layer's own colour
    const rep = /^f-rep-(count|rows|gapX|gapY|angle|space|rSize|rTurn)$/.exec(t.id || '');
    if (rep) { actions.setRepeat({ [rep[1]]: +t.value }, false); return; }
    if (t.id === 'f-turn') { actions.turnTo(+t.value); return; }
    // plain settings: the control's id names the layer setting it sets
    const m = /^f-(fx-)?(fontSize|outlineWidth|outlineColor|letterSpacing|lineSpacing|curve|rotation|shadow|shadowColor|shadowDX|shadowDY|text)$/.exec(t.id || '');
    if (m && layer) {
      const v = t.type === 'range' ? +t.value : t.value;
      actions.setProp((m[1] ? 'fx.' : '') + m[2], v);
      if (m[2] === 'text') { const nm = $('f-name'); if (nm) nm.value = layer.name; const row = panels.layers.querySelector(`[data-layer="${CSS.escape(layer.id)}"] .name`); if (row) row.textContent = layer.name; }
      return;
    }
    if (t.id === 'f-opacity' && layer) {
      for (const x of actions.selectedLayers()) x.opacity = t.value / 100;
      actions.change({ panels: false });
    }
  });
  $('toolopts').addEventListener('input', (e) => {
    if (e.target.id === 'f-stamp-size') { $('f-stamp-n').textContent = e.target.value; actions.setStamp({ size: +e.target.value }); return; }
    if (e.target.id === 'f-stamp') { actions.setStamp({ key: e.target.value }); return; }
    if (e.target.id !== 'f-band') return;
    $('f-band-n').textContent = e.target.value;
    actions.setBandWidth(+e.target.value);
  });
  // Layers list: drag a row up or down to change what is in front of what.
  // The top of the list is the front of the sheet.
  let dragId = null;
  let dragWhole = false; // the row being dragged is a group's own: all its layers move
  const dropMark = (row, cls) => { for (const r of panels.layers.querySelectorAll('.drop-above, .drop-below, .drop-into')) r.classList.remove('drop-above', 'drop-below', 'drop-into'); if (row && cls) row.classList.add(cls); };
  // the top half of a row is just above it, the bottom half just below;
  // a group's own row takes a layer into the group, save its top quarter
  // (just above the group, so there is still a way above one at the top of the list)
  const dropSpot = (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || !dragId || row.dataset.layer === dragId) return null;
    const box = row.getBoundingClientRect(), y = (e.clientY - box.top) / box.height;
    if (row.dataset.layer === 'base') return { row, at: 'above' }; // nothing goes behind the base coat
    if (row.dataset.group && !dragWhole) return { row, at: y < 0.25 ? 'above' : 'into' };
    return { row, at: y < 0.5 ? 'above' : 'below' };
  };
  panels.layers.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row[data-layer][draggable]');
    if (!row || app.mode === 'map') { e.preventDefault(); return; }
    dragId = row.dataset.layer; dragWhole = !!row.dataset.group;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  panels.layers.addEventListener('dragover', (e) => {
    const spot = dropSpot(e);
    if (!spot) { dropMark(null); return; }
    e.preventDefault();
    dropMark(spot.row, 'drop-' + spot.at);
  });
  panels.layers.addEventListener('drop', (e) => {
    const spot = dropSpot(e);
    dropMark(null);
    if (!spot) return;
    e.preventDefault();
    // above a row in the list = in front of that layer on the sheet
    // (a group's own row stands for its front layer: into the group = in front of that one, in the group;
    // a layer dropped beside one of a group's layers is in that group, beside any other row it is in none)
    const { row, at } = spot, id = row.dataset.layer, gid = row.dataset.group;
    const join = gid ? (at === 'into' ? gid : null) : (app.doc.layers.find((l) => l.id === id) || {}).groupId || null;
    actions.reorder(dragId, id, at !== 'below', dragWhole, join);
  });
  // A name in the list is renamed by a double click, or by a click on it once
  // it is already the one selected (as file lists do). The first click selects,
  // which redraws the list, so the browser's own dblclick never arrives (its
  // target is gone): two clicks on the same name, close together, are counted here.
  let nameClick = { key: null, at: 0 };
  panels.layers.addEventListener('click', (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || row.dataset.layer === 'base' || e.target.matches('.rename') || !e.target.closest('.name') || e.shiftKey || e.ctrlKey || e.metaKey || app.mode !== 'paint') return;
    const gid = row.dataset.group, key = gid || row.dataset.layer, sel = actions.selectedLayers();
    const twice = nameClick.key === key && performance.now() - nameClick.at < 450;
    const already = gid ? row.classList.contains('sel') && sel.every((l) => l.groupId === gid) : sel.length === 1 && sel[0].id === key;
    nameClick = twice ? { key: null, at: 0 } : { key, at: performance.now() };
    if (!twice && !already) return;
    e.stopPropagation(); // it is already selected: nothing else to do with this click
    nameClick = { key: null, at: 0 };
    renameHere(row, gid, key);
  }, true);
  // The name turns into a box where it is: Enter or a click away keeps it, Esc leaves it as it was.
  function renameHere(row, gid, key) {
    const span = row.querySelector('.name'), box = document.createElement('input');
    box.className = 'name rename';
    box.value = span.textContent;
    box.setAttribute('aria-label', 'Name');
    span.replaceWith(box);
    row.draggable = false; // so dragging in the box selects its text
    let done = false;
    const end = (keep) => {
      if (done) return;
      done = true;
      const name = box.value.trim();
      if (keep && name && name !== span.textContent) gid ? actions.renameGroup(gid, name) : actions.renameLayer(key, name);
      else if (box.isConnected) { box.replaceWith(span); row.draggable = true; }
    };
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') end(true);
      else if (e.key === 'Escape') end(false);
    });
    box.addEventListener('blur', () => end(true));
    for (const t of ['click', 'dblclick', 'mousedown', 'pointerdown', 'contextmenu']) box.addEventListener(t, (e) => e.stopPropagation());
    box.focus();
    box.select();
  }
  // the pairing list: the row under the pointer lights its panels; a name box renames its panel
  panels.layers.addEventListener('pointerover', (e) => {
    const row = e.target.closest && e.target.closest('[data-pairrow]');
    actions.pairHover(row ? row.dataset.pairrow.split('|') : null);
  });
  panels.layers.addEventListener('pointerleave', () => actions.pairHover(null));
  panels.layers.addEventListener('change', (e) => {
    if (e.target.dataset.rname) actions.pairRename(e.target.dataset.rname, e.target.value.trim());
  });
  panels.layers.addEventListener('dragend', () => { dragId = null; dropMark(null); });

  // Every colour box opens the app's own colour pop-up (see picker.js), which
  // has the livery's colours in it; the browser's own is never shown.
  const picker = initPicker({
    colours: () => ({ saved: app.doc.palette.map((c) => ({ name: c.name, color: hexOf(c.color) })).filter((c) => c.color), used: usedColours() }),
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'color' || !t.id) return;
    e.preventDefault();
    picker.open(t);
  }, true);

  // a saved colour is renamed, changed or deleted from its chip
  const editChip = (e) => {
    const chip = e.target.closest('.chipwrap');
    if (!chip) return;
    e.preventDefault();
    actions.editColour(chip.querySelector('[data-pal]').dataset.pal);
  };
  panels.props.addEventListener('contextmenu', editChip);
  panels.props.addEventListener('dblclick', editChip);
  panels.props.addEventListener('toggle', (e) => { // the others closing say so too
    if (!e.target.classList.contains('fold')) return;
    if (e.target.open) openFolds.add(e.target.id); else openFolds.delete(e.target.id);
    try { localStorage.setItem('next-folds', JSON.stringify([...openFolds])); } catch { /* kept for this visit */ }
  }, true);
  panels.props.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'fn-sparkle') return actions.tweakFinish('sparkle', e.target.checked);
    if (id === 'fn-same') { if (e.target.value) actions.copyFinish(e.target.value); return; }
    if (/^fn-/.test(id)) return refresh(); // a slider let go: Reset comes or goes, the list's name updates
    if (id === 'f-mirrored') return actions.mirror();
    if (id === 'f-continues') return actions.continues();
    if (id === 'f-font') return actions.setFont(e.target.value);
    if (id === 'f-fontWeight') { actions.setProp('fontWeight', +e.target.value === 400 ? null : +e.target.value); return; }
    if (id === 'f-align') { actions.setProp('align', e.target.value === 'center' ? null : e.target.value); return; }
    if (id === 'f-fade') return actions.setFade('on', e.target.checked);
    if (id === 'f-rep-on') return actions.setRepeat(e.target.checked ? {} : null);
    if (id === 'f-rep-way') return actions.setRepeat({ way: e.target.value });
    if (id === 'f-rep-fill') return actions.setRepeat({ fill: e.target.checked });
    if (id === 'f-rep-mix') return actions.setRepeat({ mix: e.target.value });
    if (id === 'f-rep-fadeOut' || id === 'f-rep-shrink') return actions.setRepeat({ [id.slice(6)]: e.target.checked });
    if (id === 'f-rep-addshape') { if (e.target.value) actions.addRepeatShape(e.target.value); return; }
    if (e.target.dataset.fstop !== undefined) return; // as the Repeat colours just below
    if (e.target.dataset.repc !== undefined) return; // nothing is redrawn: that would swallow the click that took the focus away
    if (id === 'f-fade-out') return actions.setFade('out', e.target.checked);
    if (id === 'f-italic') { actions.setProp('italic', e.target.checked); return; }
    if (id === 'f-mirrorFlip') { actions.setProp('mirrorFlip', e.target.checked); return; }
    if (id === 'f-blend') { actions.setProp('blend', e.target.value || null); return; }
    if (id === 'f-cname') return actions.nameColour(e.target.value);
    if (id === 'm-name') return actions.mapRename(e.target.value.trim());
    if (id === 'm-pair') return actions.mapPair(e.target.value);
    if (id === 'm-flip') return actions.mapFlip(e.target.value);
    if (id === 'm-colours') return actions.toggleMapColours();
    if (id === 'm-guide') return actions.toggleGuide();
    const layer = app.doc.layers.find((x) => x.id === app.sel);
    if (e.target.id === 'f-name' && layer && e.target.value.trim()) { layer.name = e.target.value.trim(); actions.change(); }
  });

  // ---------- toast ----------
  let toastTimer = null;
  function say(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6500 : 3200);
  }

  // ---------- dialogs ----------
  const dlg = $('dlg');
  $('dlg-cancel').addEventListener('click', () => dlg.close('cancel'));
  // body: trusted markup built here (callers escape anything a user typed)
  function ask({ title, body = '', ok = 'OK', cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      $('dlg-title').textContent = title;
      $('dlg-body').innerHTML = body && !body.includes('<') ? `<div class="note">${body}</div>` : body;
      $('dlg-ok').hidden = ok === null;
      $('dlg-ok').textContent = ok || '';
      $('dlg-cancel').hidden = cancel === null;
      $('dlg-cancel').textContent = cancel || '';
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.showModal();
    });
  }
  async function askText({ title, label, value = '', ok = 'OK' }) {
    const p = ask({ title, ok, body: `<label><span>${esc(label)}</span><input id="dlg-text" type="text" value="${esc(value)}"></label>` });
    $('dlg-text').select();
    return (await p) ? $('dlg-text').value.trim() || null : null;
  }
  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  };
  // a list to pick one from: items [{ id, name, note }] → the picked id, or null
  async function pickList({ title, items, empty }) {
    let picked = null;
    const body = items.length
      ? `<div class="plist">${items.map((p) => `<button type="button" data-id="${esc(p.id)}">${p.thumb ? `<img alt="" src="${esc(p.thumb)}">` : ''}<span><b>${esc(p.name)}</b><small>${esc(p.note || '')}</small></span></button>`).join('')}</div>`
      : `<div class="note">${esc(empty)}</div>`;
    const p = ask({ title, body, ok: null });
    $('dlg-body').onclick = (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) { picked = b.dataset.id; dlg.close('ok'); }
    };
    await p;
    $('dlg-body').onclick = null;
    return picked;
  }
  const pickProject = (list) => pickList({ title: 'Open a project', empty: 'No saved projects yet.',
    items: list.map((p) => ({ id: p.id, thumb: p.thumb, name: p.name || 'untitled', note: p.updatedAt ? ago(p.updatedAt) : '' })) });
  async function carSetup(cur) {
    const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    const body =
      `<label title="Your iRacing customer ID: on the iRacing site under Account, and in your paint file names (car_123456.tga)"><span>Customer number</span><input id="cs-id" type="text" inputmode="numeric" placeholder="e.g. 123456" value="${esc(cur.custid)}"></label>` +
      `<label><span>Painting a</span><select id="cs-target">${opt('car', 'Car', cur.target === 'car')}${opt('helmet', 'Helmet', cur.target === 'helmet')}${opt('suit', 'Suit', cur.target === 'suit')}</select></label>` +
      `<label class="check" title="Your paint has its own numbers, so iRacing does not stamp its own over them"><input id="cs-num" type="checkbox"${cur.customNumber ? ' checked' : ''}><span>Custom number paint</span></label>` +
      (cur.cars.length ? `<label><span>Car folder</span><select id="cs-car">${opt('', 'Choose…', !cur.cars.includes(cur.car))}` +
        (cur.near.length ? `<optgroup label="Closest to this livery's name">${cur.near.map((c) => opt(c, c, false)).join('')}</optgroup><optgroup label="All">` : '') +
        cur.cars.map((c) => opt(c, c, c === cur.car)).join('') + (cur.near.length ? '</optgroup>' : '') + '</select></label>' : '') +
      `<div class="note">${!cur.folder ? 'No iRacing paints folder linked yet.' : cur.cars.length ? 'Folder linked: ' + esc(cur.folder) : `No car folders found in ${esc(cur.folder)}. Link the iRacing paints folder itself.`}</div>`;
    if (!await ask({ title: 'Car setup', body, ok: 'Save' })) return null;
    return { custid: $('cs-id').value, target: $('cs-target').value, customNumber: $('cs-num').checked, car: $('cs-car') ? $('cs-car').value : null };
  }
  async function editColour(c) {
    let del = false;
    const p = ask({
      title: 'Saved colour', ok: 'Save',
      body: `<label><span>Name</span><input id="ec-name" type="text" value="${esc(c.name)}"></label>` +
        `<label><span>Colour</span><span class="pair"><input id="ec-pick" type="color" value="${esc(c.color)}"><input id="ec-hex" class="mono" type="text" maxlength="7" spellcheck="false" value="${esc(c.color)}"></span></label>` +
        '<div><button type="button" class="btn" id="ec-del">Delete this colour</button></div>',
    });
    $('ec-pick').oninput = () => { $('ec-hex').value = $('ec-pick').value; };
    $('ec-hex').oninput = () => { const v = hexOf($('ec-hex').value); if (v) $('ec-pick').value = v; };
    $('ec-del').onclick = () => { del = true; dlg.close('ok'); };
    if (!await p) return null;
    return del ? 'delete' : { name: $('ec-name').value.trim(), color: $('ec-pick').value };
  }
  // Livery colours: each one's colour (picker or hex) and name. The base
  // coat's keeps its name, so it goes on the base coat wherever a palette of
  // them is used. `save`: kept as a palette, so it asks the palette's name too.
  // → { name, colors: [{ name, color }] } or null
  async function liveryColours(rows, save) {
    const p = ask({
      title: save ? 'Save as a palette' : 'Livery colours', ok: save ? 'Save' : 'Apply',
      body: (save ? `<label><span>Palette name</span><input id="lc-name" type="text" maxlength="40" value="${esc(app.doc.name || 'My palette')}"></label>` : '<div class="note">Change a colour here and everything in it changes too.</div>') +
        rows.map((r, k) => `<div class="lcrow"><input id="lc-pick-${k}" type="color" value="${esc(r.color)}" title="Choose a colour" aria-label="Colour"><input id="lc-hex-${k}" class="mono" type="text" maxlength="7" spellcheck="false" value="${esc(r.color)}" aria-label="Hex">` +
          `<input id="lc-n-${k}" type="text" maxlength="40" value="${esc(r.name)}" aria-label="Name"${k ? '' : ' disabled title="The base coat colour keeps this name, so it goes on the base coat wherever a palette of these is used"'}></div>`).join(''),
    });
    rows.forEach((r, k) => {
      $('lc-pick-' + k).oninput = () => { $('lc-hex-' + k).value = $('lc-pick-' + k).value; };
      $('lc-hex-' + k).oninput = () => { const v = hexOf($('lc-hex-' + k).value); if (v) $('lc-pick-' + k).value = v; };
    });
    if (!await p) return null;
    const name = save ? $('lc-name').value.trim() : '';
    if (save && !name) return null;
    return { name, colors: rows.map((r, k) => ({ name: $('lc-n-' + k).value.trim() || r.name, color: hexOf($('lc-pick-' + k).value) || r.color })) };
  }
  // The saved palettes. → { act: 'save' | 'import' | 'use' | 'export' | 'delete', i } or null
  const fontNames = (p) => (p.fonts ? [...p.fonts.google, ...p.fonts.custom.map((f) => f.name)] : []);
  async function palettes(list) {
    let picked = null;
    const body = `<div class="acts"><button type="button" class="btn" data-pp="save" title="Its saved colours and every colour it uses">Save this livery's colours</button><button type="button" class="btn" data-pp="import">Import a file…</button></div>` +
      (!list.length ? '<div class="note">No palettes yet. Save this livery\'s colours as one, or import a palette file.</div>'
        : list.map((p, i) => `<div class="prow"><button type="button" class="pbtn" data-pp="use" data-i="${i}" title="Add these colours to this livery">${p.colors.map((c) => `<i style="background:${esc(c.color)}" title="${esc(c.name)}"></i>`).join('')}<b>${esc(p.name)}</b><small>${fontNames(p).length ? 'Fonts: ' + esc(fontNames(p).join(', ')) : 'No fonts'}</small></button>` +
          `<span class="pacts"><button type="button" class="btn" data-pp="export" data-i="${i}" title="Download it as a file to share or keep">Export</button><button type="button" class="btn" data-pp="delete" data-i="${i}">Delete</button></span></div>`).join(''));
    dlg.classList.add('pal');
    const p = ask({ title: 'Palettes', body, ok: null, cancel: 'Close' });
    dlg.onclick = (e) => { // anywhere in the window, so a click off an armed Delete stands it down
      const b = e.target.closest('button[data-pp]'), armed = $('dlg-body').querySelector('.btn.bad');
      if (armed && armed !== b) { armed.classList.remove('bad'); armed.textContent = 'Delete'; } // a click anywhere else: not deleted
      if (b && b.dataset.pp === 'delete' && b !== armed) { b.classList.add('bad'); b.textContent = 'Confirm'; return; } // the first click asks
      if (b) { picked = { act: b.dataset.pp, i: +b.dataset.i || 0 }; dlg.close('ok'); }
    };
    await p;
    dlg.onclick = null;
    dlg.classList.remove('pal');
    return picked;
  }
  // ---------- the library ----------
  // → { kind: 'logos' | 'graphics' | 'shapes' | 'file', item } or null
  // The library: my own pictures, my own shapes, and a search of the open icon
  // sets, whose finds come in as shapes. search(query) → { ids, capped, draw(ids) };
  // fetchIcon(find) → the shape made from one.
  // shapesOnly: pictures are left out (a shape is being drawn, and only shapes can join it)
  async function library(lib, { remove, search, fetchIcon, shapesOnly = false }) {
    let tab = shapesOnly ? (lib.shapes.length ? 'shapes' : 'search') : lib.logos.length ? 'logos' : lib.shapes.length ? 'shapes' : 'search', picked = null;
    let query = '', hits = null, found = null, shown = 0, state = ''; // hits: what the last search matched; found: those drawn so far; state: '' | 'busy' | a message
    let only = '', ticket = 0; // only: the one set shown, or '' for all of them; ticket: which search or page is the latest
    const PAGE = 64; // drawn at a time: each find's drawing has to be fetched
    const pool = () => (!hits ? [] : only ? hits.ids.filter((id) => id.startsWith(only + ':')) : hits.ids);
    const count = (k) => (k ? hits.ids.filter((id) => id.startsWith(k + ':')).length : hits.ids.length) + (hits.capped ? '+' : '');
    const FILTERS = [['', 'All'], ['simple-icons', 'Logos'], ['game-icons', 'Game Icons'], ['material-symbols', 'Material Symbols'], ['mdi', 'Material Design'], ['bi', 'Bootstrap']];
    const tile = (kind, it, art, own) => `<span class="tilewrap"><button type="button" class="tile" data-lib="${kind}:${esc(it.id)}" title="${esc(it.name)}">${art}<span>${esc(it.name)}</span></button>${own ? `<button type="button" class="tilex" data-libx="${kind}:${esc(it.id)}" title="Remove from the library" aria-label="Remove ${esc(it.name)}">${svg('close')}</button>` : ''}</span>`;
    const results = () => (state === 'busy' ? '<div class="note">Searching…</div>'
      : state ? `<div class="note">${esc(state)}</div>`
      : !found ? '<div class="note">Type a word and press Enter: flame, wing, skull, wrench…</div>'
      : !found.length ? '<div class="note">Nothing found for that. Try another word.</div>'
      : `<div class="tiles">${found.map((it, k) => `<span class="tilewrap"><button type="button" class="tile" data-icon="${k}" title="${esc(it.name)} · ${esc(it.set)}${it.licence ? ' · ' + esc(it.licence) : ''}"><img alt="" loading="lazy" src="${esc(it.preview)}"><span>${esc(it.name)}</span></button></span>`).join('')}</div>` +
        (shown < pool().length ? `<button type="button" class="btn" data-more>Show more · ${pool().length - shown} left</button>` : ''));
    const filters = () => FILTERS.map(([k, name]) => `<button type="button" data-only="${k}" aria-pressed="${k === only}">${name}${hits ? ' · ' + count(k) : ''}</button>`).join('');
    const show = () => { if (tab === 'search' && $('lib-found')) { $('lib-only').innerHTML = filters(); $('lib-found').innerHTML = results(); } };
    const draw = () => {
      const sets = shapesOnly ? [] : lib.sets || []; // several layers saved as one: not something a shape can be drawn from
      const tabs = [['logos', `Your pictures${lib.logos.length ? ' · ' + lib.logos.length : ''}`], ['shapes', `Your shapes${lib.shapes.length + sets.length ? ' · ' + (lib.shapes.length + sets.length) : ''}`], ['search', 'Search icons']].filter(([k]) => !shapesOnly || k !== 'logos');
      const side = tab === 'logos' ? '<button type="button" class="btn" data-lib="file:" style="margin-left:auto">Picture from a file…</button>'
        : tab === 'shapes' ? (shapesOnly ? '' : '<button type="button" class="btn main" data-lib="draw:" style="margin-left:auto" title="A blank page and the drawing tools: what you draw is saved here as one shape">Draw a shape</button>') +
          `<button type="button" class="btn" data-lib="shapefile:"${shapesOnly ? ' style="margin-left:auto"' : ''} title="What the file fills becomes a shape: it takes a colour and works as a stamp or a repeat's shape">Shape from an SVG file…</button>` : '';
      const grid = tab === 'logos' ? lib.logos.map((it) => tile('logos', it, `<img alt="" src="${esc(it.src)}">`, true)).join('')
        : sets.map((it) => tile('sets', it, `<img alt="" src="${esc(it.thumb)}">`, true)).join('') + lib.shapes.map((it) => tile('shapes', it, shapeSvg(it), true)).join('');
      const empty = tab === 'logos' ? 'Pictures you bring in are kept here.' : 'Shapes you save, search for or bring in from a file are kept here. Select several layers and use Edit › Save to library to keep them as one.';
      $('dlg-body').innerHTML = `<div class="tabs">${tabs.map(([k, name]) => `<button type="button" data-libtab="${k}" aria-pressed="${k === tab}">${name}</button>`).join('')}${side}</div>` +
        (tab === 'search'
          ? `<input id="lib-q" type="text" placeholder="Search icons" value="${esc(query)}" spellcheck="false" autocomplete="off" aria-label="Search icons">` +
            `<div class="seg" id="lib-only">${filters()}</div><div id="lib-found">${results()}</div>` +
            '<div class="note small">They come in as shapes. From Game Icons (credit kept with the livery), Material Symbols, Material Design Icons, Bootstrap Icons and Simple Icons (brand logos).</div>' +
            '<div class="note small">More logos, old versions too: <a href="https://www.brandsoftheworld.com" target="_blank" rel="noopener">Brands of the World</a>, <a href="https://commons.wikimedia.org/wiki/Category:Logos" target="_blank" rel="noopener">Wikimedia Commons</a> and <a href="https://logos.fandom.com" target="_blank" rel="noopener">Logopedia</a>. Bring a download in with Shape from an SVG file or Picture from a file.</div>'
          : grid ? `<div class="tiles">${grid}</div>` : `<div class="note">${empty}</div>`);
      if (tab === 'search') $('lib-q').focus();
    };
    const offline = 'The search could not be reached. It needs an internet connection.';
    // the next PAGE of the finds in the set shown, drawn; dropped if another search or filter has started since
    const page = async () => {
      const t = ++ticket, ids = pool().slice(shown, shown + PAGE);
      try { const got = await hits.draw(ids); if (t !== ticket) return; shown += ids.length; found = [...(found || []), ...got]; state = ''; }
      catch { if (t !== ticket) return; state = offline; }
      show();
    };
    const run = async () => {
      query = $('lib-q').value.trim();
      if (!query) return;
      const t = ++ticket;
      hits = found = null; shown = 0; state = 'busy'; show();
      try { const h = await search(query); if (t !== ticket) return; hits = h; }
      catch { if (t === ticket) { state = offline; show(); } return; }
      await page();
    };
    const p = ask({ title: 'Library', ok: null, cancel: 'Close' });
    dlg.classList.add('wide', 'lib');
    draw();
    $('dlg-body').onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'lib-q') { e.preventDefault(); run(); } }; // Enter searches; it must not close the dialog
    $('dlg-body').onclick = async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.libtab) { tab = t.dataset.libtab; draw(); return; }
      if (t.dataset.only !== undefined) { only = t.dataset.only; found = null; shown = 0; if (hits) { state = 'busy'; show(); page(); } else show(); return; } // the same finds, narrowed: nothing is searched again
      if (t.dataset.more !== undefined) { t.disabled = true; page(); return; }
      if (t.dataset.icon !== undefined) { // a find: fetched and made into a shape before the dialog closes
        const it = found[+t.dataset.icon];
        t.disabled = true;
        try { picked = { kind: 'icon', item: await fetchIcon(it) }; dlg.close('ok'); }
        catch (err) { t.disabled = false; say(err.message || 'That icon could not be made into a shape', true); }
        return;
      }
      const [kind, id] = (t.dataset.libx || t.dataset.lib || '').split(':');
      if (t.dataset.libx) { remove(kind, id); lib[kind] = lib[kind].filter((x) => x.id !== id); draw(); return; }
      if (!kind) return;
      picked = kind === 'file' || kind === 'shapefile' || kind === 'draw' ? { kind } : { kind, item: lib[kind].find((x) => x.id === id) };
      dlg.close('ok');
    };
    await p;
    $('dlg-body').onclick = $('dlg-body').onkeydown = null;
    dlg.classList.remove('wide', 'lib');
    return picked && (picked.kind === 'file' || picked.kind === 'shapefile' || picked.kind === 'draw' || picked.item) ? picked : null;
  }
  // Merging layers that cannot simply become one shape: what should happen?
  // → 'shape' | '#rrggbb' (make them all this colour, then one shape) | 'group' | 'picture' | null
  async function mergeChoice({ shapes, sameColour, colours, top }) {
    let picked = null;
    const why = !shapes ? 'Text and pictures cannot be part of a shape.'
      : !sameColour ? 'These shapes are different colours. One shape has one colour.'
      : 'These shapes have different settings (fade, finish, trim or Mirrored).';
    const oneShape = !shapes ? ''
      : !sameColour ? `<div class="sub">Make them all</div><div class="dots">${colours.map((c) => `<button type="button" class="dot big" data-pick="${esc(c)}" style="background:${esc(c)}" title="${esc(c.toUpperCase())}" aria-label="Make them all ${esc(c)}"></button>`).join('')}</div>`
      : `<button type="button" class="btn" data-pick="shape">One shape, like ${esc(top)}</button>`;
    const p = ask({
      title: 'Merge', ok: null,
      body: `<div class="note">${why}</div>${oneShape}<div class="acts"><button type="button" class="btn" data-pick="group" title="They stay separate, but are picked up together">Group them instead</button><button type="button" class="btn" data-pick="picture" title="One flat picture: it can be given one colour, but not reshaped">Merge into a picture</button></div>`,
    });
    $('dlg-body').onclick = (e) => {
      const t = e.target.closest('[data-pick]');
      if (t) { picked = t.dataset.pick; dlg.close('ok'); }
    };
    await p;
    $('dlg-body').onclick = null;
    return picked;
  }
  // Keyboard shortcuts, laid out as other programs lay theirs out: one action
  // to a row under the name it usually goes by, keys as keycaps, in groups.
  // Each entry: [action, ...ways], a way being the keys pressed together.
  // (What the keys really do is in the keydown handler in app.js and key() in tools.js.)
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const KEYS = [
    ['Tools', [
      ['Select', ['V']], ['Hand', ['H']], ['Pen', ['P']], ['Shape', ['U']], ['Band', ['B']], ['Stamp', ['S']],
      ['Text', ['T']], ['Fill panel', ['G']],
    ]],
    ['View', [
      ['Pan', ['Space', 'Drag'], ['Middle-drag']], ['Zoom', ['Scroll']], ['Zoom in', ['+']], ['Zoom out', ['−']], ['Fit to screen', ['F']],
      ['Panel colours on car', ['C']],
    ]],
    ['Selection', [
      ['Select all', ['Ctrl', 'A']], ['Deselect', ['Esc']], ['Add to selection', ['Ctrl', 'Click'], ['Shift', 'Click']], ['Select a range in Layers', ['Shift', 'Click']], ['Select one layer of a group', ['Double-click']], ['Marquee select', ['Drag']],
    ]],
    ['Edit', [
      ['Undo', ['Ctrl', 'Z']], ['Redo', ['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']],
      ['Copy', ['Ctrl', 'C']], ['Paste', ['Ctrl', 'V']], ['Duplicate', ['Ctrl', 'D']], ['Delete', ['Del'], ['Backspace']],
      ['Nudge 1 px', ['Arrow keys']], ['Nudge 10 px', ['Shift', 'Arrow keys']],
    ]],
    ['Arrange', [
      ['Bring forward', ['Ctrl', ']']], ['Send backward', ['Ctrl', '[']], ['Bring to front', ['Ctrl', 'Shift', ']']], ['Send to back', ['Ctrl', 'Shift', '[']],
      ['Group', ['Ctrl', 'G']], ['Ungroup', ['Ctrl', 'Shift', 'G']], ['Merge', ['Ctrl', 'E']], ['Mirror', ['Ctrl', 'M']],
    ]],
    ['Drawing', [
      ['Finish path', ['Enter']], ['Remove last point', ['Backspace']], ['Cancel', ['Esc']],
      ['Constrain angle to 45°', ['Shift']], ['Constrain proportions', ['Shift']], ['Rotate in 15° steps', ['Shift']],
      ['Add point', ['Click path']], ['Delete point', ['Right-click']], ['Context menu', ['Right-click']],
    ]],
    ['File', [
      ['Save', ['Ctrl', 'S']], ['Keyboard shortcuts', ['F1']],
    ]],
  ];
  const keycap = (k) => `<kbd>${esc(MAC && k === 'Ctrl' ? '⌘' : k)}</kbd>`;
  const shortcuts = () => {
    const group = ([name, rows]) => `<section><h4>${name}</h4>${rows.map(([action, ...ways]) =>
      `<div class="key"><span>${action}</span><span class="caps">${ways.map((w) => w.map(keycap).join('<i>+</i>')).join('<i class="or">or</i>')}</span></div>`).join('')}</section>`;
    // two columns, each a run of whole groups
    const cols = [[KEYS[0], KEYS[1], KEYS[2], KEYS[6]], [KEYS[3], KEYS[4], KEYS[5]]]; // Tools, View, Selection, File | Edit, Arrange, Drawing
    const p = ask({ title: 'Keyboard shortcuts', ok: 'Close', cancel: null, body: `<div class="keys">${cols.map((c) => `<div>${c.map(group).join('')}</div>`).join('')}</div>` });
    dlg.classList.add('wide');
    return p.then(() => dlg.classList.remove('wide'));
  };
  // who drew the icons used in the open livery: the open sets ask to be named
  const credits = () => {
    const list = actions.credits();
    return !list.length ? '' : '<div class="sub">Icons in this livery</div>' + list.map((c) =>
      `<div class="note">${esc(c.name)}: ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.set)}</a>` : esc(c.set)}${c.author ? ' by ' + esc(c.author) : ''}${c.licence ? ', ' + esc(c.licence) : ''}</div>`).join('');
  };
  const about = () => ask({ title: 'About', ok: 'Close', cancel: null, body: `<div class="brandname">Overspray</div><div class="note">${esc(version)}</div><div class="note">Built on <a href="https://github.com/OblivionsPeak/clearcoat" target="_blank" rel="noopener">Clearcoat by OblivionsPeak</a></div>` + credits() });

  // ---------- clicks ----------
  const run = (act) => {
    if (!act) return;
    if (act.startsWith('show:')) { const k = act.slice(5); app.show[k] = !app.show[k]; actions.redraw(); return; } // a view choice: nothing in the livery changes
    if (act.startsWith('theme:')) return actions.setTheme(act.slice(6));
    if (act === 'shortcuts') return shortcuts();
    if (act === 'about') return about();
    return actions[act]();
  };
  document.addEventListener('click', (e) => {
    document.querySelector('.ctx')?.remove();
    const menuBtn = e.target.closest('.menu > button');
    if (menuBtn) {
      const m = menuBtn.parentElement, on = !m.classList.contains('open');
      closeMenus();
      m.classList.toggle('open', on);
      m.querySelector('.drop').hidden = !on;
      return;
    }
    const t = e.target.closest('button, .row');
    if (!t || !t.closest('.drop')) closeMenus();
    if (!t || t.disabled) return;
    if (t.dataset.act !== undefined) { closeMenus(); return run(t.dataset.act); }
    if (t.dataset.mode) return actions.setMode(t.dataset.mode);
    if (t.dataset.findef) { const [kind, key] = t.dataset.findef.split(/:(.*)/); return actions.finishDefault(kind, key); }
    if (t.dataset.fin) { const [kind, key] = t.dataset.fin.split(/:(.*)/); return actions.finishSelect(kind, key, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) && 'add'); }
    if (t.dataset.finish) return actions.setFinish(t.dataset.finish);
    if (t.dataset.scope) return actions.finishScope(t.dataset.scope);
    if (t.dataset.fade) return actions.setFade('style', t.dataset.fade);
    if (t.dataset.repsdrop !== undefined) return actions.dropRepeatShape(+t.dataset.repsdrop);
    if (t.dataset.repcdrop !== undefined) return actions.dropRepeatColour(+t.dataset.repcdrop);
    if (t.dataset.fstopdrop !== undefined) return actions.dropFadeColour(+t.dataset.fstopdrop);
    if (t.dataset.piece) return actions.pickPiece(t.dataset.piece);
    if (t.dataset.pairrow) return actions.pairOpen(t.dataset.pairrow);
    if (t.dataset.tool === 'image') return actions.openLibrary(); // nothing to arm: it opens the library
    if (t.dataset.tool === 'extras') return actions.openExtras(); // nor here: it shows the car's extras in Properties
    if (t.dataset.tool === 'cargrad') return actions.addCarGradient(); // nor here: it adds one and opens its window
    if (t.dataset.tool) return actions.setTool(t.dataset.tool);
    if (t.dataset.edit) return actions.editColour(t.dataset.edit);
    if (t.dataset.savedfold !== undefined) { // the arrow by the colours: the saved ones, shown or put away
      if (!openFolds.delete('f-saved')) openFolds.add('f-saved');
      try { localStorage.setItem('next-folds', JSON.stringify([...openFolds])); } catch { /* kept for this visit */ }
      return refresh();
    }
    if (t.dataset.pal) return actions.usePalette(t.dataset.pal);
    if (t.dataset.col) return actions.applyColour(t.dataset.col);
    if (t.dataset.kind) return actions.setShapeKind(t.dataset.kind);
    if (t.dataset.del) return actions.removeLayer(t.dataset.del);
    if (t.dataset.fold) return actions.foldGroup(t.dataset.fold);
    if (t.dataset.delg) return actions.removeGroup(t.dataset.delg);
    if (t.dataset.eyeg) return actions.showGroup(t.dataset.eyeg);
    if (t.dataset.eye) {
      const l = app.doc.layers.find((x) => x.id === t.dataset.eye);
      if (l) { l.visible = !l.visible; actions.change(); }
      return;
    }
    if (t.dataset.swpick) return actions.select(t.dataset.swpick);
    if (t.dataset.layer) { // Shift: the whole run from the row clicked last to this one; Ctrl: add or take out this one
      if (e.shiftKey && t.dataset.layer !== 'base' && panels.layers.contains(t)) return actions.selectRange(t.dataset.layer);
      // a layer's own row is that layer alone, even in a group; the group's row is the group
      return actions.select(t.dataset.layer, e.ctrlKey || e.metaKey || e.shiftKey, !t.dataset.group && panels.layers.contains(t));
    }
    if (t.dataset.p) {
      const p = t.closest('.panel'), key = p.dataset.panel;
      if (t.dataset.p === 'fold') p.querySelector('.body').hidden = !p.querySelector('.body').hidden;
      if (t.dataset.p === 'close') app.show[key] = false;
      if (t.dataset.p === 'float') setFloat(key, !p.classList.contains('float'));
      refresh();
    }
  });

  // right-click menus: on the sheet, and on a row of the Layers list
  const openCtx = (e, items) => {
    e.preventDefault();
    document.querySelector('.ctx')?.remove();
    const m = document.createElement('div'), box = $('stage').getBoundingClientRect();
    m.className = 'drop ctx';
    m.innerHTML = items.map(itemHtml).join('');
    $('stage').append(m);
    m.style.left = Math.max(4, Math.min(e.clientX - box.left, box.width - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(e.clientY - box.top, box.height - m.offsetHeight - 4)) + 'px';
  };
  $('stage').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.panel')) return;
    openCtx(e, [...layerItems(), 0, ['Fit to screen', 'F', 'fit']]);
  });
  panels.layers.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || app.mode !== 'paint') return;
    e.preventDefault();
    const id = row.dataset.layer;
    if (id === 'base') return; // nothing in the menu applies to the base coat
    if (!actions.selectedLayers().some((l) => l.id === id)) actions.select(id); // the menu is about what is selected
    openCtx(e, layerItems());
  });

  function setFloat(key, floating) {
    const p = panels[key], t = p.querySelector('[data-p="float"]'), n = PANELS.indexOf(key);
    p.classList.toggle('float', floating);
    t.innerHTML = svg(floating ? 'dock' : 'float');
    t.title = floating ? 'Dock' : 'Float';
    t.setAttribute('aria-label', t.title);
    if (floating) { $('stage').append(p); p.style.left = 24 + n * 24 + 'px'; p.style.top = 20 + n * 150 + 'px'; }
    else {
      p.style.left = p.style.top = '';
      const next = PANELS.slice(n + 1).map((k) => panels[k]).find((q) => q.parentElement === $('dock'));
      next ? next.before(p) : $('dock').append(p);
    }
  }
  // where the cards are, for the next visit (app.js keeps it with the other view choices)
  const layout = () => Object.fromEntries(PANELS.map((k) => {
    const p = panels[k], body = p.querySelector('.body');
    return [k, { float: p.classList.contains('float'), left: parseFloat(p.style.left), top: parseFloat(p.style.top), folded: body.hidden, height: body.style.maxHeight }];
  }));
  function setLayout(saved) {
    const st = $('stage');
    for (const k of PANELS) {
      const s = saved && saved[k], p = panels[k], body = p.querySelector('.body');
      if (!s) continue;
      body.hidden = !!s.folded;
      if (/^\d+(\.\d+)?px$/.test(s.height || '')) body.style.maxHeight = s.height;
      if (!s.float) continue;
      setFloat(k, true);
      // the window may be smaller this time: keep the header where it can be grabbed
      if (Number.isFinite(s.left)) p.style.left = Math.max(0, Math.min(st.clientWidth - 60, s.left)) + 'px';
      if (Number.isFinite(s.top)) p.style.top = Math.max(0, Math.min(st.clientHeight - 30, s.top)) + 'px';
    }
  }

  // floating panels move by their header
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.panel.float > header');
    if (!h || e.target.closest('button')) return;
    const p = h.parentElement;
    drag = { p, dx: e.clientX - p.offsetLeft, dy: e.clientY - p.offsetTop };
    h.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const st = $('stage');
    drag.p.style.left = Math.max(0, Math.min(st.clientWidth - 60, e.clientX - drag.dx)) + 'px';
    drag.p.style.top = Math.max(0, Math.min(st.clientHeight - 30, e.clientY - drag.dy)) + 'px';
  });
  document.addEventListener('pointerup', () => { drag = null; });

  // put the cursor in a Properties box, ready to type over what is there
  const focusField = (id) => { const el = $(id); if (el) { el.focus(); if (el.select) el.select(); } };
  return { layout, setLayout, refresh, refreshChrome, say, ask, askText, pickList, pickProject, carSetup, shortcuts, editColour, palettes, liveryColours, usedColours, focusField, library, mergeChoice };
}
