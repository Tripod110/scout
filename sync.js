/* Scout — Firestore sync.
 *
 * WHY THIS EXISTS AT ALL, before "so four people can share a dog": on iOS a
 * home-screen web app cannot read what Safari stored. Since iOS Web Push
 * requires the app to be on the Home Screen, a local-only Scout loses your
 * setup at exactly the moment you commit to it. Sync is the fix; the backup
 * file was only ever a splint.
 *
 * SHAPE. The local store is already an append-only event log plus derived
 * rollups, which is the shape Firestore wants, so this file is mostly plumbing:
 *
 *   - events are mirrored both ways and merged by id (order-independent, so
 *     two phones writing at once cannot lose a walk)
 *   - rollups are NOT synced. They are derived, and deriving them locally is
 *     free while reading them is billed.
 *   - the household doc carries the dog, settings and ownership — one doc, one
 *     listener, one read when it changes.
 *
 * READ BUDGET. Two listeners, no more: the household doc, and the last 100
 * events. Firestore's resume tokens mean re-attaching a cached query costs
 * deltas rather than the whole window, and offline persistence means a cold
 * open usually costs nothing at all. Rule evaluation also bills a read per
 * exists() — see firestore.rules — which is budgeted for.
 *
 * LOAD ORDER: after store.js (it calls into it), before app.js.
 */

