/* Focused lifecycle checks for sync.js. The production file is a plain browser
 * script, so this test supplies the small set of browser/Firebase globals it
 * needs and evaluates it unchanged. No npm dependencies required.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let adapter = null;
let remoteWrites = 0;

global.window = global;
global.firebaseConfigured = () => true;
global.firebaseProjectPresent = () => true;
global.FIREBASE_CONFIG = { projectId: 'test' };
global.Store = {
  state: { household: null },
  setSyncAdapter(value) { adapter = value; },
  myName() { return 'Tester'; }
};

const db = {
  async enablePersistence() {},
  collection() {
    return {
      doc() {
        return {
          collection() {
            return {
              doc() {
                return { set() { remoteWrites++; return Promise.resolve(); } };
              }
            };
          }
        };
      }
    };
  }
};

global.firebase = {
  apps: [],
  initializeApp() { this.apps.push({}); },
  auth() {
    return { signInAnonymously: async () => ({ user: { uid: 'test-user' } }) };
  },
  firestore() { return db; }
};

const source = fs.readFileSync(require.resolve('../sync.js'), 'utf8');
vm.runInThisContext(`${source}\n;globalThis.SyncUnderTest = Sync;`, { filename: 'sync.js' });

(async () => {
  assert.equal(await SyncUnderTest.init(), true);
  assert.ok(adapter, 'init installs the outbound adapter');

  const oldAdapter = adapter;
  SyncUnderTest.disconnect();

  assert.equal(adapter, null, 'disconnect removes the outbound adapter');
  assert.equal(SyncUnderTest.connected, false, 'disconnect clears the active household');
  assert.deepEqual(SyncUnderTest.getStatus(), {
    status: 'local', detail: 'Key needed on this phone', uid: null, hid: null
  });

  oldAdapter.pushEvent({ id: 'after-disconnect', type: 'potty', ts: Date.now() });
  assert.equal(remoteWrites, 0, 'a retained adapter cannot write after disconnect');

  console.log('4 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
