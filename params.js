/* Scout — the evidence layer.
 *
 * Every number in this file traces to a source in
 * `obsidian/Reference/Puppy training evidence/`. Nothing here is a guess, and
 * where the underlying evidence is weak the comment says so explicitly — that
 * matters, because a number rendered in a UI acquires an authority the research
 * behind it may not deserve. The five-minutes-per-month exercise rule is the
 * cautionary example: universally repeated, no source study, and deliberately
 * absent from this file.
 *
 * Pure functions only. No DOM, no storage, no clock — callers pass `now` in, so
 * every branch is testable. tests/params.test.html asserts against it.
 *
 * LOAD ORDER: this file loads first and depends on nothing.
 */

/* ---------- size classes ----------
   Boundaries from the large/giant-breed review. Two different weight thresholds
   exist on purpose and must not be collapsed into one constant:
     - 50 lb  drives handling, exercise and behaviour parameters (Tufts' line)
     - 70 lb  drives the food-label prompt, because 70 lb is the number printed
              in the AAFCO large-breed growth statement
   `deepChested` is a SEPARATE axis, not a tier: Glickman found no significant
   large-vs-giant GDV difference, so conformation is the discriminator. */

const SIZE_CLASSES = ['toy', 'small', 'medium', 'large', 'giant'];

const SIZE_PARAMS = {
  toy:    { maxAdultLb: 11,   pottyFactor: 0.80, platesCloseMo: [6, 9],   forcedExerciseBlockedMo: 12, adolescenceMo: [6, 14], curriculumMo: 12, secondFearMo: [6, 9],  gdvFlag: false, aafcoPrompt: false, carTetherIn: 32 },
  small:  { maxAdultLb: 24,   pottyFactor: 0.80, platesCloseMo: [6, 9],   forcedExerciseBlockedMo: 12, adolescenceMo: [6, 14], curriculumMo: 12, secondFearMo: [6, 9],  gdvFlag: false, aafcoPrompt: false, carTetherIn: 32 },
  medium: { maxAdultLb: 49,   pottyFactor: 0.90, platesCloseMo: [9, 12],  forcedExerciseBlockedMo: 14, adolescenceMo: [6, 16], curriculumMo: 14, secondFearMo: [6, 11], gdvFlag: 'ifDeepChested', aafcoPrompt: 'if70lb', carTetherIn: 32 },
  large:  { maxAdultLb: 89,   pottyFactor: 1.00, platesCloseMo: [12, 16], forcedExerciseBlockedMo: 18, adolescenceMo: [6, 24], curriculumMo: 18, secondFearMo: [8, 14], gdvFlag: true,  aafcoPrompt: true,  carTetherIn: 36 },
  giant:  { maxAdultLb: 9999, pottyFactor: 1.00, platesCloseMo: [18, 24], forcedExerciseBlockedMo: 24, adolescenceMo: [6, 30], curriculumMo: 24, secondFearMo: [8, 16], gdvFlag: true,  aafcoPrompt: true,  carTetherIn: 36 }
};

const SIZE_LABELS = {
  toy:    'Toy — under 12 lb grown',
  small:  'Small — 12 to 24 lb grown',
  medium: 'Medium — 25 to 49 lb grown',
  large:  'Large — 50 to 89 lb grown',
  giant:  'Giant — 90 lb or more grown'
};

function sizeClassFromAdultLb(lb) {
  if (!isFinite(lb) || lb <= 0) return null;
  for (const c of SIZE_CLASSES) if (lb <= SIZE_PARAMS[c].maxAdultLb) return c;
  return 'giant';
}

/* Under uncertainty, default UP for every safety parameter — a medium-sized
   assumption on a dog that turns out large under-protects growing joints. The
   one exception is the nutrition prompt: feeding large-breed formula to a small
   dog is a real harm, so `aafcoPrompt` is suppressed while size is unconfirmed.
   Never silently downgrade a confirmed class; re-prompt at 12wk, 16wk, 6mo. */
