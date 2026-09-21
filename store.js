/* Scout — state, persistence, and the seam sync will plug into.
 *
 * Everything is local-first. Firestore is not wired yet (M0.5) and the app must
 * work fully without it, because the alternative is an onboarding flow that
 * fails when someone's wifi drops on the sofa.
 *
 * THE EVENT LOG IS APPEND-ONLY. Events are never updated or reordered, only
 * added and occasionally tombstoned. That is not tidiness — it is what makes a
 * four-handler merge correct. Naive last-write-wins genuinely loses data when
 * two people log the same walk from two phones, and "who won" is decided by
 * clock skew rather than by what happened.
 *
 * Reads are budgeted, not incidental: see ROLLUPS below. On Firestore's free
 * tier reads bind before writes, and the difference between reading rollups and
 * re-querying events is roughly 150 households versus 15.
 *
 * LOAD ORDER: after params.js, before everything else.
 */

const LS_KEY = 'scout.v1';
const DEVICE_KEY = 'scout.device';

/* ---------- shape ---------- */

function emptyState() {
  return {
    schema: 1,
    household: null,          // { id, inviteCode, createdAt, members[] }
    dog: null,                // { name, dob, dobEstimated, sizeClass, ... }
    settings: {
      scale: 'normal',        // normal | large | largest
      units: 'imperial',
      pottySlider: 1.0,
      /* Bedtime is a real constraint, not a failure of commitment. Most owners
         are not getting up at 3am, and a schedule that assumes they will just
         produces guilt and a silent app. Overnight is therefore a declared
         state: no reminders, accidents logged but kept out of the daytime
         trend, and a last-call prompt before lights out. */
      bedtime: 22,
      wakeTime: 7,
      remindersOn: false,
      overnightAccidentsCount: false
    },
    events: [],               // append-only
    rollups: {},              // 'YYYY-MM-DD' -> derived summary
    ladder: { base: 5, consecutiveCalm: 0, locked: false, startedAt: null },
    progress: {},             // behaviourId -> { level, reps[] }
    onboarded: false
  };
}

let state = emptyState();
const listeners = new Set();

/* ---------- device identity ----------
   Bound once, at setup. This is the whole reason the app never asks "who is
   logging this?" at the moment of logging — a picker on the hot path is the
   thing that stops people logging at all, and attribution that costs a tap
   gets skipped exactly when the house is busiest. */

function deviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* private mode */ }
  if (!id) {
    id = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ephemeral is fine */ }
  }
  return id;
}

function me() {
  const id = deviceId();
  const m = (state.household?.members || []).find(x => x.deviceId === id);
  return m || null;
}
function myName() { return me()?.name || 'Someone'; }

/* ---------- persistence ----------
   Every accessor is wrapped: localStorage throws outright in some private
   windows rather than returning null, and an app that white-screens because
   storage is blocked is worse than one that forgets. */

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schema === 1) {
      state = Object.assign(emptyState(), parsed);
      state.settings = Object.assign(emptyState().settings, parsed.settings || {});
      return true;
    }
  } catch { /* corrupt or unavailable — start clean rather than crash */ }
  return false;
}

let saveTimer = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch { /* quota or blocked — in-memory state stays correct */ }
  }, 120);
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } }
function commit() { save(); emit(); syncPush(); }

/* ---------- events ---------- */

