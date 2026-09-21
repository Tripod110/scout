# Scout — working rules

Read `README.md` first. This file is the things that will bite you.

## Stack

Static PWA, **no build step, no bundler, no npm dependencies**. Plain
`<script src="x.js?v=N">` in load order. Node is used only for
`tools/release.mjs` and the test file. Don't introduce a build step; the whole
point is that any file can be opened and read.

Load order is real, not incidental: `params.js` → `store.js` → `ui.js` →
`onboard.js` → `today.js` → `app.js`. Functions may *reference* symbols from
later files inside a function body (they resolve at call time). Nothing may
*evaluate* them at module scope.

## Before you commit

```
node tools/release.mjs bump     # both files, together
node tests/params.test.js       # must be 0 failed
```

A new `.js` or `.css` file must be added to the `SHELL` array in `sw.js` — the
release script checks this and will fail if you forget.

## params.js is the evidence layer

Every number in it traces to a source in
`obsidian/Reference/Puppy training evidence/`. If you change one, change the
comment, and if the evidence is weak **say so in the comment** — a number
rendered in a UI acquires authority the research may not deserve.

Pure functions only: no DOM, no storage, no `Date.now()` inside. Callers pass
`now` in. That's what makes `tests/params.test.js` able to assert real
behaviour instead of smoke-testing.

Things that are deliberate and will look like bugs:

- The potty interval uses **Dunbar's measured capacities**, not "age in months
  + 1". The +1 rule is applied only as a hard ceiling. It has no primary study.
- **Unknown adult size defaults UP** to `large` for safety parameters but
  **suppresses** the large-breed food prompt. Feeding large-breed formula to a
  small dog is a real harm, so those two behaviours diverge on purpose.
- `deepChested` is a **separate axis** from size class, not a tier. Glickman
  found no significant large-vs-giant GDV difference; conformation is the
  discriminator.
- `OUTCOMES.UNKNOWN` in the absence ladder behaves like mild unrest, never a
  pass, and above 5 minutes an unmonitored session cannot advance the ladder.
  An unwatched absence is not evidence the dog was calm.
- `readyToLevelUp` requires **two distinct handlers**. Dogs' failure to
  generalise across people is experimentally demonstrated. Don't "simplify" it.
- There is **no completion state** for socialisation, and there must never be.

## Things not to add

Streaks. Completion percentages. "Days since last accident" as a hero number.
Any cross-dog comparison. A target weight or food quantity. Exercise minutes.
Growth-plate countdowns. Breed temperament predictions.

Each was rejected on evidence, and the reasoning is in the research files and
the plan. If one seems obviously missing, read why first.

## Copy rules

Plain English for non-technical older adults. Never "naughty", "stubborn",
"dominant", "alpha", or "getting away with it" — those framings are rejected
outright and several are actively harmful.

Hedge contested things honestly: fear periods are "commonly seen", never
predicted. The 18–20h sleep figure is a band, never a target that can be
failed.

Accidents get blame-free copy. A family that feels judged stops logging, and
the logs are what everything runs on.

## Not a vet

The app must not diagnose. Health-adjacent input goes through a hard-coded
red-flag gate that runs **outside** the model as a pre-render check — a
prompt-only guardrail eventually gets talked out of it. The GDV card must work
offline as static HTML; an owner mid-emergency won't wait on a network call.
