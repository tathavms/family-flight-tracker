# Flight Deck — family dashboard

One page: two synced world clocks (IST + Charlotte), a live tracker for
Lufthansa flight LH428 (Munich → Charlotte), and live location sharing
so family can see where one traveler is until they stop sharing.

Everything runs in the browser. No server, no paid plan. Two free
accounts are required to wire it up (Firebase, and optionally nothing
else — the map needs no account at all). Total setup time: ~10 minutes.

---

## 1. What you need to do before it works

Right now `app.js` has placeholder Firebase values at the top, in a
clearly marked `CONFIG` section. The page will load and the clocks/flight
tracker will work immediately, but **location sharing won't work until
you create your own free Firebase project** and paste its config in.

### Step A — Create a free Firebase project

1. Go to <https://console.firebase.google.com>, sign in with any Google
   account, click **Add project**, give it any name (e.g. `family-tracker`),
   and finish the wizard (you can decline Google Analytics).
2. In the left sidebar: **Build → Realtime Database → Create Database**.
   Pick any region close to your family. Start in **locked mode** — we'll
   paste in proper rules next.
3. Go to the **Rules** tab of the Realtime Database and replace the
   contents with:

   ```json
   {
     "rules": {
       "locations": {
         ".read": true,
         ".write": true,
         "$name": {
           ".validate": "newData.hasChildren(['name', 'lat', 'lng', 'updatedAt'])"
         }
       }
     }
   }
   ```

   Click **Publish**. This lets anyone with your site's link read and
   write only under `/locations`, and only in the expected shape — nothing
   else in your database is exposed. See the security note below for why
   this is an intentional, low-stakes tradeoff for a family tool.

4. Back in **Project settings** (gear icon) → **General** → scroll to
   **Your apps** → click the `</>` (web) icon → register an app (any
   nickname, no need for Firebase Hosting) → it will show you a config
   object like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "family-tracker-xxxxx.firebaseapp.com",
     databaseURL: "https://family-tracker-xxxxx-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "family-tracker-xxxxx",
     storageBucket: "family-tracker-xxxxx.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

5. Open `app.js`, find `FIREBASE_CONFIG` near the top, and paste your
   real values in place of the placeholders.

That's it — no credit card, no billing account. Firebase's free "Spark"
plan (1 GB storage, 10 GB/month download, 100 simultaneous connections)
is enormous overkill for a handful of family members and costs nothing.

### Step B — (Optional) Set a family passcode

Find `FAMILY_PASSCODE = ""` in `app.js` and put a word or phrase between
the quotes, e.g. `"blueheron42"`. Anyone opening the page will need to
type it once (remembered after that on their device). See **Security
notes** below for what this does and doesn't protect against.

### Step C — Put it on GitHub Pages

1. Create a new **public** repository on GitHub (Pages on the free plan
   requires a public repo).
2. Upload all four files (`index.html`, `style.css`, `app.js`,
   `README.md`) to the repo root.
3. Repo **Settings → Pages** → under "Build and deployment", set
   **Source: Deploy from a branch**, branch `main`, folder `/root` → Save.
4. After a minute your site is live at
   `https://<your-username>.github.io/<repo-name>/`.
5. Share that link only with family — see the security note below.

GitHub Pages serves over HTTPS automatically, which is required for the
browser's location permission prompt to appear at all.

---

## 2. How each part works (and its real limits)

**Clocks.** Uses your device's clock, corrected against a free time API
(`timeapi.io`, with a second free API as fallback) so a slightly-wrong
system clock doesn't throw things off. If both APIs are unreachable it
falls back to the device clock and says so quietly in the small badge
above the clocks. Modern phones/computers are usually NTP-synced anyway,
so this is a belt-and-suspenders check, not a lifeline.

