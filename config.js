/* Scout — connection details for the two optional services.
 *
 * THE API KEY IS NOT IN THIS FILE, AND THAT IS DELIBERATE.
 *
 * Google documents a Firebase web apiKey as public by design — it identifies
 * the project and authorises nothing, and the Firestore rules are what protect
 * the data. All true. But "public by design" still means a scraper finds it in
 * a public repo within minutes and can burn your free-tier quota creating
 * anonymous sign-ins, so this household chose to keep it off GitHub and paste
 * it on each phone instead.
 *
 * The rest of these values stay here because they are plain identifiers and are
 * useless without the key. That way it is ONE value to paste per phone, not six.
 *
 * Where the key lives instead: localStorage, per device, entered once in
 * Settings. It is still visible in devtools to anyone holding an unlocked phone
 * — nothing can change that while the Firebase SDK runs in a browser — but it
 * is no longer sitting in a public repo.
 */

const KEY_STORAGE = 'scout.apikey';

const FIREBASE_CONFIG = {
  /* filled in at runtime from localStorage — see firebaseApiKey() */
  apiKey:            '',
  authDomain:        'scout-b8b7d.firebaseapp.com',
  projectId:         'scout-b8b7d',
  storageBucket:     'scout-b8b7d.firebasestorage.app',
  messagingSenderId: '800705812928',
  appId:             '1:800705812928:web:645d8ccc554dee3b255025'
};

function firebaseApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

function setFirebaseApiKey(key) {
  const clean = String(key || '').trim();
  try {
    if (clean) localStorage.setItem(KEY_STORAGE, clean);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { return false; }
  FIREBASE_CONFIG.apiKey = clean;
  return true;
}

/* A Firebase browser key is 39 characters starting AIza. Checking the shape
   before we try to use it turns "permission denied" three screens later into
   "that doesn't look like a key" while the paste is still on screen. */
function looksLikeApiKey(key) {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(String(key || '').trim());
}

/* Two states, deliberately distinct:
     - the project isn't set up at all      -> hide sharing entirely
     - the project is set up but this phone -> offer the paste box
       hasn't been given the key yet                                     */
function firebaseProjectPresent() {
  return !!FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.projectId !== 'PASTE_ME';
}

/* An unconfigured app must degrade to local-only rather than throwing on boot.
   Half a sync is worse than none: it would look connected and silently drop
   everything. */
function firebaseConfigured() {
  return firebaseProjectPresent() && looksLikeApiKey(firebaseApiKey());
}

/* ---------- invites ----------
   One message carries both things a new phone needs: the live code and the
   family key. Typing a 39-character key on a phone is where households drop
   off, and a phone that silently never joined logs to itself while everyone
   else wonders where the walks went.

   It is plain text, not a link, on purpose. On iPhone a tapped link opens in
   Safari, whose storage the Home Screen app cannot see — the join would land
   in the wrong app. Text gets copied and pasted into the app that matters.

   The key travels by text message between family members. That is the same
   trust the "written down" key already had, and it identifies a project rather
   than authorising anything — the rules and the one-hour code do that. */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function formatInvite(code, key) {
  return 'scout:' + String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '') + ':' + String(key || '').trim();
}

/* Accepts the whole pasted message, the bare token, or just a typed code.
   Returns { code, key }, either of which may be '' when absent. */
function parseInvite(text) {
  const raw = String(text || '');
  const token = /scout:([A-Za-z0-9-]{6,8}):(AIza[0-9A-Za-z_-]{35})/.exec(raw);
  if (token) return { code: token[1].toUpperCase().replace(/-/g, ''), key: token[2] };

  const keyMatch = /AIza[0-9A-Za-z_-]{35}/.exec(raw);
  const key = keyMatch ? keyMatch[0] : '';
  /* A bare code is only recognised when it is the whole input — hunting for
     six letters inside a pasted paragraph would find words. */
  const rest = raw.replace(key, '').toUpperCase().replace(/[\s-]/g, '');
  const code = rest.length === 6 && [...rest].every(c => INVITE_ALPHABET.includes(c)) ? rest : '';
  return { code, key };
}

/* Resolve the stored key into the config object at load time. */
FIREBASE_CONFIG.apiKey = firebaseApiKey();

/* ---------- reminders ----------
   The Cloudflare Worker that sends push notifications (worker/). Until this is
   set, Scout never offers to turn reminders on — a switch that silently does
   nothing is worse than no switch, which is the lesson from the invite code
   that used to sit in Settings doing exactly that.

   Deploy it with `cd worker && npx wrangler deploy`, then paste the URL here.
*/
const WORKER_URL = '';

function pushConfigured() {
  return typeof WORKER_URL === 'string' && /^https:\/\//.test(WORKER_URL);
}
