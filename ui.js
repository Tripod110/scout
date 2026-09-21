/* Scout — shared UI builders.
 *
 * THE ESCAPING RULE: a field whose name ends in `Html` is markup the caller
 * built and is responsible for. Every other field is plain text and is escaped
 * here. "Everything is escaped unless the name says otherwise" is greppable;
 * "escaped unless we're sure it's safe" is what rots.
 *
 * THE LOAD-ORDER RULE: functions here may reference anything at call time,
 * because by then every script has loaded. Nothing here may evaluate another
 * file's symbols at module scope. Const tables and function declarations only.
 *
 * LOAD ORDER: after store.js, before the screens.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Inline paths that take the current text colour — no icon font, no network,
   and every type scale gets them at the right size for free. */
const ICONS = {
  check:    '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  chevron:  '<path d="M9.5 6l6 6-6 6"/>',
  back:     '<path d="M14.5 6l-6 6 6 6"/>',
  clock:    '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  home:     '<path d="M4 11l8-6.5 8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',
  paw:      '<ellipse cx="7" cy="9" rx="1.9" ry="2.6"/><ellipse cx="12" cy="7.4" rx="1.9" ry="2.7"/><ellipse cx="17" cy="9" rx="1.9" ry="2.6"/><path d="M12 12.2c3 0 5 2 5 4.2 0 1.7-1.4 2.8-3.1 2.4-.9-.2-1.4-.4-1.9-.4s-1 .2-1.9.4C8.4 19.2 7 18.1 7 16.4c0-2.2 2-4.2 5-4.2z"/>',
  moon:     '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  book:     '<path d="M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5z"/><path d="M5 4.5v12.5"/>',
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  warn:     '<path d="M12 4.5L21 19.5H3z"/><path d="M12 10v4M12 16.8v.2"/>',
  x:        '<path d="M6 6l12 12M18 6L6 18"/>'
};
function icon(name, size) {
  const s = size || 22;
  return `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

/* ---------- primitives ---------- */

function card(innerHtml, cls) {
  return `<section class="card ${cls || ''}">${innerHtml}</section>`;
}

function bigButton(opts) {
  const { action, label, sub, tone, value, disabled } = opts;
  return `<button class="big-btn ${tone ? 'tone-' + tone : ''}" data-action="${esc(action)}"${value != null ? ` data-value="${esc(value)}"` : ''}${disabled ? ' disabled' : ''}>
    <span class="bb-label">${esc(label)}</span>
    ${sub ? `<span class="bb-sub">${esc(sub)}</span>` : ''}
  </button>`;
}

function choiceList(action, options, selected) {
  return `<div class="choices" role="radiogroup">` + options.map(o => `
    <button class="choice${selected === o.value ? ' is-on' : ''}" role="radio" aria-checked="${selected === o.value}"
            data-action="${esc(action)}" data-value="${esc(o.value)}">
      <span class="ch-label">${esc(o.label)}</span>
      ${o.sub ? `<span class="ch-sub">${esc(o.sub)}</span>` : ''}
    </button>`).join('') + `</div>`;
}

function field(opts) {
  const { id, label, type, value, placeholder, hint, inputmode, max, min } = opts;
  return `<div class="field">
    <label for="${esc(id)}">${esc(label)}</label>
    <input id="${esc(id)}" type="${esc(type || 'text')}" value="${esc(value || '')}"
      ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}
      ${inputmode ? `inputmode="${esc(inputmode)}"` : ''}
      ${max != null ? `max="${esc(max)}"` : ''} ${min != null ? `min="${esc(min)}"` : ''}>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
  </div>`;
}

function note(text, tone) {
  return `<div class="note ${tone ? 'note-' + tone : ''}">${esc(text)}</div>`;
}
function noteHtml(html, tone) {
  return `<div class="note ${tone ? 'note-' + tone : ''}">${html}</div>`;
}

/* ---------- toast + live region ---------- */

let toastTimer = null;

/* A toast confirms; it must never be the only place something is taught. The
   technique copy that used to live here now sits on the cards, because advice
   on a 3-second timer cannot be read twice.

   `undoId` turns the toast into the undo affordance — the standard pattern, and
   the cheapest possible fix for a six-button grid where a wet-handed mis-tap
   would otherwise be permanent. */
function toast(msg, undoId) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.innerHTML = `<div class="toast">
      <span>${esc(msg)}</span>
      ${undoId ? `<button class="toast-undo" data-action="undo-event" data-value="${esc(undoId)}">Undo</button>` : ''}
    </div>`;
  if (toastTimer) clearTimeout(toastTimer);
  /* Longer when there's something to undo: 3.2s is not enough time to notice a
     mistake, register it, and reach the button one-handed. */
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, undoId ? 7000 : 3200);
  announce(msg);
}

/* Changes that happen without navigation still need to reach a screen reader. */
function announce(msg) {
  const el = document.getElementById('sr-live');
  if (el) { el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 40); }
}

/* ---------- platform ----------
   iOS keeps a home-screen web app in a DIFFERENT storage container from Safari.
   Nothing written in the browser is visible to the installed app, so following
   "Add to Home Screen" after setting up means setting up again from nothing —
   and Add to Home Screen is exactly what iOS Web Push will require.

   Until sync lands, the only defence is to get people to install FIRST, and to
   give them an export if they didn't. */

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}
function shouldWarnAboutInstall() { return isIOS() && !isStandalone(); }

/* ---------- formatting ---------- */

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* Plain English, because "in 68 minutes" is arithmetic the reader shouldn't have
   to do while holding a puppy. */
function fmtRelative(ms) {
  const mins = Math.round(ms / 60000);
  if (mins <= -60) return `${Math.round(-mins / 60)} hr overdue`;
  if (mins < 0) return `${-mins} min overdue`;
  if (mins === 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `in ${h} hr ${m} min` : `in ${h} hr`;
}

function fmtDuration(mins) {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function fmtAge(weeks) {
  if (weeks == null) return 'age unknown';
  if (weeks < 16) return `${Math.floor(weeks)} weeks old`;
  const mo = weeks / 4.345;
  return mo < 24 ? `${Math.floor(mo)} months old` : `${(mo / 12).toFixed(1)} years old`;
}

/* ---------- type scale ----------
   Peak and Bloom hardcode a 16px base with labels down at 11px. For an app whose
   primary users are two non-technical older adults that is the wrong
   inheritance, so this is the one convention Scout deliberately breaks: rem
   throughout, driven by one token, nothing below 14px at any setting. */

const SCALES = { normal: 1, large: 1.15, largest: 1.32 };
function applyScale(scale) {
  const f = SCALES[scale] || 1;
  document.documentElement.style.setProperty('--scale', String(f));
}
