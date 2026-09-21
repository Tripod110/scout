# Scout

A shared puppy-raising app for a household. Static PWA, no build step.

**Live: https://tripod110.github.io/scout/**

**Status: v1.** Onboarding, the parameter engine, the potty schedule engine,
one-tap logging with undo, editable dog details, and backup/restore all work.
Sync between devices does not exist yet — everything is on-device.

Working name. Nothing is published, so renaming is a find-and-replace.

## Run it

```
node tools/release.mjs          # check version consistency
node tests/params.test.js       # 114 assertions on the evidence layer
python -m http.server 5178      # or any static server
```

A static server is required — `file://` breaks the service worker.

## Why it looks like this

The design brief came out of eight research agents (~346 KB, sourced, in
`obsidian/Reference/Puppy training evidence/`). The consistent finding was that
standard habit-app mechanics are contradicted by the evidence:

- **Streaks** push toward the training schedule the Beagle studies found worse
  (Demant 2011: 1–2×/week beat daily; one session beat three back-to-back).
- **Exposure counts** reward the volume that is the mechanism of flooding.
- **"Days since last accident"** punishes honest logging and rewards
  under-supervision — fewer *observed* accidents is not fewer accidents.
- **Completion badges** tell you to stop where the only controlled socialisation
  trial found gains fade by six months.

So Scout has none of them, and most of its numbers measure the *handler* rather
than the dog. That is the product, not a stylistic choice.

## Files

| File | What |
| --- | --- |
| `params.js` | The evidence layer. Pure functions, no DOM, no clock. Every number traces to a source. |
| `store.js` | Local-first state. Append-only event log + derived day rollups. Sync seam. |
| `ui.js` | Shared builders, icons, escaping rule, the `--scale` type system. |
| `onboard.js` | Setup flow — one question per screen. |
| `today.js` | The Today screen and the potty schedule. |
| `app.js` | Router, one delegated tap handler, boot, SW registration. |
| `tools/release.mjs` | Version bump + drift guard. |
| `tests/params.test.js` | Assertions on the engines. |

## Rules that are load-bearing

**Bump with the script.** `node tools/release.mjs bump` updates `?v=N` in
`index.html` and `sw.js` together. Bumping one and not the other "succeeds"
while every install keeps serving the old bundle — a silent failure. The script
refuses to let them drift and also checks that every asset on disk is in the
service worker's shell list.

**The event log is append-only.** Events are never updated or reordered, only
added or tombstoned. This is what makes a four-handler merge correct; naive
last-write-wins loses data when two people log the same walk, and decides the
winner by clock skew.

**Reads are budgeted.** When Firestore lands: two live listeners maximum
(`state/current` and today's rollup), history reads rollups rather than events,
offline persistence on, listeners detached when backgrounded. The free tier's
50K reads/day is roughly 150 households done this way and 15 done naively.

**No minutes-based exercise UI, ever.** Any duration control silently
re-imports the five-minutes-per-month rule, which has no source study and
traces to a forum post. The shipped rule is type-and-surface:
*"If your puppy can't choose to stop, it's red."*

**Escaping:** a field ending in `Html` is caller-built markup. Everything else
is escaped. Greppable beats careful.

## The iOS problem, and why sync is next

On iOS a home-screen web app runs in a **different storage container from
Safari** — localStorage is not shared. Since iOS Web Push requires the app to be
on the Home Screen, the documented setup path would otherwise wipe the setup.

Two mitigations ship in v1: the welcome screen tells iOS Safari users to install
*first*, and Settings has a backup/restore file. Neither is a real fix. Firestore
sync is, which is why it moved to the front of the queue.

## What's next

Sync · M2 sleep and bite patterns · M3 socialisation woven into Today ·
M4 push via a Cloudflare Worker ported from `peak/worker/` · M5 curriculum ·
M6 absence ladder · M7 AI coach behind a pre-render red-flag gate.

Plan: https://claude.ai/artifact/PWqvvaGCPE7Q4oiz3aRH4J

## Not a vet

Scout does not diagnose and never will. Health-adjacent input routes to a
hard-coded red-flag gate that runs *outside* any model, because a prompt-only
guardrail eventually gets talked out of it.
