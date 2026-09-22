/* Scout — router, event dispatch, boot.
 *
 * Loads last, so everything it calls already exists. The service-worker
 * registration lives here rather than inline in index.html because the CSP sets
 * `script-src 'self'` with no 'unsafe-inline' — which is what makes an injected
 * script unable to execute, and is worth the small inconvenience.
 *
 * ONE DELEGATED LISTENER handles every tap. Screens return HTML strings and
 * declare behaviour with data-action, so no screen wires its own handlers and
 * nothing leaks when a view is replaced.
 */

const App = (() => {
  let tab = 'today';
  let sheetHtml = null;

  /* ---------- render ---------- */

  function render() {
    const st = Store.state;
    const view = document.getElementById('view');
    if (!view) return;

    /* Editing reuses the onboarding screens, so it takes over the viewport the
       same way — one question, no tab bar, an explicit Cancel. */
    const inFlow = !st.onboarded || Onboard.editing;

    if (inFlow) {
      document.body.classList.add('onboarding');
      view.innerHTML = Onboard.render();
      renderChrome(false);
      renderSheet();
      return;
    }

    document.body.classList.remove('onboarding');
    renderChrome(true);

    view.innerHTML = tab === 'today' ? Today.render()
                   : tab === 'settings' ? settingsView()
                   : '<p class="ob-lede">Not built yet.</p>';
    renderSheet();
  }

  function renderSheet() {
    const sheet = document.getElementById('sheet-root');
    if (!sheet) return;
    sheet.innerHTML = sheetHtml
      ? `<div class="sheet-scrim" data-action="close-sheet"></div>
         <div class="sheet" role="dialog" aria-modal="true">
           <button class="sheet-x" data-action="close-sheet" aria-label="Close">${icon('x', 22)}</button>
           ${sheetHtml}
         </div>`
      : '';
  }

  function renderChrome(show) {
    const bar = document.getElementById('tabbar');
    const top = document.getElementById('topbar');
    if (bar) bar.hidden = !show;
    if (top) top.hidden = !show;
    if (!show) return;

    const dog = Store.state.dog;
    const title = document.getElementById('header-title');
    if (title) title.textContent = dog?.name || 'Scout';

    const sub = document.getElementById('header-sub');
    if (sub && dog?.dob) sub.textContent = fmtAge(ageWeeks(dog.dob, Date.now()));

    for (const b of bar.querySelectorAll('.tab')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  function goTab(t) { tab = t; sheetHtml = null; render(); window.scrollTo({ top: 0 }); }
  function openSheet(html) { sheetHtml = html; render(); }
  function closeSheet() { sheetHtml = null; render(); }

  /* ---------- settings ---------- */

  function settingsView() {
    const st = Store.state;
    const dog = st.dog || {};
    const p = sizeParams(dog);
    const w = ageWeeks(dog.dob, Date.now());

    return `
      ${card(`
        <h2>Text size</h2>
        ${choiceList('set-scale', [
          { value: 'normal',  label: 'Normal' },
          { value: 'large',   label: 'Large' },
          { value: 'largest', label: 'Largest' }
        ], st.settings.scale)}
      `)}

      ${card(`
        <h2>${esc(dog.name || 'Your puppy')}</h2>
        <p class="stat-why">Tap anything to change it.</p>
        <div class="edit-rows">
          ${editRow('name', 'Name', dog.name || '—')}
          ${editRow('dob', 'Age', fmtAge(w) + (dog.dobEstimated ? ' (estimated)' : ''))}
          ${editRow('sizeClass', 'Grown-up size', (SIZE_LABELS[p.sizeClass] || 'Not set').split(' — ')[0] + (p.confident ? '' : ' — assumed'))}
          ${editRow('confinementType', 'Sleeps in', CONFINEMENT_TYPES[dog.confinementType]?.label || 'Not set')}
          ${editRow('breedGroup', 'Breed group', dog.breedGroup ? FUNCTIONAL_GROUPS[dog.breedGroup]?.label : 'Not set')}
          ${editRow('traits', 'What she’s like', (dog.traits || []).length + ' ticked')}
        </div>
      `)}

      ${card(`
        <h2>Toilet break timing</h2>
        <p class="stat-why">Scout suggests every ${esc(fmtDuration(pottyIntervalMinutes(dog, Date.now(), st.settings.pottySlider)))}. If that feels too often, ease it off — an app you ignore helps nobody.</p>
        ${choiceList('set-slider', [
          { value: '0.85', label: 'Tighter',  sub: 'Fewer accidents, more trips' },
          { value: '1',    label: 'As advised' },
          { value: '1.2',  label: 'Easier',   sub: 'Fewer trips, expect more accidents' }
        ], String(st.settings.pottySlider))}
      `)}

      ${sharingCard()}

      ${remindersCard()}

      ${card(`
        <h2>Bedtime</h2>
        <p class="stat-why">Scout goes quiet overnight — no reminders, and overnight accidents are kept out of the daytime figures. You'll get a last-call prompt ${esc(LAST_CALL_MINUTES)} minutes before.</p>
        ${choiceList('set-bedtime', [
          { value: '21', label: '9pm' }, { value: '22', label: '10pm' },
          { value: '23', label: '11pm' }, { value: '0', label: 'Midnight' }
        ], String(st.settings.bedtime))}
        <p class="stat-why" style="margin-top:.8rem">Up at</p>
        ${choiceList('set-waketime', [
          { value: '6', label: '6am' }, { value: '7', label: '7am' }, { value: '8', label: '8am' }
        ], String(st.settings.wakeTime))}
      `)}

      ${card(`
        <h2>Backup</h2>
        <p class="stat-why">${Sync.connected
          ? 'Your logs are also on the other phones in your household, so this is belt and braces — but a file you can email yourself costs nothing.'
          : 'Everything is stored on this phone only. Clearing your browser data, losing the phone, or adding Scout to your Home Screen will all lose it — so save a copy now and then.'}</p>
        <button class="claim-btn" data-action="export">Save a backup file</button>
        <button class="claim-btn" data-action="import" style="margin-top:.5rem">Restore from a backup</button>
      `)}

      ${shouldWarnAboutInstall() ? noteHtml('<b>You’re using Scout in Safari.</b> If you add it to your Home Screen now, it will open empty — iPhone keeps them separate. Save a backup first, then restore it in the Home Screen version.', 'warn') : ''}

      ${card(`
        <h2>Start over</h2>
        <p class="stat-why">Clears everything on this device and returns to setup.</p>
        <button class="claim-btn danger" data-action="reset">Delete and start again</button>
      `)}

      <p class="ob-foot">Scout is not a veterinary service and does not diagnose. Anything that worries you about your puppy's health is a question for your vet.</p>`;
  }

  /* Sharing. The code is a door the owner opens for an hour, not a permanent
     key left under the mat — a six-character code you can read across a kitchen
     is only safe because it expires. */
  function sharingCard() {
    /* No project at all — nothing to offer. */
    if (!firebaseProjectPresent()) {
      return card(`
        <h2>Sharing</h2>
        <p class="stat-why">Not set up on this copy of Scout. Everything stays on this phone.</p>
      `);
    }

    /* Project exists, but this phone hasn't been given the key. Deliberately
       not in the repo, so each phone is told it once. */
    if (!firebaseConfigured()) {
      return card(`
        <h2>Sharing</h2>
        <p class="stat-why">To share with the rest of the household, this phone needs the family key — a short code beginning <code>AIza</code>. Ask whoever set Scout up; they have it written down.</p>
        <button class="claim-btn" data-action="enter-key">Enter the family key</button>
      `);
    }
    const s = Sync.getStatus();
    const members = Store.state.household?.members || [];
    const connected = Sync.connected;

    return card(`
      <h2>Sharing</h2>
      <p class="stat-why">
        ${s.status === 'live' && connected ? 'On — everyone with the app sees the same puppy.'
        : s.status === 'live' ? 'Ready. Invite the rest of the household and you’ll all see the same puppy.'
        : s.status === 'connecting' ? 'Connecting…'
        : s.status === 'error' ? esc(s.detail)
        : 'Working offline — changes will sync when you’re back online.'}
      </p>
      ${members.length ? `<ul class="members">${members.map(m =>
        `<li>${esc(m.name)}${m.deviceId === Store.deviceId() ? ' <span class="you">this phone</span>' : ''}</li>`).join('')}</ul>` : ''}
      <button class="claim-btn" data-action="open-invite">Invite someone</button>
      ${connected ? `<button class="claim-btn" data-action="leave-household" style="margin-top:.5rem">Stop sharing on this phone</button>` : ''}
      <button class="claim-btn" data-action="forget-key" style="margin-top:.5rem">Remove the key from this phone</button>
    `);
  }

  /* Reminders only appear once the Worker exists. No switch that does nothing. */
  function remindersCard() {
    if (!pushConfigured()) return '';
    const why = Push.unavailableReason();
    const on = Push.enabled();
    return card(`
      <h2>Reminders</h2>
      <p class="stat-why">${on
        ? 'On — Scout will nudge you when she’s due out. Nothing between your bedtime and morning.'
        : 'A nudge on your phone when she’s due out, and nothing overnight.'}</p>
      ${why ? noteHtml(esc(why), 'warn')
            : `<button class="claim-btn" data-action="${on ? 'push-off' : 'push-on'}">${on ? 'Turn reminders off' : 'Turn reminders on'}</button>`}
    `);
  }

  function editRow(field, label, value) {
    return `<button class="edit-row" data-action="edit-dog" data-value="${esc(field)}">
      <span class="er-label">${esc(label)}</span>
      <span class="er-value">${esc(value)}</span>
      ${icon('chevron', 18)}
    </button>`;
  }

  /* ---------- backup ----------
     Until sync exists this is the only thing standing between a household and
     total loss, so it is a plain file the user can email to themselves. */

  function doExport() {
    try {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = (Store.state.dog?.name || 'scout').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `scout-${name}-${Store.dayKey(Date.now())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Backup saved');
    } catch {
      toast('Couldn’t save the backup on this device');
    }
  }

  function doImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = Store.importJSON(String(reader.result));
        if (res.ok) { applyScale(Store.state.settings.scale); goTab('today'); toast(`Restored ${res.dog || 'your puppy'}`); }
        else toast(res.error);
      };
      reader.onerror = () => toast('Couldn’t read that file');
      reader.readAsText(file);
    });
    input.click();
  }

  /* ---------- dispatch ---------- */

  function onTap(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const value = el.dataset.value;
    const view = document.getElementById('view');

    /* global, available from any screen */
    switch (action) {
      case 'close-sheet': closeSheet(); return;
      case 'tab':         goTab(el.dataset.tab); return;
      case 'set-scale':   Store.setSettings({ scale: value }); applyScale(value); render(); return;
      case 'set-slider':
        Store.setSettings({ pottySlider: Number(value) });
        Today.refreshReminders();
        render();
        return;
      case 'edit-dog':    Onboard.edit(value); return;
      case 'export':      doExport(); return;
      case 'import':      doImport(); return;
      case 'undo-event':  Store.tombstone(value); toast('Undone'); render(); return;
      case 'push-on':
        Push.enable().then(r => {
          if (r.ok) Today.refreshReminders();
          toast(r.ok ? 'Reminders on' : r.error);
          render();
        });
        return;
      case 'push-off':
        Push.disable().then(() => { toast('Reminders off'); render(); });
        return;

      case 'set-bedtime':
        Store.setSettings({ bedtime: Number(value) });
        Today.refreshReminders();
        render();
        return;
      case 'set-waketime':
        Store.setSettings({ wakeTime: Number(value) });
        Today.refreshReminders();
        render();
        return;

      case 'enter-key':
        openSheet(`
          <h2>The family key</h2>
          <p class="sheet-lede">One long code beginning <strong>AIza</strong>. It's kept off the internet on purpose, so each phone has to be told it once. It stays on this phone only.</p>
          ${field({ id: 'api-key', label: 'Family key', placeholder: 'AIza…' })}
          <button class="claim-btn" data-action="save-key">Save</button>
        `);
        return;

      case 'save-key': {
        const input = document.getElementById('api-key');
        const k = (input?.value || '').trim();
        if (!looksLikeApiKey(k)) { toast('That doesn’t look right — it should start AIza and be 39 characters'); return; }
        setFirebaseApiKey(k);
        closeSheet();
        toast('Connecting…');
        Sync.init().then(ok => { toast(ok ? 'Connected' : Sync.getStatus().detail || 'Couldn’t connect'); render(); });
        return;
      }

      case 'forget-key':
        if (confirm('Remove the key from this phone? Sharing stops here until you enter it again. Your logs stay.')) {
          Sync.disconnect();
          setFirebaseApiKey('');
          toast('Key removed from this phone');
          render();
        }
        return;

      case 'open-invite': {
        toast('Getting a code…');
        (async () => {
          try {
            if (!Sync.connected) await Sync.createRemote();
            const code = await Sync.openInvite();
            openSheet(`
              <h2>Invite someone</h2>
              <p class="sheet-lede">On their phone: open Scout, tap <strong>Join my family</strong>, and type this in.</p>
              <p class="invite-code">${esc(code)}</p>
              <p class="sheet-lede">It works for the next hour, then stops. You can always make a new one.</p>
            `);
          } catch (e) {
            toast('Couldn’t create an invite — ' + (e.message || 'try again'));
          }
        })();
        return;
      }

      case 'leave-household':
        if (confirm('Stop sharing on this phone? Your logs stay here, but you won’t see the others’ any more.')) {
          Sync.leave().then(() => { toast('Sharing stopped'); render(); });
        }
        return;
      case 'reset':
        if (confirm('Delete everything on this device and start again?')) { Store.resetAll(); location.reload(); }
        return;
    }

    /* Onboard.handle is async (the join flow awaits a sign-in), so its return
       value is a Promise and testing it for truthiness would be meaningless.
       Nothing else claims actions while a flow is on screen, so just hand off. */
    if (!Store.state.onboarded || Onboard.editing) {
      Onboard.handle(action, value, view).catch(e => {
        console.error(e);
        toast('Something went wrong — try again');
      });
      return;
    }
    if (Today.handle(action, value)) { render(); return; }
  }

  /* ---------- boot ---------- */

  function boot() {
    Store.load();
    applyScale(Store.state.settings.scale);
    Store.autoCloseStaleNap(Date.now());

    /* Sync is additive: the app is fully usable before it connects, and stays
       usable if it never does. Nothing below waits on it. */
    Sync.onStatus(() => { if (Store.state.onboarded) render(); });
    Store.subscribe(() => { if (Store.state.onboarded && !Onboard.editing) render(); });
    Sync.init().catch(e => console.warn('sync', e));

    document.addEventListener('click', onTap);

    /* Enter should submit a single-field step — otherwise the keyboard's Go key
       does nothing and people think the app is stuck. */
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      if (!ev.target.closest('input')) return;
      const btn = document.querySelector('.ob .big-btn:not(.tone-quiet)');
      if (btn) { ev.preventDefault(); btn.click(); }
    });

    render();

    /* Re-render the countdown on a slow tick. A minute is plenty for an
       "in 42 min" line and costs nothing; faster is just battery. */
    setInterval(() => {
      if (Store.state.onboarded && !Onboard.editing && tab === 'today' && !sheetHtml) {
        Store.autoCloseStaleNap(Date.now());
        render();
      }
    }, 60000);

    /* Coming back to a backgrounded PWA should show current state. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { Store.autoCloseStaleNap(Date.now()); render(); }
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('sw', err));
      });
    }
  }

  return { boot, render, goTab, openSheet, closeSheet };
})();

App.boot();
