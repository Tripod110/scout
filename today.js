/* Scout — the Today screen.
 *
 * The only screen most people will ever look at. It answers three questions in
 * the order they're actually asked: what did I miss, what's due, what do I tap.
 *
 * Every log is one tap. Nothing asks who you are — the device knows. Nothing
 * asks for a time unless you say it already happened. A picker on the hot path
 * is what stops people logging, and the logs are what the whole app runs on.
 *
 * LOAD ORDER: after ui.js and params.js.
 */

const Today = (() => {

  /* ---------- the schedule ----------
     Triggers pull `nextDue` forward and never push it back. A puppy who just
     woke does not get longer because the clock says so. */
  function nextDue(now) {
    const dog = Store.state.dog;
    if (!dog?.dob) return null;
    const interval = pottyIntervalMinutes(dog, now, Store.state.settings.pottySlider);

    const last = Store.lastEventOf(['potty', 'accident']);
    let due = last ? last.ts + interval * 60000 : now;

    /* "nothing happened" doesn't reset the clock — it's a retry in 15 min.
       Dunbar's return-to-confinement rule: an empty trip is information, not a
       success, and treating it as one is how a 20-minute garden wander ends in
       a puddle on the rug. */
    if (last?.type === 'potty' && last.payload.result === 'nothing') {
      due = Math.min(due, last.ts + 15 * 60000);
    }

    for (const ev of Store.liveEvents()) {
      if (ev.ts <= (last?.ts || 0)) continue;
      const map = { meal: 'meal', drink: 'drink', sleepEnd: 'wake', play: 'play', crateOut: 'crateOut' };
      if (map[ev.type]) due = applyTrigger(due, map[ev.type], ev.ts);
    }
    return due;
  }

  /* Three empty trips in an hour is worth a nudge toward a vet — it can be a
     UTI, and that is not something an app should coach through. */
  function emptyTripRun(now) {
    const hourAgo = now - 3600000;
    return Store.liveEvents().filter(e => e.type === 'potty' && e.payload.result === 'nothing' && e.ts > hourAgo).length;
  }

  function minsSinceSleep(now) {
    const e = Store.lastEventOf('sleepEnd');
    return e ? Math.round((now - e.ts) / 60000) : null;
  }

  /* If a nap is still open and someone logs a wee or a nip, the puppy is
     demonstrably awake. Closing it from the evidence beats nagging them with a
     prompt, and it stops an unclosed nap silently disabling the wake-window
     timer — which is the most useful thing in the app. */
  const IMPLIES_AWAKE = new Set(['potty', 'accident', 'bite', 'meal', 'drink', 'play']);

  function closeNapIfImplied(type, now) {
    if (!IMPLIES_AWAKE.has(type)) return 0;
    const start = Store.openNap();
    if (!start) return 0;
    const mins = Math.max(1, Math.round((now - start.ts) / 60000));
    Store.addEvent('sleepEnd', { inferred: true }, now);
    Store.addEvent('sleep', { minutes: mins, inferred: true }, now);
    return mins;
  }

  /* ---------- render ---------- */

  function render() {
    const now = Date.now();
    const st = Store.state;
    const dog = st.dog;
    if (!dog) return '<p class="ob-lede">No puppy set up yet.</p>';

    const w = ageWeeks(dog.dob, now);
    const due = nextDue(now);
    const claim = Store.activeClaim(now);
    const overdue = due !== null && due <= now;
    const roll = Store.todayRollup(now);
    const handover = Store.sinceYouLastLooked(now);
    const fear = fearPeriodBanner(w, dog);
    const soc = socialisationPhase(w);
    const mss = minsSinceSleep(now);
    const tired = isOvertired(mss, w);
    const empties = emptyTripRun(now);
    const hasBaseline = !!Store.lastEventOf(['potty', 'accident']);
    const overnight = isOvernight(new Date(now), st.settings.bedtime, st.settings.wakeTime);
    const lastCall = isLastCall(new Date(now), st.settings.bedtime);

    let html = '';

    /* 1. What did I miss. Costs one rollup read and is probably the single
          highest-value element in a four-handler house. */
    if (handover?.length) {
      html += card(`
        <h2>Since you last looked</h2>
        <ul class="handover">${handover.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      `, 'handover-card');
    }

    /* 2. What's due — or, on the very first run, what to do at all.
          Opening a brand-new app on a red "NOW" alarm tells someone they have
          already failed thirty seconds after setting it up. There is no clock
          until there is a first event to start it from. */
    if (overnight) {
      /* No countdown, no red, no reminders. Nobody is getting up at 3am, and a
         clock that insists otherwise just teaches people to ignore the app. */
      const wakeTs = nextWakeTs(now, st.settings.wakeTime);
      const nights = expectedNightBreaks(w);
      html += card(`
        <h2>Goodnight</h2>
        <p class="stat-big">Back at ${esc(fmtTime(wakeTs))}</p>
        <p class="stat-why">Scout is quiet until morning — no reminders overnight. First thing when you're up, take her straight out; after a long sleep is the strongest signal there is.</p>
      `, 'night-card');

      if (nights > 0) {
        html += noteHtml(`<b>At ${esc(Math.floor(w))} weeks she probably still can’t last the whole night.</b> If nobody’s getting up — and most people aren’t — expect the odd overnight accident and set her up somewhere it doesn’t matter. Most puppies sleep right through at around four to five months. It isn’t a training failure.`, 'warn');
      }

      html += `
        <h3 class="row-head">If you're up anyway</h3>
        <div class="log-grid">
          <button class="log-btn primary" data-action="log-potty-went">
            <span class="lg-main">She went</span><span class="lg-sub">outside</span>
          </button>
          <button class="log-btn warn" data-action="log-accident">
            <span class="lg-main">Accident</span><span class="lg-sub">overnight</span>
          </button>
        </div>`;

      html += card(`
        <h2>Today so far</h2>
        <div class="mini-stats">
          <div><b>${roll.pottyOut}</b><span>outside</span></div>
          <div><b>${roll.accidents}</b><span>accidents</span></div>
          <div><b>${roll.meals}</b><span>meals</span></div>
          <div><b>${roll.bites}</b><span>nips</span></div>
        </div>
      `);
      return html;
    }

    if (lastCall) {
      html += card(`
        <h2 class="plain">Last call before bed</h2>
        <p class="stat-why">The most valuable trip of the day if nobody's getting up later. Take her out now, keep it boring, and lift the water bowl about an hour before lights out — but never if she's unwell or it's hot.</p>
        <button class="claim-btn" data-action="log-bedtime">Took her out — goodnight</button>
      `, 'lastcall-card');
    }

    if (!hasBaseline) {
      html += card(`
        <h2>Getting started</h2>
        <p class="stat-big">Ready when you are</p>
        <p class="stat-why">Next time ${esc(dog.name)} goes to the toilet outside, tap <strong>She went</strong> below. That starts the clock, and from then on Scout will tell you when she's due.</p>
      `, 'due-card');
    } else {
      html += card(`
        <h2>Next toilet break</h2>
        <p class="stat-big ${overdue ? 'is-over' : ''}">${due === null ? 'Set her age first' : esc(fmtRelative(due - now))}</p>
        <p class="stat-why">${esc(dog.name)} is ${esc(fmtAge(w))} — that's about every ${esc(fmtDuration(pottyIntervalMinutes(dog, now, st.settings.pottySlider)))} while she's awake.</p>
        ${claim && claim.by !== Store.deviceId()
          ? noteHtml(`<b>${esc(claim.byName)} is taking her out</b> — no need to go too.`, 'good')
          : claim
            ? `<button class="claim-btn" data-action="claim-cancel">Never mind — I'm not going</button>`
            : `<button class="claim-btn" data-action="claim">I'm taking her out now</button>`}
      `, overdue ? 'due-card is-over' : 'due-card');
    }

    /* The technique used to live in a toast that vanished after three seconds,
       which meant the most useful sentence in the app could never be read
       twice. Toasts confirm; cards teach. */
    html += card(`
      <h2 class="plain">Making it count</h2>
      <p class="stat-why">Go out <strong>with</strong> her, and the moment she finishes say <strong>"yes"</strong> and give her a treat — outside, on the spot, within about three seconds. Rewarding her back at the door teaches her that coming in is the good bit, which is the commonest reason toilet training stalls.</p>
    `, 'howto-card');

    /* 3. What do I tap. Two rows, biggest targets on the page. */
    html += `
      <h3 class="row-head">Log what just happened</h3>
      <div class="log-grid">
        <button class="log-btn primary" data-action="log-potty-went">
          <span class="lg-main">She went</span><span class="lg-sub">outside</span>
        </button>
        <button class="log-btn" data-action="log-potty-nothing">
          <span class="lg-main">Nothing</span><span class="lg-sub">no luck</span>
        </button>
        <button class="log-btn warn" data-action="log-accident">
          <span class="lg-main">Accident</span><span class="lg-sub">indoors</span>
        </button>
        <button class="log-btn" data-action="log-meal">
          <span class="lg-main">Fed her</span><span class="lg-sub">meal</span>
        </button>
        <button class="log-btn" data-action="log-sleep-start">
          <span class="lg-main">Asleep</span><span class="lg-sub">nap started</span>
        </button>
        <button class="log-btn" data-action="log-nip">
          <span class="lg-main">Nipped</span><span class="lg-sub">teeth on skin</span>
        </button>
      </div>`;

    /* Sleep is a leading indicator, not a side metric: bite-pressure control is
       the first thing to go when a puppy is short of sleep, so an overtired
       warning here prevents more biting than any technique card would. */
    if (Store.lastEventOf('sleepStart') && !Store.lastEventOf('sleepEnd')) {
      html += card(`
        <h2>She's asleep</h2>
        <p class="stat-why">Let her finish. Most families wake a puppy far more often than they realise.</p>
        <button class="claim-btn" data-action="log-sleep-end">She's awake now</button>
      `);
    } else if (tired) {
      html += noteHtml(`<b>Awake ${esc(mss)} minutes.</b> Most puppies this age manage ${esc(wakeWindowMinutes(w)[0])}–${esc(wakeWindowMinutes(w)[1])} before they need a nap. If she's getting wild or bitey, she's probably tired rather than naughty.`, 'warn');
    }

    if (empties >= 3) {
      html += noteHtml('<b>Three empty trips in an hour.</b> If she’s straining, going very often, or there’s blood, call your vet — that can be a urine infection, which no amount of training will fix.', 'warn');
    }

    if (fear) {
      html += card(`<h2 class="plain">${esc(fear.title)}</h2><p class="stat-why">${esc(fear.body)}</p>`);
    }

    if (soc.phase !== 'maintenance' && soc.daysLeftToCore > 0) {
      html += card(`
        <h2>Meeting the world</h2>
        <p class="stat-big">${esc(soc.daysLeftToCore)} days left</p>
        <p class="stat-why">Calm, gentle introductions to new sights and sounds matter most while she's young. Quality over quantity — one relaxed look at a bus beats ten frightening ones.</p>
      `, soc.phase === 'peak' ? 'urgent' : '');
    }

    const meal = nextMeal(now);
    if (meal) {
      const overdueMeal = meal.at <= now;
      html += card(`
        <h2>Next meal</h2>
        <p class="stat-big ${overdueMeal ? 'is-over' : ''}">${esc(overdueMeal ? 'Due now' : fmtRelative(meal.at - now))}</p>
        <p class="stat-why">Meal ${esc(meal.index)} of ${esc(meal.of)} today. ${esc(fmtAge(w))} and ${esc(SIZE_LABELS[sizeParams(dog).sizeClass]?.split(' — ')[0].toLowerCase() || 'small')} — little and often matters at this age, and long gaps between meals are the part that can actually make a young puppy unwell.</p>
      `, overdueMeal ? 'due-card is-over' : '');
    }

    /* Today's numbers. Counts only — no streak, no score, no red/green day.
       A streak here would teach the family to stop logging accidents. */
    html += card(`
      <h2>Today so far</h2>
      <div class="mini-stats">
        <div><b>${roll.pottyOut}</b><span>outside</span></div>
        <div><b>${roll.accidents}</b><span>accidents</span></div>
        <div><b>${roll.meals}</b><span>meals</span></div>
        <div><b>${roll.bites}</b><span>nips</span></div>
      </div>
      ${roll.accidents > 0 ? '<p class="stat-why">Accidents at this age are normal and not a setback. Clean it with an enzyme cleaner so she can’t smell it, and take her out a bit sooner next time.</p>' : ''}
    `);

    return html;
  }

  function mealTimestamps(now) {
    const dayAgo = now - 86400000;
    return Store.liveEvents().filter(e => e.type === 'meal' && e.ts > dayAgo).map(e => e.ts);
  }

  function nextMeal(now) {
    const dog = Store.state.dog;
    if (!dog?.dob) return null;
    return nextMealDue(now, mealTimestamps(now), Store.state.settings,
                       ageWeeks(dog.dob, now), sizeParams(dog).sizeClass);
  }

  /* Only two things are worth interrupting someone's day for: she needs out, or
     she needs feeding. Everything else the app knows can wait until they open
     it. A claim ("I'm taking her out now") removes the potty reminder entirely,
     because somebody is already dealing with it. */
  function pendingReminders(now) {
    const st = Store.state;
    const dog = st.dog;
    if (!dog?.dob) return [];
    const name = dog.name || 'Your puppy';
    const out = [];

    if (!Store.activeClaim(now)) {
      const due = nextDue(now);
      if (due && !isOvernight(new Date(due), st.settings.bedtime, st.settings.wakeTime)) {
        const last = Store.lastEventOf(['potty', 'accident']);
        out.push({
          kind: 'potty', at: due,
          title: `${name} is due out`,
          body: last ? `Last went ${fmtDuration(Math.round((due - last.ts) / 60000))} ago. Reward her outside the moment she goes.`
                     : 'Reward her outside the moment she goes.'
        });
      }
    }

    const meal = nextMeal(now);
    if (meal && !isOvernight(new Date(meal.at), st.settings.bedtime, st.settings.wakeTime)) {
      out.push({
        kind: 'meal', at: meal.at,
        title: `${name}'s meal ${meal.index} of ${meal.of}`,
        body: 'She’ll likely need the toilet within half an hour of eating.'
      });
    }
    return out;
  }

  function pushDue(now) {
    if (typeof Push === 'undefined' || !Push.enabled()) return;
    Push.syncReminders(pendingReminders(now));
  }

  function refreshReminders() {
    if (typeof Push === 'undefined' || !Push.enabled()) return;
    return Push.refresh(pendingReminders(Date.now()));
  }

  /* ---------- actions ---------- */

  function handle(action, value) {
    const now = Date.now();

    /* A nap nobody closed would otherwise sit open forever. */
    Store.autoCloseStaleNap(now);
    setTimeout(() => pushDue(Date.now()), 0);

    switch (action) {
      case 'claim':
        Store.addEvent('claim', {});
        toast('Told the others you’ve got her');
        return true;

      case 'claim-cancel':
        Store.addEvent('claimRelease', {});
        toast('Cancelled');
        return true;

      case 'undo-event':
        Store.tombstone(value);
        toast('Undone');
        App.render();
        return true;

      case 'log-potty-went': {
        const dup = Store.recentDuplicate('potty', now);
        if (dup) { toast(`${dup.byName} already logged this`); return true; }
        const napped = closeNapIfImplied('potty', now);
        const ev = Store.addEvent('potty', { result: 'went', place: 'outside' });
        Store.addEvent('claimRelease', {});
        toast(napped ? `Logged — and closed her ${napped} min nap` : 'Logged', ev.id);
        return true;
      }
      case 'log-potty-nothing': {
        const napped = closeNapIfImplied('potty', now);
        const ev = Store.addEvent('potty', { result: 'nothing' });
        Store.addEvent('claimRelease', {});
        toast(napped ? `Noted — try again in about 15 minutes` : 'Noted — try again in about 15 minutes', ev.id);
        return true;
      }

      case 'log-accident': {
        closeNapIfImplied('accident', now);
        const st = Store.state.settings;
        const overnight = isOvernight(new Date(now), st.bedtime, st.wakeTime);
        /* Tagged so the daytime trend isn't dragged down by something nobody
           was awake for. It still gets logged — hiding it would corrupt the
           picture — it just isn't counted as a daytime miss. */
        const ev = Store.addEvent('accident', { overnight });
        toast(overnight ? 'Logged — overnight ones don’t count against the day' : 'Logged, no blame', ev.id);
        return true;
      }

      case 'log-bedtime': {
        const ev = Store.addEvent('potty', { result: 'went', place: 'outside', lastCall: true });
        Store.addEvent('bedtime', {});
        toast('Goodnight — Scout will be quiet until morning', ev.id);
        return true;
      }

      case 'log-meal': {
        closeNapIfImplied('meal', now);
        const ev = Store.addEvent('meal', {});
        toast('Logged', ev.id);
        return true;
      }

      case 'log-sleep-start': {
        if (Store.openNap()) { toast('She’s already down for a nap'); return true; }
        const ev = Store.addEvent('sleepStart', {});
        toast('Sleeping. Let her finish.', ev.id);
        return true;
      }

      case 'log-sleep-end': {
        const start = Store.openNap();
        const mins = start ? Math.max(1, Math.round((now - start.ts) / 60000)) : 0;
        Store.addEvent('sleepEnd', {});
        if (mins) Store.addEvent('sleep', { minutes: mins });
        toast(`Slept ${mins} min — take her straight out`);
        return true;
      }

      case 'log-nip':
        App.openSheet(nipSheet());
        return true;

      case 'nip-severity': {
        const napped = closeNapIfImplied('bite', now);
        const mss = napped ? 0 : minsSinceSleep(now);
        /* Severity is the metric that should fall; frequency often doesn't
           until after teething. Everything else here is derived, so the whole
           interaction is two taps. */
        const ev = Store.addEvent('bite', {
          severity: Number(value),
          minsSinceSleep: mss,
          hoursSlept24: hoursSlept(now)
        });
        App.closeSheet();
        toast(mss !== null && isOvertired(mss, ageWeeks(Store.state.dog.dob, now))
          ? 'Logged — she’s been awake a while, try a nap first'
          : 'Logged', ev.id);
        return true;
      }
    }
    return false;
  }

  function hoursSlept(now) {
    const dayAgo = now - 86400000;
    const mins = Store.liveEvents()
      .filter(e => e.type === 'sleep' && e.ts > dayAgo)
      .reduce((a, e) => a + (e.payload.minutes || 0), 0);
    return Math.round(mins / 6) / 10;
  }

  function nipSheet() {
    return `
      <h2>How hard was it?</h2>
      <p class="sheet-lede">Pressure is what changes first. How often she mouths often doesn't drop until teething is over — how <em>hard</em> she does it should.</p>
      <div class="sev-list">
        ${BITE_SEVERITY.map(s => `
          <button class="sev" data-action="nip-severity" data-value="${s.level}">
            <span class="sev-n">${s.level}</span>
            <span class="sev-t"><b>${esc(s.label)}</b><span>${esc(s.hint)}</span></span>
          </button>`).join('')}
      </div>`;
  }

  return { render, handle, nextDue, refreshReminders };
})();