function resolveSizeClass(dog) {
  if (dog.sizeClass && dog.sizeClassConfirmed) return { cls: dog.sizeClass, confident: true };
  if (dog.adultWeightLbEstimate) {
    const c = sizeClassFromAdultLb(dog.adultWeightLbEstimate);
    if (c) return { cls: c, confident: false };
  }
  if (dog.sizeClass) return { cls: dog.sizeClass, confident: false };
  return { cls: 'large', confident: false, defaultedUp: true };
}

function sizeParams(dog) {
  const { cls, confident } = resolveSizeClass(dog);
  const p = Object.assign({}, SIZE_PARAMS[cls]);
  p.sizeClass = cls;
  p.confident = confident;
  p.gdvFlag = p.gdvFlag === 'ifDeepChested' ? !!dog.deepChested : !!p.gdvFlag;
  /* suppressed until size is confirmed — see note above */
  p.aafcoPrompt = !confident ? false
    : p.aafcoPrompt === 'if70lb' ? (dog.adultWeightLbEstimate || 0) >= 70
    : !!p.aafcoPrompt;
  return p;
}

/* ---------- age ---------- */

const DAY_MS = 86400000;

function ageDays(dobISO, now) {
  if (!dobISO) return null;
  const dob = new Date(dobISO + 'T00:00:00');
  if (isNaN(dob)) return null;
  return Math.max(0, Math.floor((now - dob) / DAY_MS));
}
function ageWeeks(dobISO, now) {
  const d = ageDays(dobISO, now);
  return d === null ? null : d / 7;
}
function ageMonths(dobISO, now) {
  const d = ageDays(dobISO, now);
  return d === null ? null : d / 30.4375;
}

/* A DOB the owner estimated rather than knows. Rescues and some breeders give an
   age in weeks, not a date — so we store a derived DOB and remember it's soft,
   because "she's about 10 weeks" should not render as a precise countdown. */
