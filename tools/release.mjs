#!/usr/bin/env node
/* Bump the cache-busting version in index.html and sw.js together.
 *
 * This exists because the failure it prevents is silent: bump one file and not
 * the other, and the deploy "succeeds" while every existing install keeps
 * serving the old bundle. Nobody sees an error — they just see stale software.
 *
 *   node tools/release.mjs          check for drift, report the current version
 *   node tools/release.mjs bump     bump both files by one
 *   node tools/release.mjs 12       set both files to 12
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'index.html');
const swPath = join(root, 'sw.js');

const html = readFileSync(htmlPath, 'utf8');
const sw = readFileSync(swPath, 'utf8');

const htmlVersions = [...html.matchAll(/\?v=(\d+)/g)].map(m => Number(m[1]));
const swVersions = [...sw.matchAll(/\?v=(\d+)/g)].map(m => Number(m[1]));
const swConst = Number((/const VERSION = (\d+)/.exec(sw) || [])[1]);

const all = [...htmlVersions, ...swVersions, swConst].filter(Number.isFinite);
const unique = [...new Set(all)];

if (!all.length) { console.error('No ?v= markers found. Has the layout changed?'); process.exit(1); }

if (unique.length > 1) {
  console.error('VERSION DRIFT — these must all match:');
  console.error('  index.html ?v=', [...new Set(htmlVersions)].join(', '));
  console.error('  sw.js      ?v=', [...new Set(swVersions)].join(', '));
  console.error('  sw.js      const VERSION =', swConst);
  console.error('\nFix with: node tools/release.mjs ' + Math.max(...all));
  process.exit(1);
}

const current = unique[0];
const arg = process.argv[2];

if (!arg) {
  /* Also check every asset index.html references is actually versioned — an
     unversioned one is cached by the wrong branch of the service worker and
     goes stale in a way that's miserable to debug. */
  const unversioned = [...html.matchAll(/(?:src|href)="((?!https?:|\/\/)[^"]+\.(?:js|css))"/g)]
    .map(m => m[1]).filter(u => !u.includes('?v='));
  if (unversioned.length) {
    console.error('Unversioned assets in index.html:', unversioned.join(', '));
    process.exit(1);
  }

  /* And that every local .js/.css on disk is actually in the shell list. */
  const onDisk = readdirSync(root).filter(f => /\.(js|css)$/.test(f) && f !== 'sw.js');
  const missing = onDisk.filter(f => !sw.includes(f));
  if (missing.length) {
    console.error('Not in the service worker SHELL list:', missing.join(', '));
    process.exit(1);
  }

  console.log(`Version ${current} — consistent across index.html and sw.js.`);
  console.log(`${onDisk.length} assets, all versioned and cached.`);
  process.exit(0);
}

const next = arg === 'bump' ? current + 1 : Number(arg);
if (!Number.isFinite(next) || next < 1) { console.error('Usage: release.mjs [bump|<number>]'); process.exit(1); }

writeFileSync(htmlPath, html.replace(/\?v=\d+/g, `?v=${next}`));
writeFileSync(swPath, sw
  .replace(/\?v=\d+/g, `?v=${next}`)
  .replace(/const VERSION = \d+/, `const VERSION = ${next}`));

console.log(`Bumped ${current} → ${next} in index.html and sw.js.`);
