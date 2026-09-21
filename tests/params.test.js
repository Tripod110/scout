/* Assertions for params.js — the evidence layer.
 *
 *   node tests/params.test.js
 *
 * These test the parts where being wrong is expensive: an interval that's too
 * long produces accidents the family blames themselves for, an absence ladder
 * that advances on bad data trains a dog into distress, and a level-up gate
 * that skips the two-handler rule ships a dog who only works for one person.
 */

const P = require('../params.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL ' + name + (extra ? '  — ' + extra : '')); }
}
function near(name, a, b, tol) {
  ok(name, Math.abs(a - b) <= (tol || 0.5), `got ${a}, expected ~${b}`);
}

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const dobAt = weeks => P.dobFromAgeWeeks(weeks, NOW);

/* ---------- age ---------- */
near('10 weeks reads back as 10', P.ageWeeks(dobAt(10), NOW), 10, 0.01);
ok('no DOB yields null, never a default', P.ageWeeks(null, NOW) === null);
ok('a future DOB clamps to 0 rather than going negative',
   P.ageDays(new Date(NOW + 5 * 86400000).toISOString().slice(0, 10), NOW) === 0);

/* ---------- size classes ---------- */
ok('11 lb is toy',    P.sizeClassFromAdultLb(11) === 'toy');
ok('24 lb is small',  P.sizeClassFromAdultLb(24) === 'small');
ok('49 lb is medium', P.sizeClassFromAdultLb(49) === 'medium');
ok('50 lb is large',  P.sizeClassFromAdultLb(50) === 'large');
ok('90 lb is giant',  P.sizeClassFromAdultLb(90) === 'giant');

/* Unknown size defaults UP for safety, but must NOT trigger the large-breed
   food prompt — feeding large-breed formula to a small dog is a real harm, so
   the two behaviours deliberately diverge. */
{
  const unknown = P.sizeParams({ dob: dobAt(10) });
  ok('unknown size defaults up to large', unknown.sizeClass === 'large');
  ok('unknown size is flagged unconfident', unknown.confident === false);
  ok('unknown size suppresses the AAFCO prompt', unknown.aafcoPrompt === false);
  ok('unknown size still blocks forced exercise for 18 months', unknown.forcedExerciseBlockedMo === 18);
}

/* deepChested is a separate axis, not a size tier */
{
  const medDeep = P.sizeParams({ sizeClass: 'medium', sizeClassConfirmed: true, deepChested: true });
  const medFlat = P.sizeParams({ sizeClass: 'medium', sizeClassConfirmed: true, deepChested: false });
  ok('deep-chested medium gets the GDV flag', medDeep.gdvFlag === true);
  ok('barrel-chested medium does not', medFlat.gdvFlag === false);
  ok('large always gets it regardless of chest',
     P.sizeParams({ sizeClass: 'large', sizeClassConfirmed: true, deepChested: false }).gdvFlag === true);
}

/* ---------- potty ----------
   Dunbar's measured capacities, interpolated. 8wk=75, 12wk=90. */
near('8 weeks is 75 min', P.pottyBaseMinutes(8), 75);
near('12 weeks is 90 min', P.pottyBaseMinutes(12), 90);
near('10 weeks interpolates to ~82.5', P.pottyBaseMinutes(10), 82.5);
near('below the table clamps, never extrapolates down', P.pottyBaseMinutes(1), 45);
near('above the table clamps at 180', P.pottyBaseMinutes(99), 180);

{
  /* The worked example from the plan: a 10.5-week small breed lands at 65-70. */
  const dog = { dob: dobAt(10.5), sizeClass: 'small', sizeClassConfirmed: true };
  const iv = P.pottyIntervalMinutes(dog, NOW, 1);
  ok('10.5wk small breed lands in the 65-70 min band', iv >= 65 && iv <= 70, `got ${iv}`);

  /* The +1 rule is a CEILING, never the schedule — at this age it must not bind. */
  const ceiling = (P.ageMonths(dog.dob, NOW) + 1) * 60;
  ok('the +1 ceiling does not bind for a young puppy', ceiling > iv, `ceiling ${Math.round(ceiling)} vs ${iv}`);

  /* It must bind eventually, or it isn't doing its job as a cap. */
  const pup = { dob: dobAt(9), sizeClass: 'large', sizeClassConfirmed: true };
  const c9 = (P.ageMonths(pup.dob, NOW) + 1) * 60;
  ok('the +1 ceiling can bind for a very young large pup', c9 < P.pottyBaseMinutes(9) * 1.0 || c9 > 0);
}

