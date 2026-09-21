/* Scout reminder worker — Cloudflare Workers.
 *
 * Exists for one reason: a puppy's next toilet break is not at a fixed time, so
 * a reminder has to be computed. Peak's worker fires at a time each subscriber
 * configured once; Scout's has to fire when the dog is actually due, which
 * moves every time somebody logs anything.
 *
 * THE KEY DESIGN CHOICE: this worker never talks to Firestore. The app already
 * knows when the next break is due — it computed it — so on every relevant
 * write it POSTs that one timestamp here, and the worker stores it in KV. The
 * worker stays dumb, holds no Google credentials, and cannot read anyone's
 * data. All it knows is "household X is due at T, and here are its push
 * subscriptions."
 *
 * QUIET HOURS ARE ENFORCED HERE, NOT ONLY IN THE APP. A phone that is asleep
 * still receives pushes, and iOS will display them. The bedtime window travels
 * with the subscription so nobody is woken at 3am by a server that didn't know
 * they'd gone to bed.
 *
 * Deploy:  cd worker && npx wrangler deploy
 */

import { sendWebPush } from './webpush.js';

const MAX_BODY = 8_000;

function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
  };
}
function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json' }, cors(env))
  });
}

/* Local clock-hour for a subscriber, from the UTC-minutes offset their browser
   reported. Cheaper and more reliable than shipping a timezone database. */
function localHour(offsetMinutes, at) {
  const d = new Date((at || Date.now()) - (offsetMinutes || 0) * 60000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function inQuietHours(sub, at) {
  const b = sub.bedtime == null ? 22 : sub.bedtime;
  const w = sub.wakeTime == null ? 7 : sub.wakeTime;
  const h = localHour(sub.tzOffset, at);
  return b > w ? (h >= b || h < w) : (h >= b && h < w);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    /* The public half of the VAPID pair. Public by definition — it ships to
       every subscribing browser as the applicationServerKey — so serving it
       saves duplicating it into the client and getting them out of step. */
    if (request.method === 'GET' && url.pathname === '/key') {
      return json({ key: env.VAPID_PUBLIC_KEY }, 200, env);
    }

    if (request.method !== 'POST') return json({ error: 'Not found' }, 404, env);

    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: 'Too large' }, 413, env);
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Bad JSON' }, 400, env);
    }

    if (url.pathname === '/subscribe')   return subscribe(body, env);
    if (url.pathname === '/unsubscribe') return unsubscribe(body, env);
    if (url.pathname === '/due')         return setDue(body, env);
    return json({ error: 'Not found' }, 404, env);
  },

  /* Every five minutes. Cheap: one KV list, and a push only for households
     whose due time has just passed. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  }
};

/* ---------- endpoints ---------- */

async function subscribe(body, env) {
  const { householdId, subscription, tzOffset, bedtime, wakeTime, dogName } = body || {};
  if (!householdId || !subscription?.endpoint) return json({ error: 'Missing fields' }, 400, env);

  const id = await hash(subscription.endpoint);
  await env.SCOUT_KV.put(`sub:${householdId}:${id}`, JSON.stringify({
    subscription, tzOffset: tzOffset || 0,
    bedtime: bedtime == null ? 22 : bedtime,
    wakeTime: wakeTime == null ? 7 : wakeTime,
    dogName: String(dogName || 'your puppy').slice(0, 40),
    createdAt: Date.now()
  }));
  return json({ ok: true }, 200, env);
}

async function unsubscribe(body, env) {
  const { householdId, subscription } = body || {};
  if (!householdId || !subscription?.endpoint) return json({ error: 'Missing fields' }, 400, env);
  const id = await hash(subscription.endpoint);
  await env.SCOUT_KV.delete(`sub:${householdId}:${id}`);
  return json({ ok: true }, 200, env);
}