function dobFromAgeWeeks(weeks, now) {
  return new Date(now - weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

/* ---------- potty schedule ----------
   Dunbar's measured awake bladder capacities, NOT the "age in months + 1" rule.
   That rule is repeated everywhere with no primary study behind it and describes
   a ceiling under calm resting conditions, not an interval to ask an awake puppy
   to wait. It is applied here only as a hard cap.

   Dunbar: 45 min at 3wk, 75 at 8wk, 90 at 12wk, 120 at 18wk. Welfare charities
   converge on 45-60 min while awake for a young puppy, which the size factor
   brings us close to for small breeds. */

const POTTY_POINTS = [[3, 45], [8, 75], [12, 90], [18, 120], [24, 180]];

function pottyBaseMinutes(weeks) {
  if (weeks === null) return null;
  const P = POTTY_POINTS;
  if (weeks <= P[0][0]) return P[0][1];
  if (weeks >= P[P.length - 1][0]) return P[P.length - 1][1];
  for (let i = 0; i < P.length - 1; i++) {
    const [w0, m0] = P[i], [w1, m1] = P[i + 1];
    if (weeks >= w0 && weeks <= w1) return m0 + (m1 - m0) * ((weeks - w0) / (w1 - w0));
  }
  return P[P.length - 1][1];
}

/* `slider` lets a household relax or tighten the schedule. The research supports
   the short numbers, but a family that finds them punishing will stop logging
   entirely — and an app they ignore helps nobody. 1.0 = as researched. */
function pottyIntervalMinutes(dog, now, slider) {
  const w = ageWeeks(dog.dob, now);
  if (w === null) return null;
  const base = pottyBaseMinutes(w);
  const p = sizeParams(dog);
  const ceiling = (ageMonths(dog.dob, now) + 1) * 60;   // +1 rule, as a CAP only
  const raw = Math.min(base * p.pottyFactor, ceiling);
  return Math.round(raw * (slider || 1));
}

/* Triggers override the clock by pulling nextDue forward. They never push it
   back — a puppy who just woke up does not get longer because the clock says so. */
const POTTY_TRIGGERS = {
  wake:       { label: 'Woke up',        offsetMin: 0 },
  crateOut:   { label: 'Out of crate',   offsetMin: 0 },
  meal:       { label: 'Ate',            offsetMin: 30, softPromptMin: 15 },
  drink:      { label: 'Drank',          offsetMin: 20 },
  play:       { label: 'Played',         offsetMin: 10 },
  excitement: { label: 'Visitors / excited', offsetMin: 10 },
  signal:     { label: 'She asked',      offsetMin: 0, always: true }
};

function applyTrigger(nextDueTs, trigger, atTs) {
  const t = POTTY_TRIGGERS[trigger];
  if (!t) return nextDueTs;
  const candidate = atTs + t.offsetMin * 60000;
  return nextDueTs === null ? candidate : Math.min(nextDueTs, candidate);
}

/* Night intervals stretch, but earn it. Starts at 2x the daytime interval and
   moves in quarter steps. "Sleeping through" is declared only after 10 clean
   nights, because one good night is noise and families over-read it. */
function nightMultiplier(cleanNightStreak, accidentsLastNight) {
  let m = 2.0 + 0.25 * Math.floor((cleanNightStreak || 0) / 5);
  if (accidentsLastNight > 0) m -= 0.25;
  return Math.max(1.5, Math.min(4.0, m));
}
function sleepsThroughNight(cleanNightStreak) { return (cleanNightStreak || 0) >= 10; }

/* ---------- overnight ----------
   Nobody is setting an alarm for 3am, and a schedule that assumes they are
   produces guilt and then a closed app. So overnight is a declared state
   rather than a gap in the data.

   The honest position, which the app should state once and then stop
   repeating: a puppy of 8-10 weeks usually needs 1-2 breaks in the night, and
   most sleep through at around 4-5 months. If nobody gets up before then,
   there will be overnight accidents. That is a management problem — put her
   somewhere the accident is survivable — not a training failure, and the
   daytime trend should not be dragged down by it. */

function isOvernight(date, bedtime, wakeTime) {
  const h = date.getHours() + date.getMinutes() / 60;
  const b = bedtime == null ? 22 : bedtime;
  const w = wakeTime == null ? 7 : wakeTime;
  return b > w ? (h >= b || h < w) : (h >= b && h < w);
}

/* The window before bed where a last trip out is worth prompting — the single
   highest-value trip of the day if nobody is getting up later. */
const LAST_CALL_MINUTES = 45;

function isLastCall(date, bedtime) {
  const b = bedtime == null ? 22 : bedtime;
  const h = date.getHours() + date.getMinutes() / 60;
  const mins = (b - h) * 60;
  return mins > 0 && mins <= LAST_CALL_MINUTES;
}

function nextWakeTs(now, wakeTime) {
  const w = wakeTime == null ? 7 : wakeTime;
  const d = new Date(now);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(w), Math.round((w % 1) * 60), 0, 0);
  if (target.getTime() <= now) target.setDate(target.getDate() + 1);
  return target.getTime();
}

/* How many night breaks a puppy this age typically still needs. Used to set
   expectations honestly, never to instruct someone to get up. */
function expectedNightBreaks(weeks) {
  if (weeks === null) return null;
  if (weeks < 10) return 2;
  if (weeks < 14) return 1;
  if (weeks < 20) return 1;
  return 0;
}

/* ---------- absence ladder ----------
   Starts at 5 SECONDS, not 5 minutes. ~80% of reps sit at or below the current
   base: randomised difficulty beats a linear ramp because under a ramp every rep
   is the hardest the dog has ever done, which builds anticipatory dread. */

const LADDER_START_SECONDS = 5;
const LADDER_GRADUATE_SECONDS = 5400;   // 90 min — most dogs calm at 90 cope with 4-8h

const OUTCOMES = { CALM: 'CALM', MILD: 'MILD_UNREST', DISTRESS: 'DISTRESS', UNKNOWN: 'UNKNOWN' };

function ladderGrowthStep(baseSec) {
  if (baseSec < 30)   return 5;
  if (baseSec < 120)  return 15;
  if (baseSec < 600)  return 60;
  if (baseSec < 2400) return 180;
  return 300;
}

/* Age ceilings from the welfare literature — but for a young puppy the BLADDER
   usually binds first, and an absence rep that ends in an accident teaches the
   wrong thing about being alone. Callers pass the potty interval in. */
function absenceCeilingSeconds(weeks, pottyIntervalMin) {
  return absenceCeilingDetail(weeks, pottyIntervalMin).seconds;
}

/* Which limit actually bit matters for the copy, not just the number: "she's
   still too young" and "she'd need the toilet" call for different next steps,
   and the answer flips within a fortnight — at 10 weeks age binds at 60 min,
   at 11 the age ceiling rises to 90 and the bladder becomes the constraint. */
function absenceCeilingDetail(weeks, pottyIntervalMin) {
  let byAge;
  if (weeks === null) byAge = 60 * 60;
  else if (weeks <= 10) byAge = 60 * 60;
  else if (weeks <= 12) byAge = 90 * 60;
  else if (weeks <= 16) byAge = 120 * 60;
  else byAge = 240 * 60;
  const byBladder = pottyIntervalMin ? pottyIntervalMin * 60 : Infinity;
  return byBladder < byAge
    ? { seconds: byBladder, boundBy: 'bladder' }
    : { seconds: byAge, boundBy: 'age' };
}

/* rnd is injected so tests are deterministic. */
function planAbsenceRep(baseSec, ceilingSec, rnd) {
  const r = (rnd || Math.random)();
  if (r < 0.25) return { kind: 'departureCue', seconds: 0, note: 'Keys, coat, door — then sit back down. No absence.' };
  const b = (rnd || Math.random)();
  let mult;
  if (b < 0.40)      mult = 0.25 + (rnd || Math.random)() * 0.35;   // easy
  else if (b < 0.80) mult = 0.60 + (rnd || Math.random)() * 0.40;   // threshold
  else               mult = 1.00 + (rnd || Math.random)() * 0.15;   // stretch
  const seconds = Math.max(1, Math.min(Math.round(baseSec * mult), ceilingSec));
  return { kind: 'absence', seconds, mult };
}

/* UNKNOWN deliberately behaves like MILD, never like a pass: an unwatched
   session is not evidence the dog was calm. Above 5 minutes we refuse to advance
   on unmonitored data at all — a dog can be silent and still panicking, and
   veterinary guidance calls video imperative for exactly this reason. */
function updateLadder(state, rep) {
  const s = { base: state.base, consecutiveCalm: state.consecutiveCalm || 0, locked: !!state.locked };
  const ratio = s.base > 0 ? rep.actualSeconds / s.base : 0;

  if (rep.outcome === OUTCOMES.DISTRESS) {
    s.base = Math.max(LADDER_START_SECONDS, Math.round(s.base / 2));
    s.consecutiveCalm = 0;
    s.action = 'halved';
    return s;
  }
  if (rep.outcome === OUTCOMES.CALM && ratio >= 0.9) {
    if (s.base > 300 && !rep.monitored) { s.consecutiveCalm = 0; s.action = 'heldUnmonitored'; return s; }
    s.consecutiveCalm += 1;
    if (s.consecutiveCalm >= 3) {
      s.base = s.base + ladderGrowthStep(s.base);
      s.consecutiveCalm = 0;
      s.action = s.base >= LADDER_GRADUATE_SECONDS ? 'graduated' : 'grew';
      return s;
    }
    s.action = 'progress';
    return s;
  }
  s.consecutiveCalm = 0;
  s.action = 'held';
  return s;
}

/* True separation anxiety is a clinical panic disorder with licensed drugs, not
   a training gap. These are hard stops: the ladder locks and the app refers out.
   Being encouraging past this line is where an app can do real harm. */
function separationRedFlags(history, state, weeksAtBase) {
  const f = [];
  if (history.some(r => r.selfInjury || r.escapeDamage)) f.push('Self-injury or damage from trying to escape');
  const last7 = history.slice(-7);
  if (last7.filter(r => r.outcome === OUTCOMES.DISTRESS).length >= 3) f.push('Distress in 3 of the last 7 sessions');
  if (state.base < 60 && weeksAtBase >= 3) f.push('No progress past 60 seconds after 3 weeks');
  if (history.some(r => r.actualSeconds <= 5 && r.outcome === OUTCOMES.DISTRESS)) f.push('Distress at almost no duration');
  if (history.some(r => r.foodRefused)) f.push('Refusing food while alone');
  return f;
}

/* ---------- sleep and arousal ----------
   The 18-20h figure is convention, not a controlled finding, so it is a BAND and
   never a target a family can fail. What IS peer-reviewed is that sleep matters
   for canine learning (Kis et al. 2017) — and bite-pressure control is the first
   thing to go when a puppy is short of it. */

const SLEEP_BAND_HOURS = [18, 20];

function wakeWindowMinutes(weeks) {
  if (weeks === null) return [60, 90];
  if (weeks <= 12) return [60, 90];
  if (weeks <= 16) return [75, 105];
  if (weeks <= 24) return [90, 150];
  return [120, 240];
}
function isOvertired(minsSinceSleep, weeks) {
  const [, max] = wakeWindowMinutes(weeks);
  return minsSinceSleep !== null && minsSinceSleep > max;
}

const BITE_SEVERITY = [
  { level: 1, label: 'Touch',    hint: 'Teeth on skin, no pressure' },
  { level: 2, label: 'Pinch',    hint: 'Noticeable, no mark' },
  { level: 3, label: 'Ouch',     hint: 'Hurt, left a red mark' },
  { level: 4, label: 'Scratch',  hint: 'Broke skin, a graze' },
  { level: 5, label: 'Puncture', hint: 'Broke skin, a hole' }
];

/* ---------- socialisation window ----------
   Sensitive period ~3-12 weeks, strong to 14, tapering to ~16. Presented as a
   taper, never a gate that slams: both "it's over" and "it doesn't matter" are
   wrong. There is no completion state — the only controlled trial found gains
   faded by 6 months without continuation. */

const SOCIALISATION_CORE_DEADLINE_WEEKS = 16;

function socialisationPhase(weeks) {
  if (weeks === null) return { phase: 'unknown' };
  if (weeks < 12) return { phase: 'peak',    daysLeftToCore: Math.round((SOCIALISATION_CORE_DEADLINE_WEEKS - weeks) * 7) };
  if (weeks < 14) return { phase: 'closing', daysLeftToCore: Math.round((SOCIALISATION_CORE_DEADLINE_WEEKS - weeks) * 7) };
  if (weeks < 16) return { phase: 'taper',   daysLeftToCore: Math.round((SOCIALISATION_CORE_DEADLINE_WEEKS - weeks) * 7) };
  return { phase: 'maintenance', daysLeftToCore: 0 };
}

/* Fear periods are near-universal in professional practice but rest largely on
   mid-century work and clinical observation; the systematic review does not
   treat them as firmly evidenced. Hence "commonly seen", never "this will
   happen" — and the UI must carry that hedge. */
function fearPeriodBanner(weeks, dog) {
  if (weeks === null) return null;
  if (weeks >= 8 && weeks <= 11) {
    return { id: 'first', title: 'Puppies this age are commonly more easily spooked',
             body: 'Many puppies go through a wary spell around 8-11 weeks. If something worries her, make it easier rather than pushing on. This is commonly seen, not certain.' };
  }
  const mo = weeks / 4.345;
  const [a, b] = sizeParams(dog).secondFearMo;
  if (mo >= a && mo <= b) {
    return { id: 'second', title: 'Adolescence often brings a second wary spell',
             body: 'Things she was fine with may worry her again for a while. Go back a step rather than pushing through. Commonly seen, not certain.' };
  }
  return null;
}

/* ---------- curriculum thresholds ---------- */

const PASS_THRESHOLD = 0.8;
const RECALL_PASS_THRESHOLD = 0.9;   // its failure mode is a road
const MAX_LURED_REPS = 5;
const MAX_BLOCKS_PER_SKILL_PER_DAY = 2;
const LONG_SESSION_WARN_MINUTES = 20;

/* Dogs do not generalise across people — demonstrated experimentally, not
   folklore. So two handlers passing is STRUCTURAL, not advice. It also reframes
   "she's fine for me, hopeless for Mum" as the dog's gap rather than Mum's,
   which is probably what decides whether a non-technical handler keeps going. */
function readyToLevelUp(behaviour, progress) {
  const reasons = [];
  const need = behaviour.id === 'recall' ? RECALL_PASS_THRESHOLD : PASS_THRESHOLD;
  const recent = (progress.reps || []).slice(-10);

  if (recent.length < 10) reasons.push(`Needs ${10 - recent.length} more tries at this level`);
  else {
    const rate = recent.filter(r => r.success).length / recent.length;
    if (rate < need) reasons.push(`${Math.round(rate * 100)}% right — needs ${Math.round(need * 100)}%`);
  }
  const handlers = new Set(recent.filter(r => r.success).map(r => r.by));
  if (handlers.size < 2) reasons.push('Needs a second person to get it too');
  if (progress.level >= 1 && recent.some(r => r.lureUsed)) reasons.push('Still using food to lure — fade it first');
  if ((progress.dsRaisedTogether || 0) > 1) reasons.push('Only raise one of distance, duration or distraction at a time');

  return { ready: reasons.length === 0, reasons };
}

/* ---------- exercise ----------
   Deliberately NOT minutes. Any duration control silently re-imports the
   five-minutes-per-month rule, which has no source study. The evidence supports
   a type-and-surface distinction: self-paced play on soft uneven ground was
   protective for hips; stairs before 3 months and slippery floors raised risk;
   repetitive ball-chasing at 12-24 months raised risk. */

function exerciseVerdict(activity, dog, now) {
  const mo = ageMonths(dog.dob, now);
  const p = sizeParams(dog);
  const A = {
    freePlaySoft:   { verdict: 'green', why: 'Self-paced play on grass or soft ground. She chooses when to stop.' },
    sniffWalk:      { verdict: 'green', why: 'Her nose sets the pace. Settling rather than tiring.' },
    stairs:         { verdict: mo !== null && mo < 3 ? 'red' : 'amber', why: mo !== null && mo < 3 ? 'Stair use before 3 months was linked to higher hip dysplasia risk.' : 'Occasional is fine; repeated up-and-down is the part linked to risk.' },
    slipperyFloors: { verdict: 'red', why: 'Hard slick floors are a named injury and joint risk. Rugs and runners fix it.' },
    repeatedFetch:  { verdict: mo !== null && mo < p.forcedExerciseBlockedMo ? 'red' : 'amber', why: 'Repetitive hard chasing and turning was linked to higher risk. Short and occasional, not a routine.' },
    joggingAlong:   { verdict: mo !== null && mo < p.forcedExerciseBlockedMo ? 'red' : 'green', why: `Forced repetitive distance. Wait until about ${p.forcedExerciseBlockedMo} months for her size.` },
    jumpingDown:    { verdict: 'amber', why: 'Off furniture and out of cars, repeatedly. A ramp or a lift is kinder to growing joints.' }
  };
  return A[activity] || { verdict: 'amber', why: 'If she cannot choose to stop, treat it as red.' };
}

const EXERCISE_RULE = 'If your puppy can’t choose to stop, it’s red.';

/* ---------- breed ----------
   Breed explains ~9% of behavioural variation between individual dogs (Morrill
   2022, Science). Behaviour is heritable, just not breed-partitioned — and the
   signal sits where owners least want it: biddability is among the most
   breed-differentiated traits, provocation threshold among the least.

   So breed may change what you OFFER and the ORDER items appear. It may never
   change what we expect the dog to be, and may never reduce a training,
   socialisation or supervision requirement. Bumps only, never cuts. */

const BREED_CONTENT_CAP = 0.15;

const FUNCTIONAL_GROUPS = {
  herding:   { label: 'Herding',            outlet: 'Chase-and-catch games with a flirt pole or a rolling ball, on a cue to start and stop.', bumps: ['settle', 'leaveIt'] },
  terrier:   { label: 'Terrier',            outlet: 'Digging box, shredding-safe toys, short intense tug with rules.', bumps: ['drop', 'settle'] },
  scenthound:{ label: 'Scent hound',        outlet: 'Scatter feeding and find-it games. Let the nose work.',           bumps: ['recall'] },
  sighthound:{ label: 'Sighthound',         outlet: 'Lure-chase in a safe enclosed space.',                            bumps: ['recall', 'leaveIt'] },
  gundog:    { label: 'Retriever / gundog', outlet: 'Carrying and retrieving with a swap built in.',                   bumps: ['drop', 'trade'] },
  guardian:  { label: 'Guardian',           outlet: 'Calm novel-thing exposure at a distance she chooses.',            bumps: ['settle', 'greeting'] },
  northern:  { label: 'Northern / sled',    outlet: 'Long sniffing routes and pulling a harness-safe load when grown.', bumps: ['recall'] },
  companion: { label: 'Companion / toy',    outlet: 'Handling games and short training bursts.',                       bumps: ['handling', 'greeting'] },
  working:   { label: 'Working',            outlet: 'Task games — carry, find, place.',                                bumps: ['settle'] },
  bully:     { label: 'Bull breed',         outlet: 'Structured tug and chew work.',                                   bumps: ['drop', 'settle'] },
  mixed:     { label: 'Mixed / unknown',    outlet: 'Try a few and keep what she likes.',                              bumps: [] },
  unknown:   { label: 'Not sure',           outlet: 'Try a few and keep what she likes.',                              bumps: [] }
};

/* A visual or shelter breed guess matches DNA roughly a quarter of the time.
   That isn't weak data, it's confident noise — so it routes to unknown rather
   than seeding the model. */
function breedGroupFor(dog) {
  if (!dog.breedGroup) return 'unknown';
  if (dog.breedConfidence === 'guess' || dog.breedConfidence === 'shelter') return 'unknown';
  return FUNCTIONAL_GROUPS[dog.breedGroup] ? dog.breedGroup : 'unknown';
}

/* The honest personalisation lever: individual observation out-predicts breed.
   Breed only pre-ticks these, and every one stays editable. */
const BEHAVIOUR_CHECKLIST = [
  { id: 'chasesMovement', label: 'Chases anything that moves' },
  { id: 'noseDown',       label: 'Nose glued to the ground' },
  { id: 'shredsToys',     label: 'Shreds and dissects toys' },
  { id: 'hardToSettle',   label: 'Struggles to switch off' },
  { id: 'waryOfNew',      label: 'Wary of new people or things' },
  { id: 'mouthyWhenUp',   label: 'Gets mouthy when excited' },
  { id: 'carriesThings',  label: 'Carries things around' },
  { id: 'vocal',          label: 'Vocal — barks or talks a lot' }
];

/* ---------- confinement ----------
   Crates are sufficient, not necessary. What the evidence supports is overnight
   containment of SOME kind plus 9+ hours sleep — "crate or room". The welfare
   line is about duration and involuntariness, not the box. "Dogs are den
   animals" is folklore and is not used anywhere in this app. */

const CONFINEMENT_TYPES = {
  crate:     { label: 'A crate',            nightNoun: 'her crate' },
  pen:       { label: 'A pen',              nightNoun: 'her pen' },
  gatedRoom: { label: 'A gated room',       nightNoun: 'her room' },
  freeRoam:  { label: 'She has the run of a room', nightNoun: 'her bed' },
  undecided: { label: 'Still deciding',     nightNoun: 'her bed' }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIZE_CLASSES, SIZE_PARAMS, SIZE_LABELS, sizeClassFromAdultLb, resolveSizeClass, sizeParams,
    ageDays, ageWeeks, ageMonths, dobFromAgeWeeks,
    pottyBaseMinutes, pottyIntervalMinutes, POTTY_TRIGGERS, applyTrigger, nightMultiplier, sleepsThroughNight,
    LADDER_START_SECONDS, LADDER_GRADUATE_SECONDS, OUTCOMES, ladderGrowthStep, absenceCeilingSeconds,
    planAbsenceRep, updateLadder, separationRedFlags, absenceCeilingDetail,
    isOvernight, isLastCall, nextWakeTs, expectedNightBreaks, LAST_CALL_MINUTES,
  SLEEP_BAND_HOURS, wakeWindowMinutes, isOvertired, BITE_SEVERITY,
    SOCIALISATION_CORE_DEADLINE_WEEKS, socialisationPhase, fearPeriodBanner,
    PASS_THRESHOLD, RECALL_PASS_THRESHOLD, MAX_LURED_REPS, MAX_BLOCKS_PER_SKILL_PER_DAY,
    LONG_SESSION_WARN_MINUTES, readyToLevelUp,
    exerciseVerdict, EXERCISE_RULE,
    BREED_CONTENT_CAP, FUNCTIONAL_GROUPS, breedGroupFor, BEHAVIOUR_CHECKLIST,
    CONFINEMENT_TYPES
  };
}
