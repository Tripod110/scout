/* Invite message round-trip. No browser or npm dependencies required. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const source = fs.readFileSync(require.resolve('../config.js'), 'utf8');
vm.runInThisContext(`${source}\n;globalThis.T = { formatInvite, parseInvite };`, { filename: 'config.js' });

const KEY = 'AIza' + 'B'.repeat(20) + '_-x9' + 'c'.repeat(11);
let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

eq(KEY.length, 39, 'fixture key has the real shape');

const token = T.formatInvite('ABC-DEF', KEY);
eq(token, 'scout:ABCDEF:' + KEY, 'format strips the dash');
eq(T.parseInvite(token), { code: 'ABCDEF', key: KEY }, 'bare token round-trips');

const message = `Join Biscuit on Scout.\n\nOpen Scout from your Home Screen, tap Join my family, then Paste invite.\n\n${token}\n\nWorks for an hour.`;
eq(T.parseInvite(message), { code: 'ABCDEF', key: KEY }, 'the whole pasted message parses');

eq(T.parseInvite('abc-def'), { code: 'ABCDEF', key: '' }, 'a typed code alone still works');
eq(T.parseInvite(' abc def '), { code: 'ABCDEF', key: '' }, 'spaces in a typed code are forgiven');
eq(T.parseInvite('ABC1EF'), { code: '', key: '' }, 'characters the generator never uses are rejected');
eq(T.parseInvite('Join Biscuit on Scout today'), { code: '', key: '' }, 'words in prose are not mistaken for a code');
eq(T.parseInvite(KEY), { code: '', key: KEY }, 'a key on its own is recognised');
eq(T.parseInvite(KEY + ' ABCDEF'), { code: 'ABCDEF', key: KEY }, 'key and code typed together');
eq(T.parseInvite(''), { code: '', key: '' }, 'empty input');

console.log(`${n} passed, 0 failed`);
