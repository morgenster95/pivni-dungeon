// Demo režim: simulace Firebase Authentication.
// Ukázkový účet: demo@pivnidungeon.cz / pivo123 (přihlášen automaticky).
const USERS_KEY = 'pd-demo-users';
const SESSION_KEY = 'pd-demo-session';

const DEFAULT_USERS = { 'demo@pivnidungeon.cz': { uid: 'demo-vojta', password: 'pivo123', emailVerified: true } };

function users() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || { ...DEFAULT_USERS }; } catch (_) { return { ...DEFAULT_USERS }; }
}
function saveUsers(u) { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch (_) {} }

function authError(code, message) { return Object.assign(new Error(message || code), { code }); }

function makeUser(email, rec) {
  return { uid: rec.uid, email, emailVerified: !!rec.emailVerified, reload: async () => {}, getIdToken: async () => 'demo-token' };
}

const auth = { currentUser: null, listeners: new Set() };

function setUser(user) {
  auth.currentUser = user;
  try { user ? localStorage.setItem(SESSION_KEY, user.email) : localStorage.setItem(SESSION_KEY, ''); } catch (_) {}
  auth.listeners.forEach((cb) => setTimeout(() => cb(user), 0));
}

(function restore() {
  let email = 'demo@pivnidungeon.cz';
  try { const s = localStorage.getItem(SESSION_KEY); if (s !== null) email = s; } catch (_) {}
  const rec = email && users()[email];
  auth.currentUser = rec ? makeUser(email, rec) : null;
})();

export function getAuth() { return auth; }
export function onAuthStateChanged(_a, cb) {
  auth.listeners.add(cb);
  setTimeout(() => cb(auth.currentUser), 0);
  return () => auth.listeners.delete(cb);
}
export async function signInWithEmailAndPassword(_a, email, password) {
  const rec = users()[email.toLowerCase()];
  if (!rec || rec.password !== password) throw authError('auth/invalid-credential');
  const user = makeUser(email.toLowerCase(), rec);
  setUser(user);
  return { user };
}
export async function createUserWithEmailAndPassword(_a, email, password) {
  const u = users();
  const key = email.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) throw authError('auth/invalid-email');
  if (u[key]) throw authError('auth/email-already-in-use');
  if (password.length < 6) throw authError('auth/weak-password');
  u[key] = { uid: 'demo-' + Date.now().toString(36), password, emailVerified: false };
  saveUsers(u);
  const user = makeUser(key, u[key]);
  setUser(user);
  return { user };
}
export async function signOut() { setUser(null); }
export async function sendEmailVerification(user) { console.info('[demo] ověřovací e-mail pro', user.email); }
export async function sendPasswordResetEmail(_a, email) { console.info('[demo] reset hesla pro', email); }
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential(user, cred) {
  if (users()[user.email]?.password !== cred.password) throw authError('auth/wrong-password');
}
export async function updatePassword(user, pw) { const u = users(); u[user.email].password = pw; saveUsers(u); }
