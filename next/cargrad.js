// Overspray: the car gradient window. A car gradient is one fade over the
// whole car: its colours sit on a strip that stands for the car, front to
// back, and each panel takes the stretch of the strip its car line covers
// (map.carLines, see regions.js carLineEnds and mirror.js withCarLines).
// Here the colours are dragged along the strip, and the car lines are made:
// with Set panels on, panels are picked on the sheet (click, Shift+click, a
// box), an arrow dragged across them says which way is front to back, and
// their coloured bar under the strip says where they sit on the car. The
// lines belong to the car's map, so every car gradient uses them.

import { carStops, SIZE } from '../js/engine.js';
import { regionById, carLinesWithTwins } from '../js/regions.js';
import { pieceAt } from '../js/mirror.js';
import { pieces } from './map.js';
import { snapAngle } from '../js/shapes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X = '<svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg>';
// the blocks as a CSS gradient, for the strip and the swatches
export const carCss = (blocks) => {
  const s = carStops(blocks);
  return s.length ? `linear-gradient(90deg, ${s.map((o) => `${o.color} ${(o.at * 100).toFixed(2)}%`).join(', ')})` : 'var(--hover)';
};
const clamp = (v) => Math.max(0, Math.min(1, v));
// a bar's colour, the same as its panels' tint on the sheet: the least used one goes to a new line
const LINE_COLOURS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#ffe119', '#469990', '#9a6324', '#808000'];
export const lineColour = (ls) => LINE_COLOURS.reduce((best, c) => {
  const n = ls.filter((cl) => cl.color === c).length;
  return n < best.n ? { c, n } : best;
}, { c: LINE_COLOURS[0], n: Infinity }).c;

