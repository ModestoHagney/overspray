// Saving a livery into the iRacing paints folder, with no page elements in
// here so any screen can use it.
//
// (It began as a copy of that part of the original screen's main.js, which
// this fork no longer carries.)

import { renderPaint, renderSpec } from './engine.js';
import { canvasToTGA } from './tga.js';
import * as persist from './persist.js';

export const validCustid = (custid) => /^\d+$/.test(String(custid || '').trim());

// [paintName, specName] for what the doc paints. Custom Number paints use the
// car_num_ prefix; helmets and suits have no spec map (specName = null).
export function paintFilenames(doc, custid) {
  if (doc.target === 'helmet') return [`helmet_${custid}.tga`, null];
  if (doc.target === 'suit') return [`suit_${custid}.tga`, null];
  return [`car_${doc.customNumber ? 'num_' : ''}${custid}.tga`, `car_spec_${custid}.tga`];
}

// iRacing helmets are 1024×1024 — downscale the 2048 sheet for that target;
// car and suit ship at full size.
export function exportPaintCanvas(doc, canvas) {
  if (doc.target !== 'helmet') return canvas;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, 1024, 1024);
  return c;
}

// The car folders in the linked paints folder (the backups folder is not one).
export const carFolders = async (root) => (await persist.listSubdirs(root)).filter(n => n !== 'overspray-backup');
// Is this the paints folder itself, and not one car's folder inside it?
// ponytail: told by having folders in it, or by its name when it is empty.
export const isPaintsFolder = async (handle) => /^paints$/i.test(handle.name) || (await carFolders(handle)).length > 0;

// Which car folder a template is for, going by the template's file name
// ("Hyundai Veloster N" → hyundaivelostern).
// → { car, ranked }: car is the folder when one stands clear of the rest
// (else null); ranked is every folder, nearest first, as [{ folder, score }].
// A folder whose whole name is in the template's name beats any that only
// shares letters with it, the longer the better (ferrari488gt3evo over
// ferrari488gt3); otherwise it is the share of letter pairs they have in common.
export function matchCar(name, folders) {
  const norm = (s) => String(s || '').toLowerCase().replace(/template|iracing|\.psd$/g, '').replace(/[^a-z0-9]/g, '');
  const pairs = (s) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const t = norm(name), tp = pairs(t);
  const ranked = folders.map((folder) => {
    const f = norm(folder), fp = pairs(f);
    let both = 0;
    for (const p of fp) if (tp.has(p)) both++;
    return { folder, score: f.length > 2 && t.includes(f) ? 1 + f.length : fp.size + tp.size ? 2 * both / (fp.size + tp.size) : 0 };
  }).sort((a, b) => b.score - a.score || a.folder.localeCompare(b.folder));
  const [a, b] = ranked;
  const clear = !!a && a.score >= 0.5 && (!b || a.score - b.score >= 0.1);
  return { car: clear ? a.folder : null, ranked };
}

// Where a livery's files go: a car's own folder inside the linked paints
// folder (doc.car); a helmet or a suit goes in the paints folder itself.
// → the folder, or null when there is none to write to
export async function paintsDir(doc, { requestIfNeeded = false } = {}) {
  const root = await persist.getPaintsFolder({ requestIfNeeded }).catch(() => null);
  if (!root || doc.target !== 'car') return root;
  if (!doc.car) return null;
  return root.getDirectoryHandle(doc.car).catch(() => null); // folder gone, or permission pending
}

// Snapshot whatever is in the folder already (e.g. a Trading Paints livery)
// into overspray-backup/ — only if no snapshot exists yet, so repeated saves
// never overwrite the true original.
async function backupOriginals(handle, names) {
  let backed = false;
  for (const name of names) {
    if (!name) continue; // no spec map for this target
    const existing = await persist.readFileFromFolder(handle, name);
    if (!existing) continue;
    const bdir = await persist.getBackupDir(handle, true);
    if (!bdir) return false;
    if (await persist.readFileFromFolder(bdir, name)) continue; // original already kept
    await persist.writeFileToFolder(bdir, name, existing);
    backed = true;
  }
  return backed;
}

// a canvas tainted by a cross-origin image cannot be read back; say so
// plainly instead of surfacing a raw SecurityError
function assertExportable(canvas) {
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
  } catch {
    throw new Error('An imported image is blocking export. Re-import that artwork as a file from your computer, then save again.');
  }
}

// Writes the paint (and, for a car, the spec map) into the linked folder.
// quiet = a live save: never prompts for permission.
// → { ok, paintName, specName, backed, error }
// paint: a function that hands over the paint already made for this doc
// (accurate edges) if the caller still has it, else null: making it again is
// the slow part on a livery of many layers.
// specDoc: the doc the spec map is made from, when it differs from doc (Live
// leaves the "on car" layers out of it: they would stamp Gloss over the finishes).
// One save at a time: a click on Live or Save to iRacing while a live save is
// still writing would open the same file twice, and one of the two fails.
let queue = Promise.resolve();
export function saveToIracing(...args) {
  const run = queue.then(() => writeLivery(...args));
  queue = run.catch(() => {});
  return run;
}

async function writeLivery(doc, custid, { quiet = false, paint: made = null, specDoc = doc } = {}) {
  custid = String(custid || '').trim();
  if (!validCustid(custid)) return { ok: false, error: 'Enter your iRacing customer number first.' };
  try {
    if (doc.target === 'car' && !doc.car) return { ok: false, error: 'Choose the car\'s folder first: File › Car setup.' };
    const handle = await paintsDir(doc, { requestIfNeeded: !quiet });
    if (!handle) return { ok: false, error: 'No iRacing paints folder linked, its permission was lost, or the car\'s folder is not in it.' };
    const [paintName, specName] = paintFilenames(doc, custid);
    const backed = await backupOriginals(handle, [paintName, specName]);
    const paint = exportPaintCanvas(doc, (made && made()) || renderPaint(doc, { linearEdges: true }));
    assertExportable(paint);
    await persist.writeFileToFolder(handle, paintName, canvasToTGA(paint));
    if (specName) {
      const spec = renderSpec(specDoc);
      assertExportable(spec);
      await persist.writeFileToFolder(handle, specName, canvasToTGA(spec, { alpha: true }));
    }
    return { ok: true, paintName, specName, backed };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not write to the folder.' };
  }
}
