// The shared map library: one map per car in a public GitHub repo, at
// cars/<iRacing car folder>.json. Anyone reads it with no login; people add
// maps by pull request (Share opens GitHub's upload page, which makes one for
// them); admins, anyone with write access to the repo, review them here with
// a GitHub key of their own. No page elements in here.

export const REPO = 'ModestoHagney/overspray-maps';
const API = `https://api.github.com/repos/${REPO}`;
export const uploadPage = `https://github.com/${REPO}/upload/main/cars`;

// the file a car's map goes in: its iRacing car folder, or failing that the
// template's name, made safe for a file name
export const mapFileName = (car, fallback) =>
  ((car || fallback || 'car').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'car') + '.json';

async function gh(path, key, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const why = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? 'GitHub did not accept that key'
      : res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0' ? 'GitHub says too many requests: try again in an hour'
      : why.message || `GitHub said ${res.status}`);
  }
  return res.status === 204 ? true : res.json();
}

const text = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch the map (${res.status})`);
  return res.text();
};

// → [{ name (file), url (raw) }], A to Z
export async function listMaps() {
  const files = (await gh('/contents/cars')) || [];
  return files.filter(f => f.type === 'file' && f.name.endsWith('.json'))
    .map(f => ({ name: f.name, url: f.download_url }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export const fetchMap = text;

// ---------- review (admins) ----------

// → the GitHub login, when the key can write to the repo; throws otherwise
export async function signIn(key) {
  const [me, repo] = await Promise.all([gh('https://api.github.com/user', key), gh('', key)]);
  if (!me || !repo) throw new Error('that key cannot see the maps repo');
  if (!(repo.permissions && repo.permissions.push)) throw new Error(`${me.login} cannot approve maps: they need write access to ${REPO}`);
  return me.login;
}

// open pull requests that change a car's map → [{ number, title, by, file, url }]
export async function openReviews(key) {
  const prs = (await gh('/pulls?state=open&per_page=50', key)) || [];
  const out = [];
  for (const pr of prs) {
    const files = (await gh(`/pulls/${pr.number}/files`, key)) || [];
    const f = files.find(x => /^cars\/[^/]+\.json$/.test(x.filename) && x.status !== 'removed');
    // raw_url goes by way of github.com, which a page can't read from: the
    // file straight from raw.githubusercontent.com, at the pull request's head
    if (f && pr.head.repo) out.push({ number: pr.number, title: pr.title, by: pr.user.login, file: f.filename, url: `https://raw.githubusercontent.com/${pr.head.repo.full_name}/${pr.head.sha}/${f.filename}` });
  }
  return out;
}

// the pull request's map and the one on main now (null for a new car) → { next, now }
export async function reviewMaps(key, pr) {
  const [next, cur] = await Promise.all([text(pr.url), gh(`/contents/${pr.file}?ref=main`, key)]);
  return { next, now: cur ? await text(cur.download_url) : null };
}

// merge it; then, when the admin changed the map, write their fixes on top
export async function approve(key, pr, fixed) {
  await gh(`/pulls/${pr.number}/merge`, key, { method: 'PUT', body: JSON.stringify({ merge_method: 'squash' }) });
  if (fixed === null) return;
  const cur = await gh(`/contents/${pr.file}?ref=main`, key);
  let bin = '';
  for (const b of new TextEncoder().encode(fixed)) bin += String.fromCharCode(b);
  const content = btoa(bin);
  await gh(`/contents/${pr.file}`, key, { method: 'PUT', body: JSON.stringify({ message: `Fixes to ${pr.file} from review of #${pr.number}`, content, sha: cur && cur.sha, branch: 'main' }) });
}

export const reject = (key, pr) => gh(`/pulls/${pr.number}`, key, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
