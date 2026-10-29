// Overspray: the colour pop-up. It is the app's own, opened from
// any colour box, because it has to hold what the browser's cannot: the
// colours already in the livery and the ones saved with it.
//
// The box it is opened from stays an ordinary <input type="color">. Every
// change is written to that box and announced with the events the browser's
// own pop-up would send ('input' while choosing, 'change' once done), so
// nothing else in the app needs to know which pop-up it was.

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// '#1a6cff', '1A6CFF' or the short '#fff' → '#rrggbb', or null for anything else (a half-typed value, say)
export function parseHex(v) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
}
// → [hue 0–360, saturation 0–1, value 0–1]: where the colour sits on the square and the hue bar
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}
export function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))); };
  return rgbToHex(f(5), f(3), f(1));
}

const DROPPER = '<svg viewBox="0 0 20 20"><path d="M4 16v-2.5l6.5-6.5 2.5 2.5L6.5 16z"/><path d="m9.5 6 4.5 4.5"/><path d="m12 7.5 2.2-2.2a1.6 1.6 0 0 1 2.3 2.3l-2.2 2.2"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// colours(): → { saved: [{ name, color }], used: ['#rrggbb'] }, asked for each time the pop-up opens
// settled(): the colour was let go of (a drag ended, a value typed) while the pop-up stays open
// → { open(input), close() }
export function initPicker({ colours, settled = () => {} }) {
  const el = document.createElement('div');
  el.className = 'cpick'; el.hidden = true;
  el.innerHTML = '<div class="cp-dots" data-cp="dots"></div>' +
    '<div class="cp-sv" data-cp="sv"><i></i></div>' +
    '<input class="cp-hue" data-cp="hue" type="range" min="0" max="360" step="1" aria-label="Hue">' +
    `<div class="cp-row"><button type="button" class="icon" data-cp="drop" title="Pick a colour from anywhere on the screen" aria-label="Pick a colour from the screen">${DROPPER}</button>` +
    '<i class="cp-now" data-cp="now"></i><span class="cp-val" data-cp="val"></span>' +
    '<button type="button" class="cp-mode" data-cp="mode" title="Switch between HEX and RGB"></button></div>';
  const part = (k) => el.querySelector(`[data-cp="${k}"]`);
  part('drop').hidden = !('EyeDropper' in window); // Chrome and Edge have it

  let forId = null;                  // id of the box it was opened from (found again each time: panels are redrawn)
  let h = 0, s = 0, v = 0, hex = '#000000', changed = false;
  let mode = 'hex';
  try { if (localStorage.getItem('next-colour-mode') === 'rgb') mode = 'rgb'; } catch { /* hex */ }

  function drawBoxes() {
    part('mode').textContent = mode === 'hex' ? 'HEX' : 'RGB';
    part('val').innerHTML = mode === 'hex'
      ? '<input data-cp="hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex">'
      : ['Red', 'Green', 'Blue'].map((n, i) => `<input data-cp="rgb" data-i="${i}" type="number" min="0" max="255" step="1" aria-label="${n}">`).join('');
  }
  // the pop-up as the colour now stands; a box that is being typed in is left alone
  function draw() {
    part('sv').style.setProperty('--hue', h);
    const knob = part('sv').firstChild;
    knob.style.left = s * 100 + '%'; knob.style.top = (1 - v) * 100 + '%';
    part('hue').value = Math.round(h);
    part('now').style.background = hex;
    const rgb = hexToRgb(hex);
    for (const box of part('val').children) if (box !== document.activeElement) box.value = mode === 'hex' ? hex.toUpperCase() : rgb[+box.dataset.i];
    for (const d of part('dots').children) d.classList.toggle('on', d.dataset.c === hex);
  }
  // the colour changed here: written to the box it was opened from
  function give() {
    changed = true;
    const t = forId && document.getElementById(forId);
    if (t) { t.value = hex; t.dispatchEvent(new Event('input', { bubbles: true })); }
    draw();
  }
  const fromSquare = () => { hex = hsvToHex(h, s, v); give(); };
  // a colour given whole (typed, a dot, the eyedropper). A grey has no hue of its own: the bar stays where it was.
  function take(c) {
    const [nh, ns, nv] = hexToHsv(c);
    if (ns && nv) h = nh;
    s = ns; v = nv; hex = c;
    give();
  }
  // done: the box says so once, as the browser's own pop-up does when it closes
  const done = (id, did) => { const t = did && id && document.getElementById(id); if (t) t.dispatchEvent(new Event('change', { bubbles: true })); };
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    const id = forId, did = changed;
    forId = null;
    return () => done(id, did);
  }

  function open(t) {
    close()?.();
    (t.closest('dialog') || document.body).appendChild(el); // inside an open dialog, or it would lie beneath it
    forId = t.id; changed = false;
    hex = parseHex(t.value) || '#000000';
    [h, s, v] = hexToHsv(hex);
    const { saved = [], used = [] } = colours();
    const dots = [...saved.map((c) => [c.color, c.name]), ...used.filter((c) => !saved.some((x) => x.color === c)).map((c) => [c, c.toUpperCase()])];
    part('dots').innerHTML = dots.map(([c, name]) => `<button type="button" class="dot" data-c="${esc(c)}" style="background:${esc(c)}" title="${esc(name)}" aria-label="${esc(name)}"></button>`).join('');
    part('dots').hidden = !dots.length;
    drawBoxes();
    el.hidden = false;
    const r = t.getBoundingClientRect(); // under the box, and wholly inside the window
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8)) + 'px';
    draw();
  }

  // the square: across is how strong the colour is, down is how dark
  const sv = part('sv');
  const squareAt = (e) => {
    const r = sv.getBoundingClientRect();
    s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    fromSquare();
  };
  sv.addEventListener('pointerdown', (e) => { sv.setPointerCapture(e.pointerId); squareAt(e); e.preventDefault(); });
  sv.addEventListener('pointermove', (e) => { if (sv.hasPointerCapture(e.pointerId)) squareAt(e); });

  el.addEventListener('input', (e) => {
    const t = e.target;
    e.stopPropagation(); // the app listens for 'input' from its own boxes, not from these
    if (t.dataset.cp === 'hue') { h = +t.value; fromSquare(); return; }
    if (t.dataset.cp === 'hex') { const c = parseHex(t.value); if (c) { take(c); settled(); } return; }
    if (t.dataset.cp === 'rgb') {
      const boxes = [...part('val').children].map((b) => +b.value);
      if (boxes.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) { take(rgbToHex(...boxes)); settled(); }
    }
  });
  // a drag on the square or the hue bar let go of, or the hue bar moved by its keys
  el.addEventListener('pointerup', () => { if (changed && forId) settled(); });
  el.addEventListener('change', () => { if (changed && forId) settled(); });
  el.addEventListener('change', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.c) { take(b.dataset.c); close()?.(); return; } // a colour of the livery: taken, and done
    if (b.dataset.cp === 'mode') {
      mode = mode === 'hex' ? 'rgb' : 'hex';
      try { localStorage.setItem('next-colour-mode', mode); } catch { /* fine */ }
      drawBoxes(); draw();
      return;
    }
    if (b.dataset.cp === 'drop') new window.EyeDropper().open().then((r) => { const c = parseHex(r.sRGBHex); if (c && forId) take(c); }).catch(() => { /* Esc: nothing picked */ });
  });
  // A press outside closes it, and does nothing else: it does not also
  // select, deselect or draw on what is under it. A press on another colour
  // box goes through, so that box opens at once. The box hears 'change' only
  // after that press has become a click: a panel redrawn in between would
  // swallow the click.
  document.addEventListener('pointerdown', (e) => {
    if (el.hidden || el.contains(e.target)) return;
    const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
    const other = e.target instanceof HTMLInputElement && e.target.type === 'color';
    if (!other) { eat(e); addEventListener('click', eat, true); }
    const tell = close();
    addEventListener('pointerup', (u) => {
      if (!other) eat(u);
      setTimeout(() => { removeEventListener('click', eat, true); tell?.(); }, 0); // the click comes before this
    }, { once: true, capture: true });
  }, true);
  // While it is open the keys are its own: Esc and Enter close it, and nothing
  // typed here reaches the app's shortcuts (Delete would remove a layer).
  document.addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape' || (e.key === 'Enter' && el.contains(e.target))) { e.preventDefault(); e.stopPropagation(); close()?.(); return; }
    if (!e.ctrlKey && !e.metaKey && !el.contains(e.target)) e.stopPropagation();
  }, true);

  return { open, close: () => close()?.() };
}
