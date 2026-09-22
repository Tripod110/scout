/* Store identity regression checks. No browser or npm dependencies required. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = new Map();
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

const source = fs.readFileSync(require.resolve('../store.js'), 'utf8');
vm.runInThisContext(`${source}\n;globalThis.StoreUnderTest = Store;`, { filename: 'store.js' });

StoreUnderTest.createHousehold('Alex');
const localId = StoreUnderTest.deviceId();

assert.equal(StoreUnderTest.myName(), 'Alex');

StoreUnderTest.mergeRemoteMembers([
  { uid: 'firebase-self', name: 'Alex' },
  { uid: 'firebase-other', name: 'Sam' }
], 'firebase-self');

assert.equal(StoreUnderTest.myName(), 'Alex', 'remote snapshots preserve the local handler name');
assert.equal(StoreUnderTest.me().deviceId, localId, 'the signed-in member remains mapped to this phone');
assert.equal(StoreUnderTest.me().remoteUid, 'firebase-self', 'the Firebase identity is stored separately');
assert.equal(StoreUnderTest.state.household.members[1].deviceId, null, 'another member is not marked as this phone');

const event = StoreUnderTest.addEvent('potty', { result: 'went' });
assert.equal(event.by, localId, 'events retain the stable local device identity');
assert.equal(event.byName, 'Alex', 'events retain the correct handler name after member sync');

console.log('7 passed, 0 failed');