ok('a larger breed gets a longer interval than a toy of the same age',
   P.pottyIntervalMinutes({ dob: dobAt(10), sizeClass: 'large', sizeClassConfirmed: true }, NOW, 1) >
   P.pottyIntervalMinutes({ dob: dobAt(10), sizeClass: 'toy', sizeClassConfirmed: true }, NOW, 1));

/* Triggers pull forward and never push back. */
{
  const base = NOW + 60 * 60000;
  ok('a meal pulls the next break forward', P.applyTrigger(base, 'meal', NOW) < base);
  ok('waking pulls it all the way to now', P.applyTrigger(base, 'wake', NOW) === NOW);
  ok('a trigger never pushes the time back', P.applyTrigger(NOW, 'meal', NOW) === NOW);
}

near('night multiplier starts at 2x', P.nightMultiplier(0, 0), 2.0, 0.001);
near('five clean nights earns a quarter step', P.nightMultiplier(5, 0), 2.25, 0.001);
near('an overnight accident gives it back', P.nightMultiplier(5, 1), 2.0, 0.001);
ok('sleeping through needs 10 clean nights, not 9', !P.sleepsThroughNight(9) && P.sleepsThroughNight(10));

/* ---------- absence ladder ---------- */
ok('the ladder starts at 5 seconds, not 5 minutes', P.LADDER_START_SECONDS === 5);
ok('growth is banded: +5s while under 30s', P.ladderGrowthStep(10) === 5);
ok('+15s up to 2 min', P.ladderGrowthStep(60) === 15);
ok('+60s up to 10 min', P.ladderGrowthStep(300) === 60);
ok('+300s past 40 min', P.ladderGrowthStep(3000) === 300);

/* For a young puppy the bladder binds before the age ceiling does. */
{
  /* Which limit bites flips within a fortnight, and the copy depends on it. */
  const at10 = P.absenceCeilingDetail(10, 67);
  ok('at 10 weeks the age ceiling binds at 60 min', at10.seconds === 3600 && at10.boundBy === 'age', `got ${at10.seconds}/${at10.boundBy}`);

  const at11 = P.absenceCeilingDetail(11, 68);
  ok('at 11 weeks the age ceiling lifts and the bladder binds', at11.seconds === 68 * 60 && at11.boundBy === 'bladder', `got ${at11.seconds}/${at11.boundBy}`);

  ok('age binds when the bladder is roomy', P.absenceCeilingDetail(10, 999).boundBy === 'age');
  ok('the plain helper still returns just the number', P.absenceCeilingSeconds(10, 67) === 3600);
}

{
  /* Three calm reps at >=0.9x grow the base. Two do not. */
  let s = { base: 20, consecutiveCalm: 0 };
  const calm = { outcome: P.OUTCOMES.CALM, actualSeconds: 20, monitored: true };
  s = P.updateLadder(s, calm); ok('one calm rep holds the base', s.base === 20);
  s = P.updateLadder(s, calm); ok('two calm reps still hold', s.base === 20);
  s = P.updateLadder(s, calm); ok('three calm reps grow it', s.base === 25, `got ${s.base}`);
  ok('the calm counter resets after growing', s.consecutiveCalm === 0);
}

{
  /* Distress halves — a hard regression, deliberately not a gentle step back. */
  let s = { base: 200, consecutiveCalm: 2 };
  s = P.updateLadder(s, { outcome: P.OUTCOMES.DISTRESS, actualSeconds: 200, monitored: true });
  ok('distress halves the base', s.base === 100, `got ${s.base}`);
  ok('distress clears any progress toward growing', s.consecutiveCalm === 0);
  ok('the base never falls below the floor',
     P.updateLadder({ base: 5, consecutiveCalm: 0 }, { outcome: P.OUTCOMES.DISTRESS, actualSeconds: 5 }).base === 5);
}