export function initCarGradient(app, env) {
  const { screenToDoc, docToScreen, requestDraw } = env;
  let layerId = null;   // the car gradient the window is open for
  let drag = null;      // in the window: a block, a block's end, a bar or a bar's end being dragged
  let picking = false;  // Set panels: the sheet picks panels and takes the arrow
  let picked = [];      // the panels picked, by id
  let sheet = null;     // on the sheet while the mouse is down: { kind: 'arrow' | 'box', from, to, shift }
  let hover = -1;       // the bar the mouse is over: its panels show on the sheet
  let fresh = -1;       // the bar just made: it pulses until it is dragged
  let shown = '';       // what the window last showed, so an undo redraws it
  let eatClick = false; // a drag just ended on a colour box: its click must not open the colour pop-up

  const el = document.createElement('div');
  el.className = 'cgwin';
  el.hidden = true;
  $stage().append(el);
  function $stage() { return document.getElementById('stage'); }

  const map = () => app.doc.regionMap;
  const layer = () => app.doc.layers.find((l) => l.id === layerId && l.car) || null;
  const lines = () => (map() && map().carLines) || [];
  const names = (ids) => ids.map((id) => (regionById(map(), id) || { name: id }).name).join(', ');
  const state = () => JSON.stringify([layer().car, lines(), picking, picked, fresh]);

  function render() {
    const l = layer();
    if (!l) { close(); return; }
    const bl = l.car.blocks, m = map();
    el.innerHTML = `<header><b>Car gradient</b><button class="icon" data-cg="close" title="Close" aria-label="Close">${X}</button></header>` +
      '<div class="cg-ends"><span>Front</span><span>Back</span></div>' +
      `<div class="cg-strip" data-cg="strip" style="background:${carCss(bl)}"></div>` +
      '<div class="cg-blocks">' + bl.map((b, k) => `<div class="cg-block" data-k="${k}" style="left:${b.from * 100}%;width:${(b.to - b.from) * 100}%">` +
        `<input type="color" id="cg-c${k}" data-cgc="${k}" value="${esc(b.color)}" aria-label="Colour ${k + 1}" title="Drag to move it, drag its ends to make it longer or shorter, click to change it. A gap fades, touching colours meet at a sharp edge.">` +
        `<i class="cg-h" data-end="from"></i><i class="cg-h" data-end="to"></i>` +
        (bl.length > 1 ? `<button class="mx" data-cgdrop="${k}" title="Take this colour out" aria-label="Take colour ${k + 1} out">${X}</button>` : '') + '</div>').join('') + '</div>' +
      '<div class="cg-lines">' + lines().map((cl, k) => {
        const lo = Math.min(cl.a, cl.b), hi = Math.max(cl.a, cl.b), on = picked.some((id) => cl.regions.includes(id));
        return `<div class="cg-line${on ? ' on' : ''}${k === fresh ? ' cue' : ''}" data-line="${k}" style="--c:${esc(cl.color || 'var(--accent)')}">` +
          `<div class="cg-track" title="${esc(names(cl.regions))}. Drag to move, drag an end to stretch. Click it to add the picked panels."><span class="cg-bar" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"><i data-lend="${cl.a <= cl.b ? 'a' : 'b'}"></i><i data-lend="${cl.a <= cl.b ? 'b' : 'a'}"></i></span></div>` +
          `<button class="icon" data-lineout="${k}" title="Take ${esc(names(cl.regions))} off" aria-label="Take ${esc(names(cl.regions))} off">${X}</button></div>`;
      }).join('') + '</div>' +
      `<div class="cg-acts"><button class="btn" data-cg="add"${bl.length >= 12 ? ' disabled' : ''}>Add a colour</button>` +
      `<button class="btn${!lines().length && !picking ? ' cue' : ''}" data-cg="pick"${m ? '' : ' disabled title="Load a template first"'} aria-pressed="${picking}" title="Click panels on the sheet (Shift adds, or drag a box round them), then drag an arrow across them front to back">Set panels</button></div>`;
    shown = state();
    // moved by hand and grown since: kept on screen
    if (el.style.top && el.style.top !== 'auto') el.style.top = Math.max(0, Math.min(parseFloat(el.style.top), $stage().clientHeight - el.offsetHeight)) + 'px';
  }

  function open(id) { layerId = id; el.hidden = false; render(); requestDraw(); }
  function close() { el.hidden = true; layerId = null; picking = false; picked = []; sheet = drag = null; hover = fresh = -1; requestDraw(); }
  // after an undo, or a change made elsewhere: the window shows what is there now
  function sync() {
    if (el.hidden || drag) return;
    if (app.mode !== 'paint' || !layer()) { close(); return; }
    picked = map() ? picked.filter((id) => regionById(map(), id)) : [];
    if (state() !== shown) render();
  }

  // ---- the colours ----
  const blocks = () => layer().car.blocks.map((b) => ({ ...b }));
  const setBlocks = (bl, live) => env.setBlocks(layerId, bl, live);
  function addColour() {
    const bl = blocks().sort((a, b) => a.from - b.from);
    // in the middle of the widest gap, a tenth of the car long (or as long as the gap allows)
    let best = { at: 0, w: bl.length ? bl[0].from : 1 };
    bl.forEach((b, i) => { const end = i + 1 < bl.length ? bl[i + 1].from : 1, w = end - b.to; if (w > best.w) best = { at: b.to, w }; });
    const len = Math.min(0.1, best.w * 0.5), mid = best.at + best.w / 2;
    bl.push({ color: env.nextColour(bl.map((b) => b.color)), from: clamp(mid - len / 2), to: clamp(mid + len / 2) });
    setBlocks(bl, false);
    render();
  }

  // ---- the lines ----
  const copy = () => lines().map((cl) => ({ ...cl, regions: [...cl.regions] }));
  // the picked panels get a line of their own, taken out of any they were on
  function makeLine(from, to) {
    const ids = [...picked], old = carLinesWithTwins(map()).filter((cl) => ids.some((id) => cl.regions.includes(id)));
    // all from one line: its stretch of the car is a good start, otherwise the whole car
    const { a, b } = old.length === 1 ? old[0] : { a: 0, b: 1 };
    const ls = copy().map((cl) => ({ ...cl, regions: cl.regions.filter((id) => !ids.includes(id)) })).filter((cl) => cl.regions.length);
    ls.push({ regions: ids, from, to, a, b, color: lineColour(ls) });
    fresh = ls.length - 1;
    env.setLines(ls, false, `Drag the new bar to where ${names(ids)} ${ids.length > 1 ? 'sit' : 'sits'} on the car`);
    render();
  }
  // picked panels that are only some of a bar's: dragging that bar gives them a bar of their own, so each can be matched alone
  function splitOff(k) {
    const cl = lines()[k], ids = picked.filter((id) => cl.regions.includes(id));
    if (!ids.length || ids.length === cl.regions.length) return k;
    const ls = copy();
    ls[k].regions = ls[k].regions.filter((id) => !ids.includes(id));
    ls.splice(k + 1, 0, { ...cl, regions: ids, color: lineColour(ls) });
    env.setLines(ls, false);
    render();
    return k + 1;
  }
  // a click on a bar: the picked panels join it, leaving any other they were on
  function join(k) {
    const cl = lines()[k], ids = picked.filter((id) => !cl.regions.includes(id));
    if (!ids.length) { render(); return; }
    const ls = copy().map((x, i) => (i === k ? { ...x, regions: [...x.regions, ...ids] } : { ...x, regions: x.regions.filter((id) => !ids.includes(id)) }));
    fresh = -1;
    env.setLines(ls.filter((x) => x.regions.length), false, `${names(ids)} added to ${names(cl.regions)}`);
    render();
  }
  function unpick() {
    const ids = picked, ls = copy().map((cl) => ({ ...cl, regions: cl.regions.filter((id) => !ids.includes(id)) })).filter((cl) => cl.regions.length);
    fresh = -1;
    env.setLines(ls, false, `Car line taken off ${names(ids)}`);
    render();
  }

  // ---- dragging in the window ----
  const frac = (e) => { const r = el.querySelector('.cg-strip').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width); };
  // an end lands on another colour's end when it comes within 6 px of it, so two can be made to touch
  function snapEnd(v, bl, skip) {
    const w = el.querySelector('.cg-strip').getBoundingClientRect().width || 1;
    for (const [i, b] of bl.entries()) for (const e of [b.from, b.to]) if (i !== skip && Math.abs(e - v) * w < 6) return e;
    return v;
  }
  function showBar(k, cl) {
    const lo = Math.min(cl.a, cl.b), hi = Math.max(cl.a, cl.b), bar = el.querySelector(`[data-line="${k}"] .cg-bar`);
    bar.style.left = lo * 100 + '%'; bar.style.width = (hi - lo) * 100 + '%';
  }
  el.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (e.button !== 0 || t.closest('button')) return;
    if (t.closest('header')) { // moved by its title bar, off whatever it covers
      e.preventDefault();
      const r = el.getBoundingClientRect(), box = $stage().getBoundingClientRect();
      drag = { kind: 'win', dx: e.clientX - r.left, dy: e.clientY - r.top, box };
      el.setPointerCapture(e.pointerId);
      return;
    }
    const track = t.closest('.cg-track');
    if (track) {
      e.preventDefault();
      const k = +track.closest('[data-line]').dataset.line, cl = lines()[k], end = t.closest('[data-lend]');
      if (fresh !== k) fresh = -1;
      drag = { kind: t.closest('.cg-bar') ? (end ? 'lend' : 'lmove') : 'lrow', k, end: end && end.dataset.lend, x0: frac(e), a: cl.a, b: cl.b, moved: false, px: e.clientX };
      el.setPointerCapture(e.pointerId);
      return;
    }
    const blk = t.closest('.cg-block');
    if (!blk) return;
    const k = +blk.dataset.k, b = layer().car.blocks[k], h = t.closest('.cg-h');
    // held from the first move, not the press: a plain click must still reach the colour box
    drag = { kind: h ? h.dataset.end : 'move', k, x0: frac(e), from: b.from, to: b.to, moved: false, px: e.clientX, id: e.pointerId };
  });
  el.addEventListener('pointermove', (e) => {
    const row = e.target.closest && e.target.closest('[data-line]'), h = row ? +row.dataset.line : -1;
    if (!drag && h !== hover) { hover = h; requestDraw(); }
    if (!drag) return;
    if (drag.kind === 'win') {
      const { box } = drag;
      el.style.left = Math.max(0, Math.min(box.width - el.offsetWidth, e.clientX - box.left - drag.dx)) + 'px';
      el.style.top = Math.max(0, Math.min(box.height - el.offsetHeight, e.clientY - box.top - drag.dy)) + 'px';
      el.style.bottom = 'auto'; el.style.transform = 'none';
      return;
    }
    if (drag.kind === 'lrow') return;
    if (drag.kind === 'lend' || drag.kind === 'lmove') {
      if (!drag.moved && Math.abs(e.clientX - drag.px) < 3) return;
      if (!drag.moved) drag.k = splitOff(drag.k); // only some of its panels picked: they get a bar of their own
      drag.moved = true;
      const ls = copy(), cl = ls[drag.k];
      if (drag.kind === 'lend') cl[drag.end] = frac(e);
      else { // the whole bar, kept on the strip
        const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b), d = Math.max(-lo, Math.min(1 - hi, frac(e) - drag.x0));
        cl.a = drag.a + d; cl.b = drag.b + d;
      }
      env.setLines(ls, true);
      showBar(drag.k, cl);
      hover = drag.k;
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.px) < 3) return;
    if (!drag.moved) el.setPointerCapture(drag.id);
    drag.moved = true;
    const bl = blocks(), b = bl[drag.k], d = frac(e) - drag.x0, len = drag.to - drag.from;
    if (drag.kind === 'move') {
      let from = Math.max(0, Math.min(1 - len, drag.from + d));
      const sf = snapEnd(from, bl, drag.k), st = snapEnd(from + len, bl, drag.k);
      if (sf !== from) from = sf; else if (st !== from + len) from = st - len;
      b.from = from; b.to = from + len;
    } else if (drag.kind === 'from') b.from = Math.min(snapEnd(clamp(drag.from + d), bl, drag.k), b.to);
    else b.to = Math.max(snapEnd(clamp(drag.to + d), bl, drag.k), b.from);
    const blk = el.querySelector(`.cg-block[data-k="${drag.k}"]`);
    blk.style.left = b.from * 100 + '%'; blk.style.width = (b.to - b.from) * 100 + '%';
    el.querySelector('.cg-strip').style.background = carCss(bl);
    setBlocks(bl, true); // the sheet follows as it moves
  });
  el.addEventListener('pointerleave', () => { if (!drag && hover >= 0) { hover = -1; requestDraw(); } });
  const up = () => {
    const d = drag;
    if (!d) return;
    drag = null;
    if (d.kind === 'win') return;
    if (d.kind === 'lend' || d.kind === 'lmove' || d.kind === 'lrow') {
      if (!d.moved) { join(d.k); return; }
      if (d.moved) { if (fresh === d.k) fresh = -1; env.setLines(copy(), false); }
      render();
      return;
    }
    if (d.moved) { eatClick = true; setBlocks(blocks(), false); render(); }
  };
  window.addEventListener('pointerup', up); // let go anywhere
  window.addEventListener('pointercancel', up);
  // ahead of the colour pop-up's own listener: a drag that ends on a colour box is not a click on it
  window.addEventListener('click', (e) => { if (eatClick && el.contains(e.target)) { eatClick = false; e.stopPropagation(); e.preventDefault(); } else eatClick = false; }, true);
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.cgc;
    if (k === undefined) return;
    e.stopPropagation();
    const bl = blocks();
    bl[+k].color = e.target.value;
    el.querySelector('.cg-strip').style.background = carCss(bl);
    setBlocks(bl, true);
  });
  el.addEventListener('change', (e) => { if (e.target.dataset.cgc !== undefined) { e.stopPropagation(); setBlocks(blocks(), false); } });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cg === 'close') return close();
    if (t.dataset.cg === 'add') return addColour();
    if (t.dataset.cg === 'pick') { picking = !picking; picked = []; render(); requestDraw(); return; }
    if (t.dataset.cgdrop !== undefined) { setBlocks(blocks().filter((_, i) => i !== +t.dataset.cgdrop), false); render(); return; }
    if (t.dataset.lineout !== undefined) {
      const k = +t.dataset.lineout, gone = lines()[k];
      fresh = -1; hover = -1;
      env.setLines(lines().filter((_, i) => i !== k), false, `Car line taken off ${names(gone.regions)}`);
      render();
    }
  });

  // ---- the sheet, while Set panels is on ----
  const round = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const at = (s) => round(screenToDoc(s.x, s.y));
  // the end of a line's arrow within reach of a screen point
  function endAt(s) {
    let best = null;
    lines().forEach((cl, k) => ['to', 'from'].forEach((end) => {
      const q = docToScreen(cl[end].x, cl[end].y), d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d < 9 && (!best || d < best.d)) best = { k, end, d };
    }));
    return best;
  }
  function down(e, s) {
    const p = at(s), r = pieceAt(map(), p.x, p.y), hit = endAt(s);
    if (hit) { sheet = { kind: 'end', k: hit.k, end: hit.end, moved: false }; return; }
    // from a picked panel: the arrow across them (or, let go where it started, a click); anywhere else: a click or a box
    sheet = { kind: r && picked.includes(r.id) ? 'arrow' : 'box', from: p, to: { ...p }, shift: e.shiftKey, r };
    requestDraw();
  }
  function move(e, s) {
    if (!sheet) return;
    const p = at(s);
    if (sheet.kind === 'end') { // Shift keeps it to 15° steps, as turning does
      const ls = copy(), cl = ls[sheet.k], other = cl[sheet.end === 'to' ? 'from' : 'to'];
      cl[sheet.end] = round(e.shiftKey ? snapAngle(other, p, 15) : p);
      sheet.moved = true;
      env.setLines(ls, true);
      return;
    }
    sheet.to = sheet.kind === 'arrow' && e.shiftKey ? round(snapAngle(sheet.from, p, 15)) : p;
    requestDraw();
  }
  function upSheet() {
    const L = sheet;
    sheet = null;
    if (!L) return;
    if (L.kind === 'end') { if (L.moved) env.setLines(copy(), false); return; }
    const a = docToScreen(L.from.x, L.from.y), b = docToScreen(L.to.x, L.to.y), click = Math.hypot(b.x - a.x, b.y - a.y) < 6;
    if (L.kind === 'arrow' && !click) { makeLine(L.from, L.to); requestDraw(); return; }
    let ids;
    if (click) ids = L.r ? [L.r.id] : [];
    else { // a box: the panels whose middle is inside it
      const x0 = Math.min(L.from.x, L.to.x), x1 = Math.max(L.from.x, L.to.x), y0 = Math.min(L.from.y, L.to.y), y1 = Math.max(L.from.y, L.to.y);
      ids = pieces(map()).filter((r) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; }).map((r) => r.id);
    }
    if (L.shift) picked = click && picked.includes(ids[0]) ? picked.filter((id) => id !== ids[0]) : [...new Set([...picked, ...ids])];
    else picked = ids;
    render();
    requestDraw();
  }
  function key(e) {
    if (el.hidden) return false;
    if (picking && picked.length && (e.key === 'Delete' || e.key === 'Backspace')) { unpick(); return true; }
    if (e.key !== 'Escape' || !(picking || sheet)) return false;
    if (sheet) sheet = null;
    else if (picked.length) picked = [];
    else picking = false;
    render(); requestDraw();
    return true;
  }

  // the panels on the sheet: while Set panels is on, each in its bar's colour, the picked ones
  // lit, the ones with no bar hatched; otherwise only the bar the mouse is over
  function drawOverlay(ctx, accent) {
    if (el.hidden || !map()) return;
    const trace = (r) => { ctx.beginPath(); r.points.forEach((q, i) => { const s = docToScreen(q.x, q.y); ctx[i ? 'lineTo' : 'moveTo'](s.x, s.y); }); ctx.closePath(); };
    const tint = (r, col, alpha, w) => {
      if (!r || !r.points) return;
      trace(r); ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    };
    const arrow = (L, col, w) => {
      const A = docToScreen(L.from.x, L.from.y), B = docToScreen(L.to.x, L.to.y), t = Math.atan2(B.y - A.y, B.x - A.x);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      for (const k of [-1, 1]) { ctx.moveTo(B.x, B.y); ctx.lineTo(B.x - 12 * Math.cos(t + k * 0.45), B.y - 12 * Math.sin(t + k * 0.45)); }
      ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.lineWidth = w + 1; ctx.stroke(); ctx.lineCap = 'butt'; // one solid colour, like its bar
    };
    const ls = lines(), m = map(), all = carLinesWithTwins(m), twins = all.slice(ls.length);
    // a paired panel following its twin's line: dashed, as it is set from the other side
    const twin = (cl) => {
      ctx.setLineDash([6, 4]);
      tint(regionById(m, cl.regions[0]), cl.color || accent, 0.18, 1.5);
      arrow(cl, cl.color || accent, 1.5);
      ctx.setLineDash([]);
    };
    ctx.save();
    if (picking) {
      for (const cl of ls) for (const id of cl.regions) tint(regionById(m, id), cl.color || accent, 0.3, 1.5);
      twins.forEach(twin);
      for (const r of pieces(m)) {
        if (!r.points || all.some((cl) => cl.regions.includes(r.id))) continue;
        trace(r); ctx.save(); ctx.clip();
        const a = docToScreen(r.x, r.y), b = docToScreen(r.x + r.w, r.y + r.h);
        ctx.beginPath();
        for (let x = a.x - (b.y - a.y); x < b.x; x += 9) { ctx.moveTo(x, b.y); ctx.lineTo(x + (b.y - a.y), a.y); }
        ctx.strokeStyle = 'rgba(16, 17, 20, .45)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      }
      for (const id of picked) tint(regionById(m, id), accent, 0.35, 3);
      ls.forEach((cl) => {
        arrow(cl, cl.color || accent, 2);
        for (const q of [cl.from, cl.to]) { // its ends can be dragged
          const s = docToScreen(q.x, q.y);
          ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = cl.color || accent; ctx.lineWidth = 2.5; ctx.stroke();
        }
      });
      if (!picked.length && !sheet) { // where to start: the sheet lights up
        const a = docToScreen(0, 0), b = docToScreen(SIZE, SIZE);
        ctx.setLineDash([10, 6]); ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8); ctx.setLineDash([]);
      }
    } else if (ls[hover]) {
      for (const id of ls[hover].regions) tint(regionById(m, id), ls[hover].color || accent, 0.3, 2);
      arrow(ls[hover], ls[hover].color || accent, 2);
      twins.filter((cl) => cl.of === hover).forEach(twin);
    }
    if (sheet && sheet.kind === 'arrow') arrow(sheet, accent, 3);
    if (sheet && sheet.kind === 'box') {
      const a = docToScreen(sheet.from.x, sheet.from.y), b = docToScreen(sheet.to.x, sheet.to.y);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  return {
    open, close, sync, key, drawOverlay,
    isOpen: () => !el.hidden,
    drawing: () => picking && !el.hidden,
    down, move, up: upSheet,
  };
}
