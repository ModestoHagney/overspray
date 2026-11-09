// Tutorials: the screen dims except the one thing a step is about, and a
// bubble beside it says what it does. Only ever started by a click (Start
// tutorial, or Help), never by itself.
// A step: { at: () => element or null (null: the bubble sits in the middle),
// text, done: () => true once the person has done what the step asks (it then
// moves on by itself), skip: () => true when there is nothing to do }

const $ = (id) => document.getElementById(id);
const seen = (el) => el && el.getClientRects().length > 0;
const q = (sel) => document.querySelector(sel);
const tool = (id) => () => q(`[data-tool="${id}"]`);
const NEEDS = ' Opens once a template is in.';
// Paint mode's own strip: the tools steps point at are only there
const toMode = (m) => () => { const b = q(`[data-mode="${m}"]`); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
const toPaint = toMode('paint');

const TUTORIALS = {
  setup: (app) => {
    let layers = 0;
    return [
      { at: () => document.querySelector('[data-mode="map"]'), text: '<b>Map tab.</b> Tell Overspray which panel is which, its twin on the other side and where panels meet. Mirrored and paint that runs across seams use it. It opens once a template is in.' },
      { at: () => document.querySelector('[data-mode="paint"]'), text: '<b>Paint tab.</b> Where you paint: colours, shapes, text and logos.' },
      { at: () => document.querySelector('[data-mode="finish"]'), text: '<b>Spec tab.</b> The spec map: which parts are gloss, matte or chrome.' },
      { at: () => (seen($('btn-empty-template')) ? $('btn-empty-template') : document.querySelector('#menus button')),
        text: '<b>Open blank template…</b> Pick your car\'s template. No template yet? <a href="https://www.tradingpaints.com/cartemplates" target="_blank" rel="noopener">Download one from Trading Paints</a>, then come back here.',
        done: () => !!app.doc.template, skip: () => !!app.doc.template },
      { at: () => $('btn-live'),
        text: '<b>Live.</b> Press it. It asks for your iRacing customer ID: in iRacing, click your name or helmet in the top right, then the copy button beside your ID. Then pick your paints folder: Documents › iRacing › paints.',
        done: () => app.live && !app.liveBad, skip: () => app.live && !app.liveBad },
      { at: () => null, text: '<b>Open the car in iRacing.</b> In iRacing, go to My Content › Cars, find the car your template is for in the list and click it, then click the Car Model tab. It shows the car in 3D with your paint on it. Keep it open.' },
      { at: () => document.querySelector('[data-tool="piece"]'),
        text: '<b>Fill panel (G).</b> Pick it, then click a panel on the sheet.',
        start: () => { layers = app.doc.layers.length; }, done: () => app.doc.layers.length > layers },
      { at: () => $('btn-live'), text: '<b>Look at the car in iRacing.</b> The panel you filled should now be painted. Every change you make goes to the car like this while Live is on.' },
      { at: () => null, text: '<b>You are set up.</b> Hover any button to see what it does, and F1 lists the keys.' },
    ];
  },
  painting: (app) => [
    { at: tool('select'), start: toPaint, text: '<b>Select (V).</b> Click something on the sheet to pick it, then drag to move it. Its settings show in Properties on the right.' },
    { at: tool('hand'), text: '<b>Hand (H).</b> Drag to move around the sheet. Holding Space does the same with any tool, and the mouse wheel zooms.' },
    { at: tool('pen'), text: '<b>Pen (P).</b> Click points to draw your own shape. Enter finishes it.' },
    { at: tool('shape'), text: '<b>Shape (U).</b> Ready-made shapes: pick one from its menu, then drag on the sheet.' },
    { at: tool('band'), text: '<b>Band (B).</b> A straight stripe. Click where it starts, then where it ends. It snaps to panel edges.' },
    { at: tool('stamp'), text: '<b>Stamp (S).</b> Each click places another copy of a shape.' },
    { at: tool('text'), text: '<b>Text (T).</b> Click where the text goes, then type. The font is in Properties.' },
    { at: tool('image'), text: '<b>Library.</b> Logos, pictures and the shapes you have saved.' },
    { at: tool('piece'), text: '<b>Fill panel (G).</b> Click a panel to fill it. Shift+click adds another panel to the same layer.' + NEEDS },
    { at: tool('cargrad'), text: '<b>Car gradient.</b> A fade along the whole car, matching on both sides.' + NEEDS },
    { at: tool('extras'), text: '<b>Car extras.</b> The pit box, colour squares and pitboard. iRacing colours these from small squares on the sheet.' + NEEDS },
    { at: () => $('c-pick'), start: toPaint, text: '<b>Colour.</b> Click the box to pick a colour for what is selected. The dots under it are colours already in this livery: click one to use it again.' },
    { at: () => q('[data-mode="finish"]'), text: '<b>Spec tab.</b> This is where parts get their finish.', done: () => app.mode === 'finish' },
    { at: () => q('[data-panel="layers"]'), start: toMode('finish'), text: '<b>Spec map.</b> Click a colour on the sheet, or a layer, to pick it. This list shows everything that has a finish of its own; the rest is gloss.' },
    { at: () => q('.finishes') || q('[data-panel="props"]'), start: toMode('finish'), text: '<b>Finish.</b> Pick Gloss, Matte, Chrome and so on for what you picked. The sliders under it fine-tune it.' },
    { at: () => null, text: '<b>That is painting.</b> Hover any tool to see what it does; the line at the bottom says how to use the one you have.' },
  ],
  maps: (app) => {
    const toMap = toMode('map');
    let layers = 0;
    return [
      { at: () => (seen($('btn-empty-template')) ? $('btn-empty-template') : q('#menus button')),
        text: '<b>Open blank template…</b> The map is made from your car\'s template, so open it first.',
        done: () => !!app.doc.template, skip: () => !!app.doc.template },
      { at: () => q('[data-mode="map"]'), text: '<b>Map tab.</b> Where you tell Overspray how the panels fit together on the car.', done: () => app.mode === 'map' },
      { at: () => q('[data-act="browseMaps"]'), start: toMap, text: '<b>Browse maps…</b> Someone may have mapped this car already. Look here first: if there is one, load it and you are done.' },
      { at: () => q('label:has(#m-colours)'), start: toMap, text: '<b>Panel colours.</b> Each panel in its own colour on the sheet. Turn on <b>Panel colours</b> under <b>On the car in iRacing</b> to see the same colours on the car, so you can tell which panel is which.' },
      { at: tool('mpair'), start: toMap, text: '<b>Pair panels.</b> Click a panel, then its twin on the other side of the car. Mirrored paints both.' },
      { at: tool('mcentre'), start: toMap, text: '<b>Centreline.</b> For a panel that crosses the middle, like the bonnet or roof. Click two matching corners, one each side.' },
      { at: tool('mlink'), start: toMap, text: '<b>Link edges.</b> Where two panels meet on the car, so paint carries across. Suggested links show in the list: check each one, then Add link or Skip.' },
      { at: () => q('[data-mode="paint"]'), text: '<b>Paint tab.</b> Now see what the map does.', done: () => app.mode === 'paint' },
      { at: tool('piece'), start: () => { toPaint(); layers = app.doc.layers.length; }, text: '<b>Fill panel (G).</b> Pick it, then click a panel that has a twin, so there is something to mirror.', done: () => app.doc.layers.length > layers },
      { at: () => q('.panel [data-act="mirror"]') || q('[data-panel="props"]'), start: toPaint, text: '<b>Mirrored (Ctrl+M).</b> Press it in Properties. The panel you filled gets painted on its twin too, or across the centreline.' },
      { at: () => null, text: '<b>That is maps.</b> Share map… sends yours to the shared library, so the next person with this car can use it.' },
    ];
  },
};
// in order: the end of one offers the next
export const TUTORIAL_NAMES = { setup: 'Getting set up', painting: 'Painting', maps: 'Maps' };

let stop = null;

export function startTour(app, name = 'setup') {
  if (stop) stop();
  const steps = TUTORIALS[name](app);
  const dim = document.createElement('div'), spot = document.createElement('div'), bubble = document.createElement('div');
  dim.className = 'tour-dim';
  spot.className = 'tour-spot';
  bubble.className = 'tour-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-label', 'Tutorial');
  document.body.append(dim, spot, bubble);
  let k = -1, at = null, armed = false;

  const go = (n) => {
    while (n < steps.length - 1 && n > k && steps[n].skip && steps[n].skip()) n++; // nothing to do there: on to the next
    k = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[k], last = k === steps.length - 1, names = Object.keys(TUTORIAL_NAMES), more = names[names.indexOf(name) + 1];
    if (s.start) s.start();
    armed = !!s.done && !s.done(); // already done (coming Back to it): it waits for Next
    bubble.innerHTML = `<p>${s.text}</p><footer><span>${k + 1} / ${steps.length}</span>${last ? '' : '<button class="btn" data-t="skip">Skip</button>'}` +
      `<button class="btn" data-t="back"${k ? '' : ' disabled'}>Back</button><button class="btn tour" data-t="next">${last ? 'Done' : 'Next'}</button></footer>` +
      (last && more ? `<footer><button class="btn tour" data-t="more">Next tutorial: ${TUTORIAL_NAMES[more]}</button></footer>` : '');
    at = null;
    place();
  };
  // the spot sits on the step's element; the bubble beside it, kept on screen
  const place = () => {
    const el = steps[k].at();
    at = seen(el) ? el : null;
    const r = at ? at.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0, right: innerWidth / 2, bottom: innerHeight / 2 };
    const pad = at ? 4 : 0;
    const x0 = r.left - pad, y0 = r.top - pad, w = r.width + 2 * pad, h = r.height + 2 * pad, c = Math.min(8, w / 2, h / 2);
    Object.assign(spot.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
    spot.hidden = !at;
    // the whole page dark, with a rounded hole where the step's element is
    dim.style.clipPath = at ? `path(evenodd, 'M0 0H${innerWidth}V${innerHeight}H0Z M${x0 + c} ${y0}H${x0 + w - c}A${c} ${c} 0 0 1 ${x0 + w} ${y0 + c}V${y0 + h - c}A${c} ${c} 0 0 1 ${x0 + w - c} ${y0 + h}H${x0 + c}A${c} ${c} 0 0 1 ${x0} ${y0 + h - c}V${y0 + c}A${c} ${c} 0 0 1 ${x0 + c} ${y0}Z')` : '';
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 12;
    let x, y;
    if (!at) { x = (innerWidth - bw) / 2; y = (innerHeight - bh) / 2; }
    else if (r.left < 80) { x = r.right + gap; y = r.top; } // the tool strip: to its right
    else { x = r.left + r.width / 2 - bw / 2; y = r.bottom + bh + gap < innerHeight ? r.bottom + gap : r.top - bh - gap; }
    bubble.style.left = Math.max(8, Math.min(innerWidth - bw - 8, x)) + 'px';
    bubble.style.top = Math.max(8, Math.min(innerHeight - bh - 8, y)) + 'px';
  };
  // ponytail: polls 5 times a second for the step's element and whether it is done; events per step if this ever costs
  const tick = setInterval(() => {
    const s = steps[k];
    if (armed && s.done()) return go(k + 1);
    place();
  }, 200);
  const onClick = (e) => {
    const t = e.target.closest('[data-t]');
    if (!t) return;
    if (t.dataset.t === 'next') return k === steps.length - 1 ? stop() : go(k + 1);
    if (t.dataset.t === 'back') return go(k - 1);
    if (t.dataset.t === 'more') { const names = Object.keys(TUTORIAL_NAMES); return startTour(app, names[names.indexOf(name) + 1]); }
    stop();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); stop(); } };
  bubble.addEventListener('click', onClick);
  addEventListener('keydown', onKey, true);
  stop = () => { clearInterval(tick); removeEventListener('keydown', onKey, true); dim.remove(); spot.remove(); bubble.remove(); stop = null; };
  go(0);
}
