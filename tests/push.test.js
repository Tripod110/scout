/* Push subscription refresh checks. No browser or npm dependencies required. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const requests = [];
const subscription = {
  toJSON() { return { endpoint: 'https://push.example/subscription' }; }
};

global.window = global;
global.PushManager = function PushManager() {};
global.Notification = { permission: 'granted' };
global.WORKER_URL = 'https://worker.example';
global.pushConfigured = () => true;
global.isIOS = () => false;
global.isStandalone = () => true;
Object.defineProperty(global, 'navigator', {
  configurable: true,
  value: {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => subscription }
      })
    }
  }
});
global.Store = {
  state: {
    household: { remoteId: 'household-1' },
    dog: { name: 'Scout' },
    settings: { remindersOn: true, bedtime: 22, wakeTime: 7 }
  }
};
global.fetch = async (url, options) => {
  requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
  return { ok: true, json: async () => ({}) };
};

const source = fs.readFileSync(require.resolve('../push.js'), 'utf8');
vm.runInThisContext(`${source}\n;globalThis.PushUnderTest = Push;`, { filename: 'push.js' });

(async () => {
  const reminders = [{ kind: 'potty', at: 12345 }];
  await PushUnderTest.refresh(reminders);

  assert.equal(requests.length, 2, 'refresh updates the subscription and due list');
  assert.equal(requests[0].url, 'https://worker.example/subscribe');
  assert.equal(requests[0].body.householdId, 'household-1');
  assert.equal(requests[0].body.bedtime, 22);
  assert.equal(requests[0].body.wakeTime, 7);
  assert.equal(requests[0].body.dogName, 'Scout');
  assert.equal(requests[1].url, 'https://worker.example/due');
  assert.deepEqual(requests[1].body.reminders, reminders);

  Store.state.settings.bedtime = 21;
  Store.state.settings.wakeTime = 6;
  Store.state.dog.name = 'Pepper';
  await PushUnderTest.refresh([]);

  assert.equal(requests[2].body.bedtime, 21, 'changed bedtime reaches the Worker');
  assert.equal(requests[2].body.wakeTime, 6, 'changed wake time reaches the Worker');
  assert.equal(requests[2].body.dogName, 'Pepper', 'changed dog name reaches the Worker');
  assert.deepEqual(requests[3].body.reminders, [], 'an empty list cancels stale reminders');

  console.log('12 passed, 0 failed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