const Sync = (() => {
  let db = null, auth = null, uid = null;
  let hid = null;
  let unsubs = [];
  let status = 'off';        // off | connecting | live | error | local
  let statusDetail = '';
  const watchers = new Set();

  const EVENT_WINDOW = 100;

  function onStatus(fn) { watchers.add(fn); return () => watchers.delete(fn); }
  function setStatus(s, detail) {
    status = s; statusDetail = detail || '';
    for (const fn of watchers) { try { fn(status, statusDetail); } catch (e) { console.warn(e); } }
  }
  function getStatus() { return { status, detail: statusDetail, uid, hid }; }

  /* ---------- boot ---------- */

  /* Callable more than once: the key arrives after boot, pasted in Settings, so
     the first attempt legitimately fails and a later one must be able to
     succeed. initializeApp throws if called twice, hence the guard. */
  async function init() {
    if (!window.firebase || !firebaseConfigured()) {
      setStatus('local', firebaseProjectPresent() ? 'Key needed on this phone' : 'Sync not set up');
      return false;
    }
    try {
      setStatus('connecting');
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();

      /* Offline persistence is what makes this usable on a phone in a garden
         with one bar, and it is what keeps the read count down. Failure is not
         fatal — a second tab or an unsupported browser just means live-only. */
      try { await db.enablePersistence({ synchronizeTabs: true }); }
      catch (e) { console.warn('persistence unavailable:', e.code); }

      const cred = await auth.signInAnonymously();
      uid = cred.user.uid;

      Store.setSyncAdapter(adapter);

      const savedHid = Store.state.household?.remoteId;
      if (savedHid) await attach(savedHid);
      else setStatus('live', 'Not shared yet');
      return true;
    } catch (e) {
      console.error('sync init', e);
      setStatus('error', friendlyError(e));
      return false;
    }
  }

  function friendlyError(e) {
    const c = e?.code || '';
    if (c.includes('permission-denied')) return 'Permission denied — check the security rules are published.';
    if (c.includes('unavailable')) return 'Can’t reach the server right now.';
    if (c.includes('auth/operation-not-allowed')) return 'Anonymous sign-in isn’t switched on in Firebase.';
    if (c.includes('auth/configuration-not-found')) return 'Firebase project not found — check config.js.';
    if (c.includes('auth/api-key-not-valid') || c.includes('auth/invalid-api-key')) return 'That key was rejected — check you copied all of it.';
    if (c.includes('requests-from-referer') || c.includes('referer')) return 'This key is locked to another website. Check its restrictions in Google Cloud Console.';
    return e?.message || 'Something went wrong.';
  }

  /* ---------- creating and joining ---------- */

  async function createRemote() {
    if (!db || !uid) return null;
    const ref = db.collection('households').doc();
    await ref.set({
      ownerUid: uid,
      createdAt: Date.now(),
      dog: Store.state.dog || null,
      settings: Store.state.settings || null
    });
    /* The owner adds themselves. The rules permit this without an invite code
       specifically so a household can have a first member at all — see isOwner()
       in firestore.rules. An earlier version tried to mint a code for the owner
       and deadlocked, because minting one also required membership. */
    await ref.collection('members').doc(uid).set({
      name: Store.myName(),
      joinedAt: Date.now()
    });

    Store.setHouseholdRemoteId(ref.id);
    await pushAllEvents(ref.id);
    await attach(ref.id);
    return ref.id;
  }

  /* The code is a door the owner opens for an hour, not a permanent key. It is
     read aloud across a kitchen, so it avoids characters that get misheard. */
  async function openInvite(forHid) {
    const target = forHid || hid;
    if (!db || !target) throw new Error('not connected');
    const code = Store.makeInviteCode().replace('-', '');
    await db.collection('inviteCodes').doc(code).set({
      householdId: target,
      createdBy: uid,
      expiresAt: new Date(Date.now() + 55 * 60000)   // inside the rule's 1h cap
    });
    return code;
  }

  async function join(rawCode, myNameIn) {
    if (!db || !uid) return { ok: false, error: 'Sync isn’t set up on this device.' };
    const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 6) return { ok: false, error: 'That code looks too short.' };

    try {
      const snap = await db.collection('inviteCodes').doc(code).get();
      if (!snap.exists) return { ok: false, error: 'That code isn’t right, or it has expired.' };
      const data = snap.data();
      const expires = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : Number(data.expiresAt);
      if (!expires || expires < Date.now()) return { ok: false, error: 'That code has expired — ask for a new one.' };

      const targetHid = data.householdId;
      await db.collection('households').doc(targetHid).collection('members').doc(uid).set({
        name: myNameIn || Store.myName(),
        joinedAt: Date.now(),
        joinCode: code
      });

      Store.setHouseholdRemoteId(targetHid);
      await attach(targetHid);
      return { ok: true };
    } catch (e) {
      console.error('join', e);
      return { ok: false, error: friendlyError(e) };
    }
  }

  /* ---------- listeners ---------- */

  async function attach(targetHid) {
    detach();
    hid = targetHid;
    const ref = db.collection('households').doc(hid);

    unsubs.push(ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const d = snap.data();
      if (d.dog) Store.mergeRemoteDog(d.dog);
      setStatus('live', 'Sharing on');
    }, err => setStatus('error', friendlyError(err))));

    unsubs.push(ref.collection('events')
      .orderBy('ts', 'desc').limit(EVENT_WINDOW)
      .onSnapshot(snap => {
        const incoming = [];
        snap.forEach(doc => incoming.push(Object.assign({ id: doc.id }, doc.data())));
        if (incoming.length) Store.mergeRemoteEvents(incoming);
      }, err => setStatus('error', friendlyError(err))));

    unsubs.push(ref.collection('members').onSnapshot(snap => {
      const members = [];
      snap.forEach(doc => members.push({ uid: doc.id, name: doc.data().name }));
      Store.mergeRemoteMembers(members);
    }, () => { /* membership is cosmetic; a failure here is not worth a banner */ }));

    setStatus('live', 'Sharing on');
  }

  function detach() {
    for (const u of unsubs) { try { u(); } catch { /* already gone */ } }
    unsubs = [];
  }

  /* ---------- writes ----------
     Fire-and-forget on purpose. Firestore queues writes offline and replays
     them, so awaiting here would only make the UI wait for a round trip it
     does not need — the local store is already the source of truth for the
     screen the user is looking at. */

  function eventDoc(ev) {
    return {
      type: ev.type,
      ts: ev.ts,
      by: ev.by,
      byName: ev.byName,
      uid,
      payload: ev.payload || {},
      deleted: !!ev.deleted
    };
  }

  const adapter = {
    pushEvent(ev) {
      if (!db || !hid) return;
      db.collection('households').doc(hid).collection('events').doc(ev.id)
        .set(eventDoc(ev)).catch(e => console.warn('push event', e.code));
    },
    pushTombstone(id) {
      if (!db || !hid) return;
      db.collection('households').doc(hid).collection('events').doc(id)
        .update({ deleted: true }).catch(e => console.warn('tombstone', e.code));
    },
    pushDog(dog) {
      if (!db || !hid) return;
      db.collection('households').doc(hid)
        .set({ dog }, { merge: true }).catch(e => console.warn('push dog', e.code));
    }
  };

  async function pushAllEvents(targetHid) {
    const evs = Store.state.events.slice(-EVENT_WINDOW);
    if (!evs.length) return;
    const batch = db.batch();
    const col = db.collection('households').doc(targetHid).collection('events');
    for (const ev of evs) batch.set(col.doc(ev.id), eventDoc(ev));
    await batch.commit().catch(e => console.warn('seed events', e.code));
  }

  async function leave() {
    detach();
    if (db && hid && uid) {
      await db.collection('households').doc(hid).collection('members').doc(uid)
        .delete().catch(() => {});
    }
    hid = null;
    Store.setHouseholdRemoteId(null);
    setStatus('live', 'Not shared');
  }

  return { init, createRemote, openInvite, join, leave, detach, onStatus, getStatus,
           get connected() { return !!hid; } };
})();
