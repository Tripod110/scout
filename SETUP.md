# Setting up sync and reminders

Both are optional. Scout works without either — it just stays on one phone and
stays quiet. Each needs an account I can't create for you, so these are the bits
that need your hands.

Do **sync first**. It's the one that matters, because without it iOS deletes
everyone's data the moment they add Scout to their Home Screen.

---

## 1. Firebase sync — about 10 minutes

### In the Firebase console

1. **console.firebase.google.com** → *Add project*. Call it `scout`. Google
   Analytics: off — it's a family dog app.
2. **Build → Authentication → Get started → Anonymous → Enable.**
   This is the only sign-in method Scout uses. Nobody makes an account; each
   device gets an opaque id and the invite code is what joins them up.
3. **Build → Firestore Database → Create database.**
   Start in **production mode** (locked). Pick the region closest to you —
   `nam5` for the US. This cannot be changed later.
4. **Project settings (gear) → General → Your apps → Web (`</>`).**
   Nickname `scout`, no Hosting. Copy the `firebaseConfig` object it shows you.

### In the code

5. Paste those six values into [`config.js`](config.js).

   These are **not secrets**. A Firebase web config ships to every browser that
   loads the app; Google's own docs say so. It identifies the project, it
   authorises nothing. Committing it to a public repo is correct. The thing that
   would be a real leak is a service-account key, and one of those never goes
   near a browser.

6. Publish the rules. Either paste [`firestore.rules`](firestore.rules) into
   **Firestore → Rules → Publish**, or:

   ```
   npx firebase-tools deploy --only firestore:rules --project scout
   ```

   **Do not skip this.** Step 3 left the database locked, which is safe but
   non-functional; the rules in this repo are the entire security model. Until
   they're published the app will report *"Permission denied"* and sync nothing.

7. Bump and deploy:

   ```
   node tools/release.mjs bump
   git add -A && git commit -m "Enable sync" && git push
   ```

### Checking the rules yourself

They're already verified — 23 assertions covering the cases that matter, run
against the Firestore emulator:

```
npm i firebase-tools @firebase/rules-unit-testing
npx firebase-tools emulators:exec --only firestore --project scout-rules-test "node tests/rules.test.mjs"
```

It proves a stranger can't read your household, an expired code can't join, a
joiner can't add anyone but themselves, events can't be rewritten or deleted,
and a member can't seize ownership.

### Check it worked

Open Scout, finish setup, then **Settings → Sharing** should say *Ready*. Tap
**Invite someone**, and on a second device tap **Join my family** and type the
code. Both should then show the same dog and the same logs.

### What it costs

Nothing, for a household. The free tier is 50K reads/day and 20K writes/day.
Scout uses two listeners and derives everything else locally, which works out
around 150 reads per household per day — roughly 300 households before the free
tier runs out. The read budget is a design constraint, not an accident; see the
note at the top of [`sync.js`](sync.js) before adding a third listener.

---

## 2. Push reminders — about 15 minutes

Needs the Cloudflare account you already have (`peak-scan` is deployed on it).

```
cd worker
npx wrangler login                      # opens a browser
node scripts/generate-vapid-keys.mjs    # prints a public key and a private JWK
```

1. Paste the **public** key into `wrangler.toml` as `VAPID_PUBLIC_KEY`, and put
   a real contact address in `VAPID_SUBJECT` — a push service uses it to reach
   you if your notifications start misbehaving.

2. Create the store and save the private half:

   ```
   npx wrangler kv namespace create SCOUT_KV     # paste the id into wrangler.toml
   npx wrangler secret put VAPID_PRIVATE_KEY     # paste the JWK line
   npx wrangler deploy
   ```

3. Put the deployed URL into `WORKER_URL` in [`config.js`](config.js), bump,
   commit, push.

Until `WORKER_URL` is set, Scout shows no reminders switch at all. That's
deliberate — a control that silently does nothing is worse than no control.

### The iOS rules, which are not negotiable

- Reminders only work for Scout **added to the Home Screen**. In a Safari tab
  the API is simply absent, and the app will say so rather than offering a
  switch that can't work.
- Permission has to come from a tap. Scout asks when you turn reminders on,
  never on load.
- No silent pushes — every message shows a notification, or iOS revokes the
  subscription.

### Overnight

The bedtime window is enforced **twice**: the app won't ask the Worker to remind
you, and the Worker checks again before sending. A sleeping phone still displays
notifications, so one check isn't enough. Change it in **Settings → Bedtime**;
it travels with the subscription.

---

## If something's wrong

| What you see | What it means |
| --- | --- |
| *"Permission denied"* in Sharing | Rules not published — step 6 |
| *"Anonymous sign-in isn't switched on"* | Step 2 |
| *"Firebase project not found"* | A typo in `config.js`, usually `projectId` |
| Sharing card says *"Not set up"* | `config.js` still has `PASTE_ME` |
| No reminders switch | `WORKER_URL` is empty, or you're in Safari rather than the Home Screen app |
| Codes rejected as expired | They last an hour by design. Make a new one. |