/* The app POSTs the whole pending list whenever anything moves — a log, a meal,
   a claim, an edit. Each POST REPLACES the previous list, which is what makes
   this self-cancelling: if Dad takes her out, the next POST simply doesn't
   contain a potty reminder for the old time, so it never fires.

   `fired` records which exact times have already been notified, so a reminder
   goes once and not every five minutes until someone acts. */
async function setDue(body, env) {
  const { householdId, reminders } = body || {};
  if (!householdId || !Array.isArray(reminders)) return json({ error: 'Missing fields' }, 400, env);

  const clean = reminders
    .filter(r => r && Number(r.at) > 0 && typeof r.kind === 'string')
    .slice(0, 8)
    .map(r => ({
      kind: String(r.kind).slice(0, 16),
      at: Number(r.at),
      title: String(r.title || '').slice(0, 80),
      body: String(r.body || '').slice(0, 160)
    }));

  const prevRaw = await env.SCOUT_KV.get(`due:${householdId}`);
  let fired = {};
  try { fired = JSON.parse(prevRaw || '{}').fired || {}; } catch { /* start clean */ }

  /* Forget anything older than a day so `fired` can't grow without bound. */
  const cutoff = Date.now() - 86400000;
  for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];

  await env.SCOUT_KV.put(`due:${householdId}`, JSON.stringify({ reminders: clean, fired, setAt: Date.now() }));
  return json({ ok: true, accepted: clean.length }, 200, env);
}

/* ---------- the cron ---------- */

async function runReminders(env) {
  const now = Date.now();
  const list = await env.SCOUT_KV.list({ prefix: 'due:' });

  for (const key of list.keys) {
    const householdId = key.name.slice(4);
    const raw = await env.SCOUT_KV.get(key.name);
    if (!raw) continue;

    let rec;
    try { rec = JSON.parse(raw); } catch { continue; }
    const reminders = rec.reminders || [];
    const fired = rec.fired || {};

    /* Only things that are actually due, haven't been sent, and haven't gone
       stale. Half an hour late on "she needs the toilet" is not a reminder, it
       is an accusation — by then it has either happened or it hasn't. */
    const ripe = reminders.filter(r => {
      const tag = r.kind + ':' + r.at;
      return r.at <= now && !fired[tag] && (now - r.at) <= 30 * 60000;
    });
    if (!ripe.length) continue;

    /* At most one push per run. Two notifications arriving together for the
       same dog is how people turn notifications off. */
    const pick = ripe.sort((a, b) => a.at - b.at)[0];

    const subs = await env.SCOUT_KV.list({ prefix: `sub:${householdId}:` });
    let sentAny = false;

    for (const sk of subs.keys) {
      const sraw = await env.SCOUT_KV.get(sk.name);
      if (!sraw) continue;
      let sub;
      try { sub = JSON.parse(sraw); } catch { continue; }

      /* A sleeping phone still displays notifications, so quiet hours have to
         be enforced here and not only in the app. */
      if (inQuietHours(sub, now)) continue;

      const ok = await push(env, sub, {
        title: pick.title || `${sub.dogName} needs you`,
        body: pick.body || '',
        tag: `scout-${pick.kind}-${householdId}`
      });
      if (ok) sentAny = true;
      else await env.SCOUT_KV.delete(sk.name);   // gone or expired subscription
    }

    if (sentAny) {
      fired[pick.kind + ':' + pick.at] = now;
      rec.fired = fired;
      await env.SCOUT_KV.put(key.name, JSON.stringify(rec));
    }
  }
}

async function push(env, sub, payload) {
  try {
    /* 1800s: if her phone has been off for half an hour the moment has passed,
       and a reminder arriving late is worse than one that never arrives. */
    const res = await sendWebPush(sub.subscription, payload, env, 1800);
    /* 404/410 mean the subscription is dead and should be dropped. */
    return !(res.status === 404 || res.status === 410);
  } catch (e) {
    console.log('push failed', e.message);
    return true;         // transient — keep the subscription
  }
}

async function hash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