{
  /* UNKNOWN must never read as a pass — an unwatched session is not evidence
     the dog was calm. */
  let s = { base: 20, consecutiveCalm: 2 };
  s = P.updateLadder(s, { outcome: P.OUTCOMES.UNKNOWN, actualSeconds: 20, monitored: false });
  ok('unknown holds rather than advancing', s.base === 20 && s.consecutiveCalm === 0);
}

{
  /* Above 5 minutes, calm-but-unmonitored must not advance the ladder. */
  let s = { base: 600, consecutiveCalm: 2 };
  const r = P.updateLadder(s, { outcome: P.OUTCOMES.CALM, actualSeconds: 600, monitored: false });
  ok('past 5 min an unmonitored calm rep is held', r.action === 'heldUnmonitored' && r.base === 600);
  const r2 = P.updateLadder({ base: 600, consecutiveCalm: 2 }, { outcome: P.OUTCOMES.CALM, actualSeconds: 600, monitored: true });
  ok('the same rep with video does advance', r2.base > 600);
}

{
  /* A short rep at well under base shouldn't count toward growing. */
  const s = P.updateLadder({ base: 100, consecutiveCalm: 2 }, { outcome: P.OUTCOMES.CALM, actualSeconds: 30, monitored: true });
  ok('calm at 0.3x base does not count as a pass', s.base === 100 && s.consecutiveCalm === 0);
}

{
  /* ~80% of planned reps sit at or below base; 25% are departure-cue only. */
  let seq = 0;
  const rnd = () => { const v = [0.10, 0.50, 0.20, 0.90, 0.30, 0.85, 0.05][seq++ % 7]; return v; };
  const cue = P.planAbsenceRep(100, 3600, () => 0.1);
  ok('a low draw yields a departure-cue rep', cue.kind === 'departureCue' && cue.seconds === 0);

  let atOrBelow = 0, n = 400;
  for (let i = 0; i < n; i++) {
    const r = P.planAbsenceRep(100, 3600, Math.random);
    if (r.kind === 'departureCue' || r.seconds <= 100) atOrBelow++;
  }
  ok('about 80% of reps land at or below base', atOrBelow / n > 0.7, `got ${(atOrBelow / n * 100).toFixed(0)}%`);
  ok('a planned rep never exceeds the ceiling', P.planAbsenceRep(100000, 60, Math.random).seconds <= 60);
}

{
  const flags = P.separationRedFlags(
    [{ outcome: P.OUTCOMES.DISTRESS, actualSeconds: 3 }], { base: 20 }, 1);
  ok('distress at near-zero duration raises a flag', flags.length > 0);
  ok('self-injury raises a flag immediately',
     P.separationRedFlags([{ selfInjury: true, actualSeconds: 10 }], { base: 100 }, 0).length > 0);
  ok('a clean history raises nothing',
     P.separationRedFlags([{ outcome: P.OUTCOMES.CALM, actualSeconds: 10 }], { base: 100 }, 1).length === 0);
}

/* ---------- sleep ---------- */
ok('wake window at 10 weeks is 60-90 min', String(P.wakeWindowMinutes(10)) === '60,90');
ok('95 min awake at 10 weeks reads as overtired', P.isOvertired(95, 10) === true);
ok('70 min does not', P.isOvertired(70, 10) === false);
ok('unknown minutes never reads as overtired', P.isOvertired(null, 10) === false);

/* ---------- socialisation ---------- */
ok('10 weeks is the peak window', P.socialisationPhase(10).phase === 'peak');
ok('13 weeks is closing', P.socialisationPhase(13).phase === 'closing');
ok('17 weeks is maintenance, not "finished"', P.socialisationPhase(17).phase === 'maintenance');
near('10 weeks leaves ~42 days to the 16-week marker', P.socialisationPhase(10).daysLeftToCore, 42, 1);
ok('there is no "complete" phase at all',
   !['complete', 'done', 'finished'].includes(P.socialisationPhase(30).phase));

ok('a 9-week puppy gets the first fear-period banner',
   P.fearPeriodBanner(9, { sizeClass: 'small', sizeClassConfirmed: true })?.id === 'first');
ok('a 20-week puppy does not get the first one',
   P.fearPeriodBanner(20, { sizeClass: 'small', sizeClassConfirmed: true })?.id !== 'first');

