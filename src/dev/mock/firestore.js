// Demo režim: jednoduchá simulace Firestore v paměti (+ localStorage).
// Pokrývá jen tu část API, kterou Pivní Dungeon používá. Nikdy se nebalí do produkce
// (alias v vite.config.js platí jen pro `--mode demo`).
import { seed } from './seed.js';

const STORE_KEY = 'pd-demo-db';

// ── Sentinely a typy ─────────────────────────────────────────────────────
class Sentinel { constructor(kind, value) { this.kind = kind; this.value = value; } }
export const increment = (n) => new Sentinel('inc', n);
export const arrayUnion = (...v) => new Sentinel('union', v);
export const arrayRemove = (...v) => new Sentinel('remove', v);
export const serverTimestamp = () => new Sentinel('ts');
export const deleteField = () => new Sentinel('del');

export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  valueOf() { return this.toMillis(); }
}

// ── Úložiště ─────────────────────────────────────────────────────────────
let docs = new Map(); // path -> plain data (Timestamp uložen jako {__ts: ms})

function encode(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function decode(v) {
  if (v && typeof v === 'object' && '__ts' in v && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...docs.entries()])); } catch (_) { /* ignore */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { docs = new Map(JSON.parse(raw)); return; }
  } catch (_) { /* ignore */ }
  docs = new Map();
  for (const [path, data] of Object.entries(seed())) docs.set(path, encode(data));
  persist();
}
export function __resetDemo() { try { localStorage.removeItem(STORE_KEY); } catch (_) {} load(); }

// ── Reference ────────────────────────────────────────────────────────────
let autoId = 0;
const newId = () => 'demo' + Date.now().toString(36) + (autoId++).toString(36);

function makeColl(path) {
  const segs = path.split('/');
  return {
    type: 'collection', path, id: segs.at(-1),
    get parent() { return segs.length > 1 ? makeDoc(segs.slice(0, -1).join('/')) : null; },
  };
}
function makeDoc(path) {
  const segs = path.split('/');
  return { type: 'document', path, id: segs.at(-1), get parent() { return makeColl(segs.slice(0, -1).join('/')); } };
}

export function getFirestore() { if (!docs.size) load(); return { type: 'firestore' }; }
export function initializeFirestore() { return getFirestore(); }

export function collection(base, ...segs) {
  const prefix = base && base.type === 'document' ? base.path + '/' : '';
  return makeColl(prefix + segs.join('/'));
}
export function doc(base, ...segs) {
  if (base && base.type === 'collection') return makeDoc(base.path + '/' + (segs.length ? segs.join('/') : newId()));
  if (base && base.type === 'document') return makeDoc(base.path + '/' + segs.join('/'));
  return makeDoc(segs.join('/'));
}
export function collectionGroup(_db, id) { return { type: 'group', id }; }

// ── Dotazy ───────────────────────────────────────────────────────────────
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const startAfter = (snap) => ({ kind: 'startAfter', snap });
export function query(ref, ...constraints) {
  const base = ref.type === 'query' ? ref : { type: 'query', ref, constraints: [] };
  return { type: 'query', ref: base.ref, constraints: [...base.constraints, ...constraints] };
}

