/* Scout — onboarding, and the same screens reused for editing.
 *
 * One question per screen. No dropdowns, no multi-field forms, no progress bar
 * that implies a long road. Two of the people this is built for are not
 * technical, and the fastest way to lose them is a dense settings page.
 *
 * Only three answers are required — the dog's name, her age, and roughly how
 * big she'll get — because those three drive every interval and ceiling in
 * params.js. Everything else can be skipped.
 *
 * EDITING REUSES THESE SCREENS. `Onboard.edit('dob')` reopens the age step with
 * the current value and writes straight back to the store. An estimated age is
 * corrected constantly — the paperwork turns up, the vet gives a better guess —
 * and the previous build's only correction path was "delete everything".
 *
 * LOAD ORDER: after ui.js.
 */

const Onboard = (() => {
  let step = 0;
  let draft = {};
  let editing = null;          // field name when reusing a screen to edit

  const STEPS = [
    'welcome', 'join', 'yourName', 'dogName', 'dogAge',
    'dogSize', 'deepChest', 'confinement', 'breed', 'checklist', 'done'
  ];

  /* which screen edits which field */
  const FIELD_STEP = {
    name: 'dogName', dob: 'dogAge', sizeClass: 'dogSize',
    deepChested: 'deepChest', confinementType: 'confinement',
    breedGroup: 'breed', traits: 'checklist'
  };

  function go(name) { step = STEPS.indexOf(name); App.render(); window.scrollTo({ top: 0 }); }

  function next() {
    /* In edit mode a screen is a one-shot: save and go back to Settings rather
       than marching the user through the rest of setup again. */
    if (editing) { saveEdit(); return; }
    let i = step + 1;
    while (i < STEPS.length && !applies(STEPS[i])) i++;
    step = i;
    App.render();
    window.scrollTo({ top: 0 });
  }

  function applies(name) {
    if (name === 'join') return false;          // only reached deliberately
    if (name === 'deepChest') {
      const cls = draft.sizeClass;
      return cls === 'medium' || cls === 'large' || cls === 'giant';
    }
    return true;
  }

  /* ---------- edit mode ---------- */

  function edit(field) {
    editing = field;
    draft = Object.assign({}, Store.state.dog);
    step = STEPS.indexOf(FIELD_STEP[field] || 'dogName');
    App.render();
    window.scrollTo({ top: 0 });
  }

  function saveEdit() {
    Store.setDog({
      name: draft.name,
      dob: draft.dob,
      dobEstimated: !!draft.dobEstimated,
      sizeClass: draft.sizeClass,
      sizeClassConfirmed: !!draft.sizeClassConfirmed,
      deepChested: !!draft.deepChested,
      deepChestedKnown: !!draft.deepChestedKnown,
      confinementType: draft.confinementType,
      breedGroup: draft.breedGroup || null,
      breedConfidence: draft.breedConfidence || 'unknown',
      traits: draft.traits || []
    });
    editing = null;
    toast('Saved');
    App.goTab('settings');
  }

  function cancelEdit() { editing = null; App.goTab('settings'); }

  /* ---------- screens ---------- */

  function render() {
    const s = STEPS[step] || 'welcome';
    return `<div class="ob">${editing ? editChrome() : ''}${SCREENS[s]()}</div>`;
  }

  function editChrome() {
    return `<button class="back" data-action="ob-cancel-edit">${icon('back', 20)} Cancel</button>`;
  }

  const SCREENS = {

    welcome: () => `
      <div class="ob-hero">
        <div class="ob-mark">${icon('paw', 44)}</div>
        <h1>Scout</h1>
        <p class="ob-sub">A place to keep track of your puppy — what's been done, what's due, and why she's behaving the way she is.</p>
      </div>

      ${scaleRow()}

      ${shouldWarnAboutInstall() ? installFirstCard() : ''}

      ${bigButton({ action: 'ob-start', label: 'Set up my puppy', sub: 'Takes about a minute' })}
      ${firebaseConfigured() ? bigButton({ action: 'ob-join-screen', label: 'Join my family', sub: 'Someone gave me a code', tone: 'quiet' }) : ''}

      <p class="ob-foot">${firebaseConfigured()
        ? 'Whoever sets up first can invite the rest of the household — everyone then sees the same puppy.'
        : 'Scout works on one phone at the moment. Everything stays on your device; nothing is sent anywhere.'}</p>
      <p class="ob-foot">Scout is not a vet. If something about your puppy worries you, call your vet — this app will always tell you to do that rather than guess.</p>`,

    join: () => `
      ${backBtn('welcome')}
      <h2>What's the code?</h2>
      <p class="ob-lede">Ask whoever set Scout up to tap <strong>Invite someone</strong> in Settings. Codes last an hour.</p>
      ${field({ id: 'ob-join-name', label: 'Your name', value: '', placeholder: 'e.g. Dad' })}
      ${field({ id: 'ob-code', label: 'Invite code', placeholder: 'ABC123' })}
      ${bigButton({ action: 'ob-do-join', label: 'Join' })}`,

    yourName: () => `
      ${backBtn()}
      <h2>Who are you?</h2>
      <p class="ob-lede">So later on you can see who did what. You'll never have to pick your name again — this phone remembers it.</p>
      ${field({ id: 'ob-me', label: 'Your name', value: draft.myName || '', placeholder: 'e.g. Sue' })}
      ${bigButton({ action: 'ob-set-me', label: 'Continue' })}`,

    dogName: () => `
      ${editing ? '' : backBtn()}
      <h2>What's your puppy called?</h2>
      ${field({ id: 'ob-dog', label: 'Puppy’s name', value: draft.name || '' })}
      ${bigButton({ action: 'ob-set-dogname', label: editing ? 'Save' : 'Continue' })}`,

    dogAge: () => `
      ${editing ? '' : backBtn()}
      <h2>How old is ${esc(draft.name || 'your puppy')}?</h2>
      <p class="ob-lede">This matters more than anything else you'll enter. How often she needs the toilet, how long she can be left, and what to work on next are all worked out from her age.</p>

      <h3 class="ob-h3">If you know her birthday</h3>
      ${field({ id: 'ob-dob', label: 'Date of birth', type: 'date', value: draft.dob || '', max: new Date().toISOString().slice(0, 10) })}
      ${bigButton({ action: 'ob-set-dob', label: 'Use this date' })}

      <div class="ob-or"><span>or</span></div>

      <h3 class="ob-h3">If you're not sure</h3>
      <p class="ob-lede">An estimate is fine. You can change it whenever you find out — Settings, then her name.</p>
      ${choiceList('ob-set-age-weeks', [
        { value: '8',  label: 'About 8 weeks' },
        { value: '10', label: 'About 10 weeks' },
        { value: '12', label: 'About 12 weeks' },
        { value: '16', label: 'About 4 months' },
        { value: '20', label: 'About 5 months' },
        { value: '26', label: '6 months or more' }
      ])}`,

    dogSize: () => `
      ${editing ? '' : backBtn()}
      <h2>How big will ${esc(draft.name || 'she')} get?</h2>
      <p class="ob-lede">Grown-up size, not now. Bigger dogs grow for longer, so this changes how long she needs before running and jumping are safe.</p>
      ${choiceList('ob-set-size', [
        { value: 'toy',    label: 'Toy',    sub: 'Under 12 lb — Chihuahua, Yorkie' },
        { value: 'small',  label: 'Small',  sub: '12 to 24 lb — Cavalier, Westie' },
        { value: 'medium', label: 'Medium', sub: '25 to 49 lb — Beagle, Border Collie' },
        { value: 'large',  label: 'Large',  sub: '50 to 89 lb — Labrador, German Shepherd' },
        { value: 'giant',  label: 'Giant',  sub: '90 lb or more — Great Dane, Newfoundland' }
      ], draft.sizeClassConfirmed ? draft.sizeClass : null)}
      ${bigButton({ action: 'ob-size-unsure', label: 'I really don’t know', tone: 'quiet' })}
      <p class="ob-foot">If you're not sure, Scout assumes she'll be on the larger side. That's the cautious way round — it protects growing joints for longer.</p>`,

    deepChest: () => `
      ${editing ? '' : backBtn()}
      <h2>Is she deep-chested?</h2>
      <p class="ob-lede">Deep and narrow through the ribcage, rather than barrel-shaped. Think Great Dane, Standard Poodle, Weimaraner, Setter, Boxer.</p>
      ${noteHtml('This one matters. Deep-chested dogs are at higher risk of a twisted stomach, which is a genuine emergency — so Scout will show you what to watch for.', 'warn')}
      ${choiceList('ob-set-chest', [
        { value: 'yes',    label: 'Yes, deep and narrow' },
        { value: 'no',     label: 'No, more barrel-shaped' },
        { value: 'unsure', label: 'I’m not sure', sub: 'Scout will show you the warning signs anyway' }
      ])}`,

    confinement: () => `
      ${editing ? '' : backBtn()}
      <h2>Where does ${esc(draft.name || 'she')} sleep?</h2>
      <p class="ob-lede">There's no right answer here. Scout doesn't push crates — what the evidence supports is somewhere enclosed and a good long sleep, and that can be any of these.</p>
      ${choiceList('ob-set-confine', [
        { value: 'crate',     label: 'A crate' },
        { value: 'pen',       label: 'A pen' },
        { value: 'gatedRoom', label: 'A gated room' },
        { value: 'freeRoam',  label: 'Run of a room' },
        { value: 'undecided', label: 'Still working it out' }
      ], draft.confinementType)}`,

    breed: () => `
      ${editing ? '' : backBtn()}
      <h2>Do you know her breed?</h2>
      <p class="ob-lede">You can skip this. Breed turns out to explain only a small part of how an individual dog behaves, so Scout uses it for one thing only — suggesting games she might enjoy.</p>
      ${choiceList('ob-set-breedgroup', Object.keys(FUNCTIONAL_GROUPS)
          .filter(k => k !== 'unknown')
          .map(k => ({ value: k, label: FUNCTIONAL_GROUPS[k].label })), draft.breedGroup)}
      ${bigButton({ action: 'ob-skip-breed', label: editing ? 'Clear this' : 'Skip this', tone: 'quiet' })}
      <p class="ob-foot">If her breed was a guess — from a shelter, or from how she looks — choose Skip. Visual guesses match a DNA test only about a quarter of the time, so a guess is worse than nothing here.</p>`,

    checklist: () => `
      ${editing ? '' : backBtn()}
      <h2>What's ${esc(draft.name || 'she')} like?</h2>
      <p class="ob-lede">Tick anything that sounds like her. This tells Scout more than her breed does. Nothing here is a problem — it's just what she's drawn to.</p>
      <div class="checks">
        ${BEHAVIOUR_CHECKLIST.map(c => `
          <button class="check${(draft.traits || []).includes(c.id) ? ' is-on' : ''}"
                  data-action="ob-toggle-trait" data-value="${esc(c.id)}"
                  aria-pressed="${(draft.traits || []).includes(c.id)}">
            <span class="ck-box">${icon('check', 18)}</span>
            <span>${esc(c.label)}</span>
          </button>`).join('')}
      </div>
      ${bigButton({ action: 'ob-finish', label: editing ? 'Save' : 'Finish setup' })}`,

    done: () => doneScreen()
  };

  function backBtn(to) {
    if (step <= 2 && !to) return '';           // nothing useful to go back to
    return `<button class="back" data-action="ob-back"${to ? ` data-value="${esc(to)}"` : ''}>${icon('back', 20)} Back</button>`;
  }

  /* Text size lives on the FIRST screen, not buried in Settings. Putting the
     control that makes text readable behind three taps of unreadable text is a
     chicken-and-egg problem for exactly the people this app is for. */
  function scaleRow() {
    const cur = Store.state.settings.scale;
    return `<div class="scale-row" role="group" aria-label="Text size">
      <span class="scale-label">Text size</span>
      ${['normal', 'large', 'largest'].map((s, i) => `
        <button class="scale-btn${cur === s ? ' is-on' : ''}" data-action="set-scale" data-value="${s}"
                aria-pressed="${cur === s}" style="font-size:${0.95 + i * 0.22}rem">A</button>`).join('')}
    </div>`;
  }

  /* The single most destructive thing that can happen to a new iOS user: set up
     in Safari, add to the Home Screen, and open an empty app, because the two
     live in different storage containers. Getting them to install FIRST is the
     only mitigation that exists until sync lands. */
  function installFirstCard() {
    return `<div class="install-card">
      <h3>${icon('warn', 20)} Add Scout to your Home Screen first</h3>
      <p>On iPhone, an app on your Home Screen can't see anything you set up in Safari. If you set up here and add it afterwards, you'll have to start again.</p>
      <ol>
        <li>Tap the <strong>Share</strong> button at the bottom of Safari</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
        <li>Tap <strong>Add</strong>, then open Scout from your Home Screen</li>
      </ol>
      <p class="install-foot">It's also the only way reminders can reach you later.</p>
    </div>`;
  }

  /* The payoff screen. A setup flow that ends in a shrug feels like it took
     information and gave nothing back — so this shows the numbers her answers
     just produced, all live and all explained. */
  function doneScreen() {
    const now = Date.now();
    const dog = draft;
    const w = ageWeeks(dog.dob, now);
    const p = sizeParams(dog);
    const interval = pottyIntervalMinutes(dog, now, 1);
    const ceil = absenceCeilingDetail(w, interval);
    const soc = socialisationPhase(w);
    const [wwMin, wwMax] = wakeWindowMinutes(w);

    return `
      <div class="ob-hero">
        <div class="ob-mark ok">${icon('check', 44)}</div>
        <h1>${esc(dog.name || 'Your puppy')} is all set</h1>
        <p class="ob-sub">${esc(fmtAge(w))} · ${esc(SIZE_LABELS[p.sizeClass] || '')}</p>
      </div>

      <p class="ob-lede">Here's what that tells us. These aren't generic numbers — they're worked out from her age and size.</p>

      ${card(`
        <h2>Toilet breaks</h2>
        <p class="stat-big">Every ${esc(fmtDuration(interval))}</p>
        <p class="stat-why">While she's awake. Straight after waking, eating, drinking or playing, take her out regardless of the clock — and always when she asks.</p>
      `)}

      ${card(`
        <h2>Being left alone</h2>
        <p class="stat-big">Up to ${esc(fmtDuration(ceil.seconds / 60))}</p>
        <p class="stat-why">${ceil.boundBy === 'bladder'
          ? 'Her bladder is what sets that, not her confidence — so it stretches as she grows.'
          : 'That’s an age limit rather than a bladder one, and it lifts as she gets older.'} Alone-time training starts at five <em>seconds</em>, not five minutes — and builds from there.</p>
      `)}

      ${card(`
        <h2>Sleep</h2>
        <p class="stat-big">${esc(SLEEP_BAND_HOURS[0])}–${esc(SLEEP_BAND_HOURS[1])} hours a day</p>
        <p class="stat-why">Awake ${esc(wwMin)}–${esc(wwMax)} minutes at a stretch, then a nap. Most biting and wildness is an overtired puppy rather than a naughty one — so this is the first thing to check when she's impossible.</p>
      `)}

      ${soc.phase !== 'maintenance' && soc.daysLeftToCore > 0 ? card(`
        <h2>Meeting the world</h2>
        <p class="stat-big">${esc(soc.daysLeftToCore)} days</p>
        <p class="stat-why">The window where new experiences shape her most easily is closing. It tapers rather than slams shut, but this is the part that doesn't come back — so it's worth starting now rather than after her last vaccination.</p>
      `, 'urgent') : ''}

      ${p.gdvFlag ? noteHtml('<b>Because of her build:</b> if she ever tries to be sick and nothing comes up, and her belly looks tight or swollen — that is an emergency. Go to a vet immediately.', 'warn') : ''}

      ${bigButton({ action: 'ob-open', label: `Open ${draft.name || 'Scout'}` })}`;
  }

  /* ---------- actions ---------- */

  function handle(action, value, root) {
    const val = sel => (root.querySelector(sel)?.value || '').trim();

    switch (action) {
      case 'ob-start':       draft = {}; go('yourName'); return true;
      case 'ob-join-screen': go('join'); return true;

      case 'ob-do-join': {
        const name = val('#ob-join-name');
        const code = val('#ob-code');
        if (!name) { toast('Pop your name in first'); return true; }
        if (!code) { toast('Enter the code you were given'); return true; }
        toast('Joining…');
        /* The household has to exist locally before the merge lands, otherwise
           incoming members and events have nowhere to go. */
        Store.createHousehold(name);
        Sync.join(code, name).then(res => {
          if (!res.ok) { toast(res.error); Store.resetAll(); App.render(); return; }
          Store.finishOnboarding();
          App.goTab('today');
          toast('Joined — you’ll see everything the others log');
        });
        return true;
      }
      case 'ob-cancel-edit': cancelEdit(); return true;

      case 'ob-back': {
        if (value) { go(value); return true; }
        let i = step - 1;
        while (i > 0 && !applies(STEPS[i])) i--;
        step = Math.max(0, i); App.render(); return true;
      }

      case 'ob-set-me': {
        const n = val('#ob-me');
        if (!n) { toast('Pop your name in first'); return true; }
        draft.myName = n; next(); return true;
      }

      case 'ob-set-dogname': {
        const n = val('#ob-dog');
        if (!n) { toast('What should we call her?'); return true; }
        draft.name = n; next(); return true;
      }

      case 'ob-set-dob': {
        const d = val('#ob-dob');
        if (!d) { toast('Pick a date, or choose a rough age below'); return true; }
        if (new Date(d) > new Date()) { toast('That date is in the future'); return true; }
        draft.dob = d; draft.dobEstimated = false; next(); return true;
      }
      case 'ob-set-age-weeks':
        draft.dob = dobFromAgeWeeks(Number(value), Date.now());
        draft.dobEstimated = true;
        next(); return true;

      case 'ob-set-size':
        draft.sizeClass = value; draft.sizeClassConfirmed = true; next(); return true;
      case 'ob-size-unsure':
        /* left unconfirmed on purpose: resolveSizeClass() then defaults up for
           safety parameters but suppresses the large-breed food prompt, which is
           harmful in the wrong direction. */
        draft.sizeClass = null; draft.sizeClassConfirmed = false; next(); return true;

      case 'ob-set-chest':
        draft.deepChested = value === 'yes' || value === 'unsure';
        draft.deepChestedKnown = value !== 'unsure';
        next(); return true;

      case 'ob-set-confine': draft.confinementType = value; next(); return true;

      case 'ob-set-breedgroup':
        draft.breedGroup = value;
        draft.breedConfidence = 'known';
        if (!editing) draft.traits = seedTraits(value);
        next(); return true;
      case 'ob-skip-breed':
        draft.breedGroup = null; draft.breedConfidence = 'unknown'; next(); return true;

      case 'ob-toggle-trait': {
        const t = new Set(draft.traits || []);
        t.has(value) ? t.delete(value) : t.add(value);
        draft.traits = [...t];
        App.render(); return true;
      }

      case 'ob-finish':
        if (editing) { saveEdit(); return true; }
        commitDraft(); go('done'); return true;

      case 'ob-open': Store.finishOnboarding(); App.goTab('today'); return true;
    }
    return false;
  }

  /* Breed pre-ticks the checklist; it never locks it. The owner's own read of
     their dog is the better signal and must be able to overrule it. */
  function seedTraits(group) {
    const SEED = {
      herding:    ['chasesMovement', 'hardToSettle'],
      terrier:    ['shredsToys', 'chasesMovement'],
      scenthound: ['noseDown'],
      sighthound: ['chasesMovement'],
      gundog:     ['carriesThings'],
      guardian:   ['waryOfNew', 'vocal'],
      northern:   ['vocal', 'noseDown'],
      companion:  [],
      working:    ['hardToSettle'],
      bully:      ['mouthyWhenUp', 'shredsToys']
    };
    return (SEED[group] || []).slice();
  }

  function commitDraft() {
    Store.createHousehold(draft.myName || 'Me');
    Store.setDog({
      name: draft.name,
      dob: draft.dob,
      dobEstimated: !!draft.dobEstimated,
      sizeClass: draft.sizeClass,
      sizeClassConfirmed: !!draft.sizeClassConfirmed,
      deepChested: !!draft.deepChested,
      deepChestedKnown: !!draft.deepChestedKnown,
      confinementType: draft.confinementType || 'undecided',
      breedGroup: draft.breedGroup || null,
      breedConfidence: draft.breedConfidence || 'unknown',
      traits: draft.traits || [],
      createdAt: Date.now()
    });
  }

  return { render, handle, edit, get step() { return step; }, get editing() { return editing; }, go };
})();
