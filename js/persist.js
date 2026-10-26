// Persistence: IndexedDB autosave + File System Access directory handle storage.

// The test copy (/_lab/overspray) shares the live site's origin, so it keeps
// its own database, or testing would overwrite the live autosave.
const DB_NAME = globalThis.location?.pathname.includes('/_lab/') ? 'overspray-lab' : 'overspray';
const DB_VERSION = 1;
const STORE = 'kv';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function kvGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// ---------- autosave ----------

export const saveSetting = (key, value) => kvSet('setting:' + key, value);
export const loadSetting = (key) => kvGet('setting:' + key);

// ---------- blob records ----------
// Large records (the autosave, the library). IndexedDB stores Blobs
// structurally, so values can carry them directly instead of base64 data URLs.

export const saveBlob = (key, value) => kvSet('blob:' + key, value);
export const loadBlob = (key) => kvGet('blob:' + key);

// ---------- projects ----------
// Index entries are {id, name, updatedAt, thumb} — thumb is a small dataURL
// kept in the index so the project browser lists without loading full docs.

const PROJECTS_INDEX = 'projects:index';

export const listProjects = async () => (await kvGet(PROJECTS_INDEX)) || [];

export async function saveProject(id, meta, data) {
  await kvSet('project:' + id, data);
  const index = await listProjects();
  const i = index.findIndex(p => p.id === id);
  const entry = { ...(i === -1 ? {} : index[i]), id, ...meta, updatedAt: Date.now() };
  if (i === -1) index.push(entry); else index[i] = entry;
  await kvSet(PROJECTS_INDEX, index);
}

export const loadProject = (id) => kvGet('project:' + id);

// ---------- File System Access ----------

export const fsSupported = () => 'showDirectoryPicker' in window;

// ok(handle): is this the folder wanted? One that is not is not kept (→ null).
export async function pickPaintsFolder(ok = () => true) {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (!await ok(handle)) return null;
  await kvSet('paintsDir', handle);
  return handle;
}

// Returns a usable handle or null. Re-requests permission if needed
// (must be called from a user gesture for the permission prompt to show).
export async function getPaintsFolder({ requestIfNeeded = false } = {}) {
  const handle = await kvGet('paintsDir');
  if (!handle) return null;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'prompt' && requestIfNeeded) {
    perm = await handle.requestPermission({ mode: 'readwrite' });
  }
  return perm === 'granted' ? handle : (requestIfNeeded ? null : handle);
}

export async function writeFileToFolder(dirHandle, filename, blob) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) { // let go of the file, or the next write can find it still held
    await writable.abort().catch(() => {});
    throw err;
  }
}

// Returns the File or null if it doesn't exist.
export async function readFileFromFolder(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    return await fh.getFile();
  } catch {
    return null;
  }
}

export async function getBackupDir(dirHandle, create = false) {
  try {
    return await dirHandle.getDirectoryHandle('overspray-backup', { create });
  } catch {
    return null;
  }
}

// All subdirectory names (non-recursive): the car folders of the paints folder.
export async function listSubdirs(dirHandle) {
  const names = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') names.push(entry.name);
    }
  } catch { /* permission revoked mid-iteration */ }
  return names.sort((a, b) => a.localeCompare(b));
}