**Flight tracker.** Pulls live ADS-B position data for callsign `DLH428`
from the [OpenSky Network](https://opensky-network.org), a free,
research-oriented flight-tracking API that needs no account for light
use. Two real limitations worth knowing:
- **Ocean coverage gap.** OpenSky relies on ground-based receivers, not
  satellites. For a chunk of the Munich–Charlotte flight over the
  mid-Atlantic, no receiver may be in range, so the tracker will honestly
  say "No live signal" rather than guess. Commercial trackers like
  FlightAware or Flightradar24 fill this gap with satellite ADS-B, which
  isn't free to query programmatically — the page links out to
  FlightAware's page for LH428 as a manual cross-check when this happens.
- **Rate limit.** Anonymous access gets 400 request-credits/day. The page
  polls once a minute and only while the tab is actually visible, which
  stays comfortably inside that limit.

**Family location sharing.** When someone clicks "Share my location,"
the browser's geolocation API streams position updates into your
Firebase Realtime Database, and every open copy of the page (anyone in
the family with the link) subscribes to that same data and updates
markers live. Clicking "Stop sharing" deletes the entry immediately for
everyone; closing the tab or losing connection does the same
automatically (via Firebase's `onDisconnect`), so a sharer can't get
"stuck" visible by accident.

**The one real constraint to know:** this is a website, not an installed
app, so it only updates location while the tab is open *and* the phone
screen is on. iOS and Android both aggressively pause JavaScript timers
and geolocation once a phone locks or the browser goes to the background.
For someone traveling alone, keep the tab open and the screen awake
during the window you want them tracked — a plugged-in charger and
disabled auto-lock help a lot here. If you need tracking that survives a
locked screen, that requires a native app (e.g. Find My, Google's Find
Hub/Family Link, Life360) rather than a browser page — worth knowing
going in.

**Map.** Uses Leaflet with OpenStreetMap tiles — free, no API key, no
account, ever. This was chosen over Google Maps specifically because
Google now requires a billing account (card on file) to use its Maps
JavaScript API at all, even to stay inside the free monthly quota.

---

## 3. Security notes (read this once)

- The Firebase config in `app.js` (API key, project ID, etc.) is **not**
  a secret — Google's own docs say this is safe to expose in client-side
  code. What actually protects your data is the Database Rules pasted in
  Step A, which restrict access to just the `/locations` path.
- With the rules above, **anyone who has your page's URL** can read and
  write to `/locations` — there's no login system. For a small family
  tool this is a deliberate, documented tradeoff in favor of simplicity.
  The passcode in Step B is a light deterrent against a stranger
  stumbling onto the link, not real access control — page source reveals
  it to anyone who looks.
- The page ships with `<meta name="robots" content="noindex">` and a
  `robots.txt` so search engines shouldn't index it, but on the free
  GitHub Pages tier the repo (and therefore the site) must be **public** —
  don't post the link anywhere outside the family.
- If you ever want real access control, the next step up is adding
  Firebase Authentication (e.g. a shared Google sign-in restricted to
  family email addresses) — happy to help wire that up if you want it
  later; it's a bigger change than this simple version.

---

## 4. Tracking a different flight later

Edit the `FLIGHT` block near the top of `app.js`:

```js
const FLIGHT = {
  callsign: "DLH428",   // ICAO airline code + flight number, no spaces
  label: "LH428",
  origin: { code: "MUC", name: "Munich",    lat: 48.3538, lng: 11.7861 },
  dest:   { code: "CLT", name: "Charlotte", lat: 35.2144, lng: -80.9473 },
  bbox: { lamin: 15, lomin: -95, lamax: 70, lomax: 25 },
  pollMs: 60000
};
```

Find the ICAO callsign for any flight (airline ICAO code, e.g. Lufthansa
= `DLH`, plus the flight number) via FlightAware or Flightradar24, and
widen `bbox` if the new route doesn't fall inside the current box.

---

## 5. Troubleshooting

- **"Location error: User denied Geolocation"** — the browser needs
  location permission; check the site permissions in the browser's
  address-bar padlock menu.
- **Flight tracker stuck on "Tracker unavailable"** — OpenSky occasionally
  rate-limits or has downtime; it retries automatically every minute, and
  the "↻ Refresh" button forces an immediate retry.
- **Map tiles not loading** — OpenStreetMap's tile server is free but
  asks that low-traffic personal projects like this use it directly
  (which this does); if it ever gets slow, swapping in another free tile
  provider (e.g. CartoDB) is a one-line change in `app.js`.
- **Nothing shows up after deploying** — open the browser console
  (F12) on the GitHub Pages URL; a red error naming `FIREBASE_CONFIG`
  usually means Step A wasn't finished.