function newId() { return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* `at` is injectable so a backdated entry ("she went out at 3, I forgot to log
   it") records the time it happened, not the time it was typed. */
function addEvent(type, payload, at) {
  const ev = {
    id: newId(),
    type,
    ts: at || Date.now(),
    by: deviceId(),
    byName: myName(),
    payload: payload || {}
  };
  state.events.push(ev);
  rebuildRollup(dayKey(ev.ts));
  commit();
  if (syncAdapter?.pushEvent) { try { syncAdapter.pushEvent(ev); } catch (e) { console.warn('sync', e); } }
  return ev;
}

function tombstone(eventId) {
  const ev = state.events.find(e => e.id === eventId);
  if (!ev || ev.deleted) return;
  ev.deleted = true;                       // never spliced — see header
  rebuildRollup(dayKey(ev.ts));
  commit();
  if (syncAdapter?.pushTombstone) { try { syncAdapter.pushTombstone(eventId); } catch (e) { console.warn('sync', e); } }
}

function eventsOn(key) {
  return state.events.filter(e => !e.deleted && dayKey(e.ts) === key).sort((a, b) => a.ts - b.ts);
}
function liveEvents() { return state.events.filter(e => !e.deleted); }
function lastEventOf(types) {
  const set = new Set([].concat(types));
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (!e.deleted && set.has(e.type)) return e;
  }
  return null;
}

/* ---------- dedupe and claims ----------
   Four people, one dog, one hallway. Two mechanisms:
     - a 5-minute window in which a second identical log is treated as the same
       real-world event, surfaced as "Mum already logged this" rather than
       silently dropped, because silently dropping looks like a bug;
     - a 10-minute claim so two people don't both take her out. */

const DEDUPE_WINDOW_MS = 5 * 60000;
const CLAIM_WINDOW_MS = 10 * 60000;

function recentDuplicate(type, now) {
  const t = now || Date.now();
  return liveEvents().find(e => e.type === type && t - e.ts < DEDUPE_WINDOW_MS && e.by !== deviceId()) || null;
}

/* Ordered by POSITION in the append-only log, not by timestamp. Two taps can
   land in the same millisecond in either order, and comparing `ts` then gets it
   wrong whichever way the tie is broken: strict `>` leaves a cancelled claim
   standing, `>=` kills a fresh claim made right after a log released the last
   one. The log is already an ordered record of what happened — use it. */
function activeClaim(now) {
  const t = now || Date.now();
  let idx = -1;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (!e.deleted && e.type === 'claim') { idx = i; break; }
  }
  if (idx === -1) return null;
  const c = state.events[idx];
  if (t - c.ts > CLAIM_WINDOW_MS) return null;
  for (let i = idx + 1; i < state.events.length; i++) {
    const e = state.events[i];
    if (!e.deleted && e.type === 'claimRelease') return null;
  }
  return c;
}

/* ---------- rollups ----------
   A denormalised day summary so history never re-reads the event log. Written
   by whoever wrote the event, derived purely from that day's events so it is
   idempotent — recomputing always yields the same answer, which is what makes
   a rebuild-from-events repair path safe.

   Cloud Functions would be the cleaner home for this, but they aren't on the
   Spark (free) plan, and paying for this one job isn't worth it. */

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function rebuildRollup(key) {
  const evs = eventsOn(key);
  const r = {
    key,
    pottyOut: 0, pottyNothing: 0, accidents: 0, overnightAccidents: 0, padUse: 0,
    bites: 0, biteSeverityTotal: 0, biteMax: 0,
    sleepMinutes: 0, meals: 0,
    socialisationReps: 0, socialisationWorried: 0,
    trainingBlocks: 0, absenceReps: 0,
    heatmap: new Array(24).fill(0),
    byHandler: {}
  };
  for (const e of evs) {
    const h = e.byName || 'Someone';
    r.byHandler[h] = (r.byHandler[h] || 0) + 1;
    const hour = new Date(e.ts).getHours();
    switch (e.type) {
      case 'potty':
        if (e.payload.result === 'nothing') r.pottyNothing++;
        else if (e.payload.place === 'pad') r.padUse++;
        else r.pottyOut++;
        break;
      case 'accident':
        /* Overnight accidents are counted separately, not hidden. Nobody was
           awake, so they say nothing about the daytime schedule — and letting
           them drag the trend down is how a family concludes they're going
           backwards when they aren't. */
        if (e.payload.overnight) r.overnightAccidents++;
        else { r.accidents++; r.heatmap[hour]++; }
        break;
      case 'bite':
        r.bites++;
        r.biteSeverityTotal += e.payload.severity || 0;
        r.biteMax = Math.max(r.biteMax, e.payload.severity || 0);
        break;
      case 'sleep':   r.sleepMinutes += e.payload.minutes || 0; break;
      case 'meal':    r.meals++; break;
      case 'exposure':
        r.socialisationReps++;
        if (e.payload.reaction === 'worried' || e.payload.reaction === 'scared') r.socialisationWorried++;
        break;
      case 'training': r.trainingBlocks++; break;
      case 'absence':  r.absenceReps++; break;
    }
  }
  state.rollups[key] = r;
  return r;
}

function rollup(key) { return state.rollups[key] || rebuildRollup(key); }
function todayRollup(now) { return rollup(dayKey(now || Date.now())); }