function getPath(obj, field) { return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function cmp(a, b) {
  const av = a instanceof Timestamp ? a.toMillis() : a;
  const bv = b instanceof Timestamp ? b.toMillis() : b;
  if (av === bv) return 0;
  if (av === undefined || av === null) return -1;
  if (bv === undefined || bv === null) return 1;
  return av < bv ? -1 : 1;
}
function matches(data, w) {
  const v = getPath(data, w.field);
  switch (w.op) {
    case '==': return cmp(v, w.value) === 0 && v !== undefined;
    case '!=': return cmp(v, w.value) !== 0;
    case '<': return v !== undefined && cmp(v, w.value) < 0;
    case '<=': return v !== undefined && cmp(v, w.value) <= 0;
    case '>': return v !== undefined && cmp(v, w.value) > 0;
    case '>=': return v !== undefined && cmp(v, w.value) >= 0;
    case 'in': return w.value.some((x) => cmp(v, x) === 0);
    case 'array-contains': return Array.isArray(v) && v.some((x) => cmp(x, w.value) === 0);
    default: throw new Error('demo: nepodporovaný operátor ' + w.op);
  }
}
function snapOf(path) {
  const raw = docs.get(path);
  const ref = makeDoc(path);
  return { id: ref.id, ref, exists: () => raw !== undefined, data: () => (raw === undefined ? undefined : decode(structuredClone(raw))) };
}
function runQuery(q) {
  const ref = q.type === 'query' ? q.ref : q;
  const cons = q.type === 'query' ? q.constraints : [];
  let paths = [...docs.keys()].filter((p) => {
    const segs = p.split('/');
    if (ref.type === 'group') return segs.length >= 2 && segs.at(-2) === ref.id;
    return p.startsWith(ref.path + '/') && segs.length === ref.path.split('/').length + 1;
  });
  let snaps = paths.map(snapOf);
  for (const c of cons.filter((c) => c.kind === 'where')) snaps = snaps.filter((s) => matches(s.data(), c));
  const orders = cons.filter((c) => c.kind === 'orderBy');
  for (const o of orders) snaps = snaps.filter((s) => getPath(s.data(), o.field) !== undefined);
  if (orders.length) {
    snaps.sort((a, b) => {
      for (const o of orders) {
        const r = cmp(getPath(a.data(), o.field), getPath(b.data(), o.field));
        if (r) return o.dir === 'desc' ? -r : r;
      }
      return 0;
    });
  }
  const sa = cons.find((c) => c.kind === 'startAfter');
  if (sa) { const i = snaps.findIndex((s) => s.ref.path === sa.snap.ref.path); snaps = snaps.slice(i + 1); }
  const lim = cons.find((c) => c.kind === 'limit');
  if (lim) snaps = snaps.slice(0, lim.n);
  return snaps;
}
function qsnap(list) {
  return { docs: list, size: list.length, empty: list.length === 0, forEach: (fn) => list.forEach(fn) };
}

const delay = () => new Promise((r) => setTimeout(r, 30));
export async function getDoc(ref) { await delay(); return snapOf(ref.path); }
export async function getDocs(q) { await delay(); return qsnap(runQuery(q)); }
export async function getCountFromServer(q) { await delay(); const n = runQuery(q).length; return { data: () => ({ count: n }) }; }

// ── Zápisy ───────────────────────────────────────────────────────────────
function resolve(cur, val) {
  if (val instanceof Sentinel) {
    if (val.kind === 'inc') return (typeof cur === 'number' ? cur : 0) + val.value;
    if (val.kind === 'union') { const a = Array.isArray(cur) ? [...cur] : []; for (const x of val.value) if (!a.includes(x)) a.push(x); return a; }
    if (val.kind === 'remove') return (Array.isArray(cur) ? cur : []).filter((x) => !val.value.includes(x));
    if (val.kind === 'ts') return { __ts: Date.now() };
  }
  if (val instanceof Timestamp) return { __ts: val.toMillis() };
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out = {};
    for (const [k, v] of Object.entries(val)) { if (!(v instanceof Sentinel && v.kind === 'del')) out[k] = resolve(undefined, v); }
    return out;
  }
  return encode(val);
}
function deepMerge(cur, val) {
  if (val instanceof Sentinel || val instanceof Timestamp || Array.isArray(val) || !val || typeof val !== 'object') return resolve(cur, val);
  const out = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur } : {};
  for (const [k, v] of Object.entries(val)) {
    if (v instanceof Sentinel && v.kind === 'del') delete out[k];
    else out[k] = deepMerge(out[k], v);
  }
  return out;
}
function applySet(path, data, opts) {
  const cur = docs.get(path);
  docs.set(path, opts && opts.merge ? deepMerge(cur || {}, data) : resolve(undefined, data));
}
function applyUpdate(path, data) {
  const cur = docs.get(path);
  if (cur === undefined) throw Object.assign(new Error('No document to update: ' + path), { code: 'not-found' });
  const out = structuredClone(cur);
  for (const [key, v] of Object.entries(data)) {
    const parts = key.split('.');
    let o = out;
    for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== 'object') o[p] = {}; o = o[p]; }
    const last = parts.at(-1);
    if (v instanceof Sentinel && v.kind === 'del') delete o[last];
    else o[last] = resolve(o[last], v);
  }
  docs.set(path, out);
}

export async function setDoc(ref, data, opts) { await delay(); applySet(ref.path, data, opts); persist(); }
export async function updateDoc(ref, data) { await delay(); applyUpdate(ref.path, data); persist(); }
export async function deleteDoc(ref) { await delay(); docs.delete(ref.path); persist(); }
export async function addDoc(coll, data) { await delay(); const ref = doc(coll); applySet(ref.path, data); persist(); return ref; }

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push(() => applySet(ref.path, data, opts)); return this; },
    update(ref, data) { ops.push(() => applyUpdate(ref.path, data)); return this; },
    delete(ref) { ops.push(() => docs.delete(ref.path)); return this; },
    async commit() {
      await delay();
      const backup = new Map(docs);
      try { ops.forEach((op) => op()); } catch (e) { docs = backup; throw e; }
      persist();
    },
  };
}
export async function runTransaction(_db, fn) {
  const backup = new Map(docs);
  const ops = [];
  const tx = {
    async get(ref) { return snapOf(ref.path); },
    set(ref, data, opts) { ops.push(() => applySet(ref.path, data, opts)); return tx; },
    update(ref, data) { ops.push(() => applyUpdate(ref.path, data)); return tx; },
    delete(ref) { ops.push(() => docs.delete(ref.path)); return tx; },
  };
  await delay();
  const result = await fn(tx);
  try { ops.forEach((op) => op()); } catch (e) { docs = backup; throw e; }
  persist();
  return result;
}

// Offline cache API (v demu nic nedělá)
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
