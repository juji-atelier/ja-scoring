# JA Scoring System – setup guide

Live scoring for HQ Games 2026 at Kompleks Sukan Tun Adnan (14 & 15 Nov).
Free to run: GitHub Pages hosts the pages, Firebase (your **JA Scoring System** project) holds the scores.

## What's inside

| Page | Link | Who uses it |
|---|---|---|
| Scorer | `/scorer/?sport=badminton` (one link per sport) | AJK of each sport, on phone/laptop |
| Admin | `/admin/` | You – overview, big-screen control, QR, links |
| Big screen | `/display/` | OBS Browser Source, 1920 × 1080 |
| Public | `/live/` (the site root also opens it) | Spectators via QR |

Sport ids: `sepaktakraw`, `badminton`, `futsal`, `bolajaring`, `dart`, `pingpong`.

---

## 1. Firebase (about 10 minutes)

Open https://console.firebase.google.com → **JA Scoring System**.

1. **Realtime Database** (Build → Realtime Database) → *Create database* → location **Singapore (asia-southeast1)** → *Start in locked mode*.
2. Open its **Rules** tab, delete everything, paste the whole of `database.rules.json`, click **Publish**.
3. **Authentication** → *Get started* → **Email/Password** → enable → Save.
4. Authentication → **Users** → *Add user*, create these 7 accounts (emails don't need to be real, they are never emailed):

   | Email | Give password to |
   |---|---|
   | `admin@ja-scoring.app` | you only |
   | `sepaktakraw@ja-scoring.app` | Sepak Takraw AJK |
   | `badminton@ja-scoring.app` | Badminton AJK |
   | `futsal@ja-scoring.app` | Futsal AJK |
   | `bolajaring@ja-scoring.app` | Bola Jaring AJK |
   | `dart@ja-scoring.app` | Dart AJK |
   | `pingpong@ja-scoring.app` | Ping Pong AJK |

   Use a different password for each (at least 6 characters).
5. **Important:** Authentication → **Settings** → *User actions* → **untick "Enable create (sign-up)"** → Save. This stops strangers from creating their own accounts.
6. Project settings (⚙) → General → *Your apps* → click **</>** (Web) → register an app (no hosting) → copy the `firebaseConfig` values into **`config.js`**.
   Make sure `databaseURL` is there – if not, copy it from the top of the Realtime Database page.

> The API key in config.js is meant to be public. Security comes from the rules + passwords.

## 2. GitHub Pages

1. Create a new repo, e.g. `ja-scoring` (public).
2. Upload **all files and folders** from this zip to the repo root (keep the folder structure).
3. Repo → Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
4. After a minute your site is at `https://<your-username>.github.io/ja-scoring/`.
5. Firebase → Authentication → Settings → **Authorized domains** → add `<your-username>.github.io`.

## 3. Before the event

1. Open `/admin/`, log in with the admin password.
2. **Links & QR** tab: copy each sport's scorer link, download the QR for the public page.
3. Each AJK opens their link → types name/court + password → **Setup** tab:
   - Add teams (`Name | Short | Group`, one per line).
   - Add matches one by one, or use **Generate round-robin** for a group.
   - Check the format (points, best of, minutes) before adding matches.
4. OBS: add a **Browser Source** → URL `.../display/` → width 1920, height 1080.
   Control what it shows from Admin → **Big screen** (auto-rotate, pin a sport, or feature one match).
   Need one scene per sport? Use `.../display/?sport=futsal` etc.
5. Do a test run, then Admin → Tools → **Delete matches only** for each sport you tested.

## How scoring works (tell the AJKs)

- Tap a match → it is now **locked to that phone**. Another phone sees 🔒 and must confirm "Take control".
- Press **← Matches** when done so the match is released (it also auto-releases after 3 minutes of no activity).
- Every tap can be undone. Results need a **Confirm result** tap. Wrong confirm? More → *Reopen match*.
- Need to call teams or announce a break? Tap **📢 Make an announcement** (top of the match list, or More → Make an announcement). It shows on the big screen and the live page for your sport, and disappears after the time you pick.
- Badminton / Ping Pong / Sepak Takraw: tap the team's big box when they win the rally. Serve indicator follows the sport's rules.
- Futsal / Bola Jaring: Start clock → +Goal / +Foul → End half/quarter → Confirm result. Clock syncs to every screen.
- Dart: type each turn's 3-dart total (or tap a quick number) → Enter. Bust is automatic.
- Everything is recorded in the **Activity log** (who, what, when).

## Free plan limits (why the public page refreshes every 12 s)

- Scorers, admin and OBS use live connections (Firebase free plan allows 100 at once – plenty).
- The public page doesn't hold a connection; it re-checks every 12 seconds and pauses when the phone screen is off. This keeps hundreds of spectators inside the free 10 GB/month download.
- Venue internet is the main risk: keep a phone hotspot ready for the OBS PC. Scorer phones keep working offline and sync when back online (the dot in the header turns green).

## Changing things

- Sport names, colours, days: `config.js` → `SPORTS`.
- Default formats (points, best of, minutes): `js/engines.js` → `FORMATS` (or change per match in Setup).
- Standings: win 3, draw 1, loss 0 – `standings()` in `js/engines.js`.