function rebuildAllRollups() {
  state.rollups = {};
  const keys = new Set(liveEvents().map(e => dayKey(e.ts)));
  for (const k of keys) rebuildRollup(k);
  commit();
}

/* ---------- the handover line ----------
   Shown on open, before anything else. In a four-handler household this is
   probably the highest-value thing in the app, and it costs one rollup read.
   It answers the question people actually arrive with: what did I miss? */

function sinceYouLastLooked(now) {
  const t = now || Date.now();
  let last = 0;
  try { last = Number(localStorage.getItem('scout.lastSeen')) || 0; } catch { /* ignore */ }
  try { localStorage.setItem('scout.lastSeen', String(t)); } catch { /* ignore */ }
  if (!last) return null;

  const mine = deviceId();
  const evs = liveEvents().filter(e => e.ts > last && e.by !== mine).sort((a, b) => a.ts - b.ts);
  if (!evs.length) return null;

  const time = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lines = evs.slice(-4).map(e => {
    const who = e.byName || 'Someone';
    switch (e.type) {
      case 'potty':    return e.payload.result === 'nothing'
                          ? `${who} took her out at ${time(e.ts)} — nothing happened`
                          : `${who} took her out at ${time(e.ts)}, she went`;
      case 'accident': return `Accident${e.payload.where ? ' in the ' + e.payload.where : ''} at ${time(e.ts)}`;
      case 'meal':     return `${who} fed her at ${time(e.ts)}`;
      case 'sleep':    return `She slept ${e.payload.minutes} min from ${time(e.ts)}`;
      case 'bite':     return `${who} logged a nip at ${time(e.ts)}`;
      default:         return `${who} logged ${e.type} at ${time(e.ts)}`;
    }
  });
  return lines;
}

/* ---------- naps that were never closed ----------
   Someone taps "Asleep", the puppy wakes while they're cooking, and nobody taps
   "awake". Left alone this is silently catastrophic: minsSinceSleep derives from
   the last sleepEnd, so the wake-window timer — the highest-leverage thing in
   the app — goes dark permanently and never says so.

   So a nap longer than any real puppy nap is closed automatically and marked
   estimated. Better a slightly wrong number the user can see than a correct
   mechanism that quietly stopped running. */

const MAX_NAP_MINUTES = 180;

function openNap() {
  const start = lastEventOf('sleepStart');
  if (!start) return null;
  const end = lastEventOf('sleepEnd');
  if (end && end.ts > start.ts) return null;
  return start;
}

function autoCloseStaleNap(now) {
  const start = openNap();
  if (!start) return null;
  const mins = Math.round(((now || Date.now()) - start.ts) / 60000);
  if (mins <= MAX_NAP_MINUTES) return null;
  const endTs = start.ts + MAX_NAP_MINUTES * 60000;
  state.events.push({ id: newId(), type: 'sleepEnd', ts: endTs, by: start.by, byName: start.byName, payload: { estimated: true } });
  state.events.push({ id: newId(), type: 'sleep', ts: endTs, by: start.by, byName: start.byName, payload: { minutes: MAX_NAP_MINUTES, estimated: true } });
  rebuildRollup(dayKey(endTs));
  commit();
  return { minutes: MAX_NAP_MINUTES };
}

/* ---------- backup ----------
   The only thing standing between a household and total loss right now is this
   file. localStorage is per-origin AND per-container: on iOS a home-screen web
   app cannot see what Safari stored, so "install the app" and "clear website
   data" are both total wipes. Until sync lands, an export is the whole safety
   net. */

function exportJSON() {
  return JSON.stringify({ scout: 1, exportedAt: Date.now(), state }, null, 2);
}

function importJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, error: "That file isn't a Scout backup." }; }
  const incoming = parsed?.state;
  if (!incoming || incoming.schema !== 1 || !incoming.dog) {
    return { ok: false, error: "That file isn't a Scout backup." };
  }
  state = Object.assign(emptyState(), incoming);
  state.settings = Object.assign(emptyState().settings, incoming.settings || {});
  /* This device is whoever it was before, not whoever exported — otherwise a
     backup restored onto a second phone impersonates the first one. */
  rebuildAllRollups();
  commit();
  return { ok: true, dog: state.dog?.name };
}

/* ---------- household ---------- */

