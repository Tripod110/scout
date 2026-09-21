/* Scout — connection details for the two optional services.
 *
 * THESE VALUES ARE NOT SECRET. A Firebase web config is public by design: it
 * ships to every browser that loads the app, and Google's own documentation
 * says so. It identifies the project; it does not authorise anything. All of
 * the actual security lives in firestore.rules.
 *
 * So committing this file to a public repo is correct and expected. The thing
 * that would genuinely be a leak is a service-account key, and one of those
 * never goes anywhere near a browser.
 *
 * TO FILL THIS IN: see FIREBASE.md. Until it is filled in, Scout runs exactly
 * as it does today — everything on one device, nothing sent anywhere.
 */

const FIREBASE_CONFIG = {
  apiKey:            'REDACTED-ROTATED-KEY',
  authDomain:        'scout-b8b7d.firebaseapp.com',
  projectId:         'scout-b8b7d',
  storageBucket:     'scout-b8b7d.firebasestorage.app',
  messagingSenderId: '800705812928',
  appId:             '1:800705812928:web:645d8ccc554dee3b255025'
};

/* An unconfigured app must degrade to local-only rather than throwing on boot.
   Half a sync is worse than none: it would look connected and silently drop
   everything. */
function firebaseConfigured() {
  return !!FIREBASE_CONFIG.projectId
    && FIREBASE_CONFIG.projectId !== 'PASTE_ME'
    && !!FIREBASE_CONFIG.apiKey
    && FIREBASE_CONFIG.apiKey !== 'PASTE_ME';
}

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
