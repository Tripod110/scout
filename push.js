/* Scout — push reminders, client half.
 *
 * Everything here is gated on `pushConfigured()`. If the Worker URL is unset,
 * the app never offers a reminders switch at all — a control that silently
 * does nothing is worse than no control, which is the lesson from the invite
 * code that used to sit in Settings promising something it couldn't deliver.
 *
 * iOS, which is the whole reason this is fiddly:
 *   - Web Push only works for a web app ADDED TO THE HOME SCREEN. A Safari tab
 *     cannot subscribe, and the API is simply absent there.
 *   - Permission must be requested from a real user gesture. Asking on load is
 *     rejected outright.
 *   - There are no silent pushes. Every message must be user-visible or iOS
 *     revokes the subscription.
 *
 * LOAD ORDER: after store.js and ui.js, before app.js.
 */

const Push = (() => {

  function supported() {
    return pushConfigured()
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
  }

  /* Why the switch is unavailable, in words a person can act on. */
  function unavailableReason() {
    if (!pushConfigured()) return null;                   // hide entirely
    if (isIOS() && !isStandalone()) {
      return 'Add Scout to your Home Screen first — iPhone only allows reminders for apps on the Home Screen.';
    }
    if (!('PushManager' in window)) return 'This browser can’t do reminders.';
    if (Notification.permission === 'denied') {
      return 'Notifications are blocked for Scout in your phone’s settings.';
    }
    return null;
  }

  function enabled() {
    return supported() && Notification.permission === 'granted' && Store.state.settings.remindersOn;
  }

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function vapidPublicKey() {
    const res = await fetch(WORKER_URL.replace(/\/$/, '') + '/key');
    if (!res.ok) throw new Error('no key');
    const { key } = await res.json();
    return key;
  }

  /* Must be called from a click. */
  async function enable() {
    if (!supported()) return { ok: false, error: unavailableReason() || 'Not available here.' };

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Reminders need permission to show notifications.' };

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,                       // iOS requires this
          applicationServerKey: b64ToBytes(await vapidPublicKey())
        });
      }
      await post('/subscribe', {
        householdId: householdId(),
        subscription: sub.toJSON(),
        tzOffset: new Date().getTimezoneOffset(),
        bedtime: Store.state.settings.bedtime,
        wakeTime: Store.state.settings.wakeTime,
        dogName: Store.state.dog?.name || 'your puppy'
      });
      Store.setSettings({ remindersOn: true });
      return { ok: true };
    } catch (e) {
      console.error('push enable', e);
      return { ok: false, error: 'Couldn’t turn reminders on.' };
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post('/unsubscribe', { householdId: householdId(), subscription: sub.toJSON() });
        await sub.unsubscribe();
      }
    } catch (e) { console.warn('push disable', e); }
    Store.setSettings({ remindersOn: false });
    return { ok: true };
  }

  /* The app computes what's actually pending and sends the whole list; each
     POST replaces the last, which is what makes reminders self-cancelling. If
     somebody takes her out, the next list simply doesn't contain that reminder.
     The Worker never computes anything and never sees your data. */
  async function syncReminders(reminders) {
    if (!enabled()) return;
    await post('/due', { householdId: householdId(), reminders: reminders || [] }).catch(() => {});
  }

  function householdId() {
    return Store.state.household?.remoteId || Store.state.household?.id || 'local';
  }

  async function post(path, body) {
    return fetch(WORKER_URL.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  return { supported, unavailableReason, enabled, enable, disable, syncReminders };
})();
