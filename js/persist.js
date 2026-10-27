// What the app keeps in the browser: settings, the autosave, saved projects
// and the library in IndexedDB, plus the iRacing paints folder the user picked
// (File System Access).

// The test copy (/_lab/overspray) shares the live site's origin, so it keeps
// its own database, or testing would overwrite the live autosave.
const DB_NAME = globalThis.location?.pathname.includes('/_lab/') ? 'overspray-lab' : 'overspray';
const STORE = 'kv'; // one key/value store holds everything

// Run fn(store) in one transaction and resolve with what its request returns.
// The database is opened per call and closed after, so an open tab never
// blocks a newer version of the app from upgrading it.
function inStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
const kvSet = (key, value) => inStore('readwrite', (s) => s.put(value, key)).then(() => {});
const kvGet = (key) => inStore('readonly', (s) => s.get(key));

// ---------- settings ----------

export const saveSetting = (key, value) => kvSet('setting:' + key, value);
export const loadSetting = (key) => kvGet('setting:' + key);

// ---------- big records ----------
// The autosave and the library. IndexedDB keeps Blobs as they are, so these
// hold pictures as Blobs, not base64 text.

export const saveBlob = (key, value) => kvSet('blob:' + key, value);
export const loadBlob = (key) => kvGet('blob:' + key);

// ---------- projects ----------
// Each project is stored under its own key; a list of {id, name, updatedAt,
// thumb} sits beside them so the projects window can show every project, with
// a small picture, without reading any of them.

const PROJECT_LIST = 'projects:index';

export const listProjects = async () => (await kvGet(PROJECT_LIST)) ?? [];
export const loadProject = (id) => kvGet('project:' + id);

export async function saveProject(id, meta, data) {
  await kvSet('project:' + id, data);
  const list = await listProjects();
  const old = list.find(p => p.id === id);
  const entry = { ...old, id, ...meta, updatedAt: Date.now() };
  await kvSet(PROJECT_LIST, old ? list.map(p => (p === old ? entry : p)) : [...list, entry]);
}

// ---------- the paints folder ----------

export const fsSupported = () => 'showDirectoryPicker' in window;

// Ask the user for the paints folder and keep it. ok(handle) says whether it
// is the folder wanted; if not, nothing is kept and the answer is null.
export async function pickPaintsFolder(ok = () => true) {
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (!await ok(dir)) return null;
  await kvSet('paintsDir', dir);
  return dir;
}

// The kept folder, or null if there is none. With requestIfNeeded the browser
// is asked for write access again when it has lapsed; that prompt only shows
// during a click or key press, and a refusal gives null. Without it, the
// folder comes back even if access has lapsed.
export async function getPaintsFolder({ requestIfNeeded = false } = {}) {
  const dir = await kvGet('paintsDir');
  if (!dir) return null;
  const mode = { mode: 'readwrite' };
  if (!requestIfNeeded) return dir;
  let state = await dir.queryPermission(mode);
  if (state === 'prompt') state = await dir.requestPermission(mode);
  return state === 'granted' ? dir : null;
}

export async function writeFileToFolder(dir, filename, blob) {
  const file = await dir.getFileHandle(filename, { create: true });
  const out = await file.createWritable();
  try {
    await out.write(blob);
    await out.close();
  } catch (err) { // let go of the file, or the next write can find it still held
    await out.abort().catch(() => {});
    throw err;
  }
}

// The file as a File, or null when it is not there.
export async function readFileFromFolder(dir, filename) {
  try {
    return await (await dir.getFileHandle(filename)).getFile();
  } catch {
    return null;
  }
}

// The folder's overspray-backup subfolder (made if create), or null.
export async function getBackupDir(dir, create = false) {
  return dir.getDirectoryHandle('overspray-backup', { create }).catch(() => null);
}

// The names of the folder's subfolders (the car folders of the paints folder),
// sorted; not recursive.
export async function listSubdirs(dir) {
  const names = [];
  try {
    for await (const [name, entry] of dir.entries()) if (entry.kind === 'directory') names.push(name);
  } catch { /* access taken away part way: keep what was listed */ }
  return names.sort((a, b) => a.localeCompare(b));
}