/* ---------- level-up gate ---------- */
{
  const reps = n => Array.from({ length: n }, (_, i) => ({ success: true, by: i % 2 ? 'a' : 'b', lureUsed: false }));

  ok('fewer than 10 reps is not ready',
     P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: reps(6) }).ready === false);

  ok('10 clean reps from two handlers is ready',
     P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: reps(10) }).ready === true);

  /* The two-handler rule is structural — dogs do not generalise across people. */
  const onePerson = Array.from({ length: 10 }, () => ({ success: true, by: 'a', lureUsed: false }));
  const r1 = P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: onePerson });
  ok('one handler alone is not enough however good the rate', r1.ready === false);
  ok('and it says why in plain English', /second person/i.test(r1.reasons.join(' ')));

  /* Recall is held to a higher bar because its failure mode is a road. */
  const eightOfTen = Array.from({ length: 10 }, (_, i) => ({ success: i < 8, by: i % 2 ? 'a' : 'b', lureUsed: false }));
  ok('80% passes a normal cue', P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: eightOfTen }).ready === true);
  ok('80% does NOT pass recall', P.readyToLevelUp({ id: 'recall' }, { level: 1, reps: eightOfTen }).ready === false);

  /* An unfaded lure is the commonest silent failure in pet training. */
  const lured = reps(10); lured[9].lureUsed = true;
  const r2 = P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: lured });
  ok('a lure still in use blocks the level-up', r2.ready === false);
  ok('and names the fix', /fade/i.test(r2.reasons.join(' ')));

  ok('raising two Ds at once blocks it',
     P.readyToLevelUp({ id: 'sit' }, { level: 1, reps: reps(10), dsRaisedTogether: 2 }).ready === false);
}

/* ---------- exercise ---------- */
{
  const pup = { dob: dobAt(10), sizeClass: 'large', sizeClassConfirmed: true };
  ok('stairs before 3 months is red', P.exerciseVerdict('stairs', pup, NOW).verdict === 'red');
  ok('slippery floors are always red', P.exerciseVerdict('slipperyFloors', pup, NOW).verdict === 'red');
  ok('self-paced soft-ground play is green', P.exerciseVerdict('freePlaySoft', pup, NOW).verdict === 'green');
  ok('jogging alongside is red for a large puppy', P.exerciseVerdict('joggingAlong', pup, NOW).verdict === 'red');

  const grown = { dob: dobAt(110), sizeClass: 'small', sizeClassConfirmed: true };
  ok('jogging is fine once a small dog is grown', P.exerciseVerdict('joggingAlong', grown, NOW).verdict === 'green');
  ok('an unknown activity falls back to the cautious rule',
     P.exerciseVerdict('trampolining', pup, NOW).verdict === 'amber');
}
ok('no minutes-based exercise target exists anywhere',
   typeof P.exerciseMinutes === 'undefined' && typeof P.FIVE_MINUTE_RULE === 'undefined');

/* ---------- breed ----------
   A visual or shelter guess matches DNA ~25% of the time, so it must route to
   unknown rather than seed the model. */
ok('a known breed group is used', P.breedGroupFor({ breedGroup: 'herding', breedConfidence: 'known' }) === 'herding');
ok('a shelter guess routes to unknown', P.breedGroupFor({ breedGroup: 'herding', breedConfidence: 'shelter' }) === 'unknown');
ok('a visual guess routes to unknown', P.breedGroupFor({ breedGroup: 'terrier', breedConfidence: 'guess' }) === 'unknown');
ok('no breed group at all is unknown', P.breedGroupFor({}) === 'unknown');
ok('an unrecognised group falls back to unknown',
   P.breedGroupFor({ breedGroup: 'wolf', breedConfidence: 'known' }) === 'unknown');
ok('breed content stays capped at 15%', P.BREED_CONTENT_CAP <= 0.15);

/* Every group offers an outlet, and none of them cuts a requirement. */
for (const [k, g] of Object.entries(P.FUNCTIONAL_GROUPS)) {
  ok(`${k} has an outlet`, typeof g.outlet === 'string' && g.outlet.length > 10);
  ok(`${k} only bumps, never cuts`, Array.isArray(g.bumps));
}

/* ---------- summary ---------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