function makeInviteCode() {
  /* No 0/O/1/I/L — this gets read aloud across a kitchen and typed by someone
     who would rather not be doing this. Ambiguity costs more than entropy here. */
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

function createHousehold(myNameIn) {
  state.household = {
    id: 'h_' + Math.random().toString(36).slice(2, 10),
    inviteCode: makeInviteCode(),
    createdAt: Date.now(),
    members: [{ deviceId: deviceId(), name: myNameIn, joinedAt: Date.now(), role: 'owner' }]
  };
  commit();
  return state.household;
}

function addMember(name) {
  if (!state.household) return null;
  const m = { deviceId: deviceId(), name, joinedAt: Date.now(), role: 'member' };
  state.household.members.push(m);
  commit();
  return m;
}

function setDog(dog) {
  state.dog = Object.assign({}, state.dog, dog);
  commit();
  if (syncAdapter?.pushDog) { try { syncAdapter.pushDog(state.dog); } catch (e) { console.warn('sync', e); } }
}
function setSettings(patch) { state.settings = Object.assign({}, state.settings, patch); commit(); }
function finishOnboarding() { state.onboarded = true; commit(); }

/* ---------- merging what other people did ----------
   Merged by id, so order does not matter and two phones writing at the same
   moment cannot lose a walk. This is the entire payoff of having made the log
   append-only in the first place. */

function mergeRemoteEvents(incoming) {
  const byId = new Map(state.events.map(e => [e.id, e]));
  const touchedDays = new Set();
  let changed = 0;

  for (const r of incoming) {
    const local = byId.get(r.id);
    if (!local) {
      state.events.push({
        id: r.id, type: r.type, ts: r.ts, by: r.by, byName: r.byName,
        payload: r.payload || {}, deleted: !!r.deleted
      });
      touchedDays.add(dayKey(r.ts));
      changed++;
    } else if (r.deleted && !local.deleted) {
      /* A tombstone always wins. Someone pressed undo, and undo losing a race
         would resurrect an entry they deliberately removed. */
      local.deleted = true;
      touchedDays.add(dayKey(local.ts));
      changed++;
    }
  }

  if (!changed) return 0;
  state.events.sort((a, b) => a.ts - b.ts);
  for (const d of touchedDays) rebuildRollup(d);
  save(); emit();
  return changed;
}

/* The dog is shared state: if one person fixes her date of birth, everyone's
   schedule should move. Local edits win only until the next snapshot, which is
   the right trade for a field four people rarely touch. */
function mergeRemoteDog(dog) {
  if (!dog) return;
  const before = JSON.stringify(state.dog);
  state.dog = Object.assign({}, state.dog, dog);
  if (JSON.stringify(state.dog) !== before) { save(); emit(); }
}

function mergeRemoteMembers(members) {
  if (!state.household) return;
  state.household.members = members.map(m => ({
    deviceId: m.uid, name: m.name, remote: true
  }));
  save(); emit();
}

function setHouseholdRemoteId(id) {
  if (!state.household) return;
  state.household.remoteId = id || null;
  commit();
}

/* ---------- sync seam ----------
   Deliberately a no-op. When Firestore lands, this pushes the tail of the event
   log and mirrors `state/current`; nothing above this line changes, because
   everything above is already expressed as append-only events plus derived
   rollups — which is the shape Firestore wants anyway. */

let syncAdapter = null;
function setSyncAdapter(a) { syncAdapter = a; }
function syncPush() { if (syncAdapter?.push) { try { syncAdapter.push(state); } catch (e) { console.warn('sync', e); } } }

/* ---------- boot ---------- */

function resetAll() {
  state = emptyState();
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  commit();
}

const Store = {
  get state() { return state; },
  load, save, subscribe, commit,
  deviceId, me, myName,
  addEvent, tombstone, eventsOn, liveEvents, lastEventOf,
  recentDuplicate, activeClaim, DEDUPE_WINDOW_MS, CLAIM_WINDOW_MS,
  dayKey, rollup, todayRollup, rebuildRollup, rebuildAllRollups,
  sinceYouLastLooked,
  openNap, autoCloseStaleNap, MAX_NAP_MINUTES, exportJSON, importJSON,
  mergeRemoteEvents, mergeRemoteDog, mergeRemoteMembers, setHouseholdRemoteId,
  makeInviteCode, createHousehold, addMember, setDog, setSettings, finishOnboarding,
  setSyncAdapter, resetAll
};
