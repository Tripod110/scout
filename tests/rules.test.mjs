/* Security rules are the entire security model — config.js authorises nothing —
   so they are the one part of Scout that must not ship unverified.
 *
 * Run (needs a scratch dir, since the app itself has no npm dependencies):
 *
 *   npm i firebase-tools @firebase/rules-unit-testing
 *   npx firebase-tools emulators:exec --only firestore  *       --project scout-rules-test "node tests/rules.test.mjs"
 *
 * A note on identities: `stranger` legitimately becomes a member partway
 * through, by joining with a live code. Anything asserting that a non-member is
 * locked out must therefore use `outsider`, who never joins — an earlier
 * version of this file used `stranger` and reported a hole that wasn't there.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'scout-rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8247 }
});

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '  — ' + (e.message || e)); }
};

const HID = 'house1';
const owner = env.authenticatedContext('owner_uid').firestore();
const member = env.authenticatedContext('member_uid').firestore();
const stranger = env.authenticatedContext('stranger_uid').firestore();
const anon = env.unauthenticatedContext().firestore();
/* never joins anything — `stranger` legitimately becomes a member mid-run */
const outsider = env.authenticatedContext('outsider_uid').firestore();

/* seed with rules disabled */
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'households', HID), { ownerUid: 'owner_uid', createdAt: Date.now(), dog: { name: 'Barney' } });
  await setDoc(doc(db, 'households', HID, 'members', 'owner_uid'), { name: 'Sue', joinedAt: Date.now() });
  await setDoc(doc(db, 'households', HID, 'events', 'e1'), { type: 'potty', ts: Date.now(), uid: 'owner_uid', payload: {}, deleted: false });
  await setDoc(doc(db, 'inviteCodes', 'GOOD01'), { householdId: HID, createdBy: 'owner_uid', expiresAt: new Date(Date.now() + 30 * 60000) });
  await setDoc(doc(db, 'inviteCodes', 'OLD001'), { householdId: HID, createdBy: 'owner_uid', expiresAt: new Date(Date.now() - 60000) });
});

console.log('\nreading');
await t('a member can read the household',        () => assertSucceeds(getDoc(doc(owner, 'households', HID))));
await t('a stranger CANNOT read the household',   () => assertFails(getDoc(doc(stranger, 'households', HID))));
await t('a signed-out user CANNOT read it',       () => assertFails(getDoc(doc(anon, 'households', HID))));
await t('a stranger CANNOT read the events',      () => assertFails(getDocs(collection(stranger, 'households', HID, 'events'))));
await t('a stranger CANNOT list invite codes',    () => assertFails(getDocs(collection(stranger, 'inviteCodes'))));

console.log('\njoining');
await t('a live code lets a stranger join', () => assertSucceeds(
  setDoc(doc(stranger, 'households', HID, 'members', 'stranger_uid'), { name: 'Rob', joinedAt: Date.now(), joinCode: 'GOOD01' })));
await t('an EXPIRED code does not', () => assertFails(
  setDoc(doc(member, 'households', HID, 'members', 'member_uid'), { name: 'X', joinedAt: Date.now(), joinCode: 'OLD001' })));
await t('a WRONG code does not', () => assertFails(
  setDoc(doc(member, 'households', HID, 'members', 'member_uid'), { name: 'X', joinedAt: Date.now(), joinCode: 'NOPE99' })));
await t('no code at all does not', () => assertFails(
  setDoc(doc(member, 'households', HID, 'members', 'member_uid'), { name: 'X', joinedAt: Date.now() })));
await t('a joiner CANNOT add somebody else', () => assertFails(
  setDoc(doc(member, 'households', HID, 'members', 'someone_else'), { name: 'X', joinedAt: Date.now(), joinCode: 'GOOD01' })));

console.log('\nthe append-only guarantee');
await t('a member can append an event', () => assertSucceeds(
  setDoc(doc(owner, 'households', HID, 'events', 'e2'), { type: 'bite', ts: Date.now(), uid: 'owner_uid', payload: {}, deleted: false })));
await t('an event CANNOT claim another uid', () => assertFails(
  setDoc(doc(owner, 'households', HID, 'events', 'e3'), { type: 'bite', ts: Date.now(), uid: 'someone_else', payload: {}, deleted: false })));
await t('an event can be tombstoned', () => assertSucceeds(
  updateDoc(doc(owner, 'households', HID, 'events', 'e1'), { deleted: true })));
await t('an event CANNOT be rewritten', () => assertFails(
  updateDoc(doc(owner, 'households', HID, 'events', 'e1'), { type: 'accident' })));
await t('an event CANNOT be un-deleted', () => assertFails(
  updateDoc(doc(owner, 'households', HID, 'events', 'e1'), { deleted: false })));
await t('an event CANNOT be deleted outright', () => assertFails(
  deleteDoc(doc(owner, 'households', HID, 'events', 'e1'))));
await t('a non-member CANNOT write an event', () => assertFails(
  setDoc(doc(outsider, 'households', HID, 'events', 'e9'), { type: 'potty', ts: Date.now(), uid: 'outsider_uid', payload: {} })));
await t('a non-member CANNOT read events', () => assertFails(
  getDocs(collection(outsider, 'households', HID, 'events'))));
await t('a joined member CAN write events', () => assertSucceeds(
  setDoc(doc(stranger, 'households', HID, 'events', 'e10'), { type: 'potty', ts: Date.now(), uid: 'stranger_uid', payload: {} })));

console.log('\ninvite codes');
await t('a member can mint a short-lived code', () => assertSucceeds(
  setDoc(doc(owner, 'inviteCodes', 'NEW001'), { householdId: HID, createdBy: 'owner_uid', expiresAt: new Date(Date.now() + 30 * 60000) })));
await t('a code CANNOT be minted for 10 hours', () => assertFails(
  setDoc(doc(owner, 'inviteCodes', 'LONG01'), { householdId: HID, createdBy: 'owner_uid', expiresAt: new Date(Date.now() + 10 * 3600 * 1000) })));
await t('a non-member CANNOT mint a code for this house', () => assertFails(
  setDoc(doc(member, 'inviteCodes', 'EVIL01'), { householdId: HID, createdBy: 'member_uid', expiresAt: new Date(Date.now() + 30 * 60000) })));

console.log('\nownership');
await t('a member CANNOT seize ownership', () => assertFails(
  updateDoc(doc(owner, 'households', HID), { ownerUid: 'stranger_uid' })));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
