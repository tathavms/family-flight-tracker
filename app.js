// =====================================================================
// Flight Deck — family dashboard
// Read README.md before deploying. Fill in CONFIG below first.
// =====================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getDatabase, ref, set, onValue, onDisconnect, remove
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// =====================================================================
// CONFIG — this is the only section you should need to edit.
// =====================================================================

// 1) Firebase project config.
//    Firebase console → Project settings → General → Your apps → SDK setup.
//    These values are not secret — Firebase security comes from Database
//    Rules, not from hiding this object. See README.md for the rules to paste in.
const firebaseConfig = {
    apiKey: "AIzaSyDb9yAMGYdNP4GxOVSwK7xl3Jbxnbr9qjc",
    authDomain: "family-flight-tracker.firebaseapp.com",
    databaseURL: "https://family-flight-tracker-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "family-flight-tracker",
    storageBucket: "family-flight-tracker.firebasestorage.app",
    messagingSenderId: "162319177167",
    appId: "1:162319177167:web:adeab50d74d6f8fa21aeba"
};

// 2) Optional light passcode gate. Leave as "" to disable entirely.
//    This deters casual snooping if the URL leaks — it is NOT real security,
//    since anyone can read it from page source. See README.md.
const FAMILY_PASSCODE = "srishti96";

// 3) Flight to track (OpenSky Network, free, no key, no login required).
const FLIGHT = {
  callsign: "DLH428",       // ICAO callsign: airline ICAO code (Lufthansa = DLH) + flight number
  label: "LH428",           // What to show on screen
  origin: { code: "MUC", name: "Munich",    lat: 48.3538, lng: 11.7861 },
  dest:   { code: "CLT", name: "Charlotte", lat: 35.2144, lng: -80.9473 },
  // Bounding box sent to OpenSky so the response stays small and cheap
  // (anonymous OpenSky access gets 400 request-credits/day). This box
  // covers the North Atlantic corridor between Europe and the US East Coast —
  // widen it if you point this at a different route.
  bbox: { lamin: 15, lomin: -95, lamax: 70, lomax: 25 },
  pollMs: 60000
};

// =====================================================================
// Utilities
// =====================================================================

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Great-circle interpolation (spherical slerp) so the route line on the
// map curves realistically instead of drawing a flat straight line.
function greatCirclePoints(lat1, lon1, lat2, lon2, n = 64) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const phi1 = toRad(lat1), lam1 = toRad(lon1), phi2 = toRad(lat2), lam2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((phi2 - phi1) / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
  ));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);
    const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lam = Math.atan2(y, x);
    points.push([toDeg(phi), toDeg(lam)]);
  }
  return points;
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// =====================================================================
// Clocks — corrected against a free online time API, ticked locally
// =====================================================================

let clockOffsetMs = 0; // serverTime - deviceTime, added to Date.now()
let use24Hour = localStorage.getItem('clockFormat') === '24';

function now() { return new Date(Date.now() + clockOffsetMs); }

async function syncClock() {
  const badge = document.getElementById('sync-badge');
  const sources = [
    async () => {
      const r = await fetch('https://timeapi.io/api/time/current/zone?timeZone=UTC');
      if (!r.ok) throw new Error('timeapi.io ' + r.status);
      const d = await r.json();
      return Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.seconds, d.milliSeconds || 0);
    },
    async () => {
      const r = await fetch('https://time.now/developer/api/timezone/UTC');
      if (!r.ok) throw new Error('time.now ' + r.status);
      const d = await r.json();
      return new Date(d.datetime).getTime();
    }
  ];

  for (const getServerMs of sources) {
    try {
      const before = Date.now();
      const serverMs = await getServerMs();
      const roundTrip = Date.now() - before;
      clockOffsetMs = (serverMs + roundTrip / 2) - Date.now();
      if (badge) { badge.textContent = 'Time synced'; badge.style.color = 'var(--teal)'; }
      return;
    } catch (e) { /* try next source */ }
  }
  clockOffsetMs = 0;
  if (badge) { badge.textContent = 'Using device clock'; badge.style.color = 'var(--muted)'; }
}

function formatZone(date, timeZone) {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !use24Hour
  }).format(date);
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long'
  }).format(date);
  return { time, date: dateStr };
}

function renderClocks() {
  const d = now();
  const ist = formatZone(d, 'Asia/Kolkata');
  const clt = formatZone(d, 'America/New_York');
  document.getElementById('time-ist').textContent = ist.time;
  document.getElementById('date-ist').textContent = ist.date;
  document.getElementById('time-clt').textContent = clt.time;
  document.getElementById('date-clt').textContent = clt.date;
}

function setFormat(fmt) {
  use24Hour = fmt === '24';
  localStorage.setItem('clockFormat', fmt);
  document.getElementById('fmt-12').classList.toggle('active', !use24Hour);
  document.getElementById('fmt-24').classList.toggle('active', use24Hour);
  renderClocks();
}

function startClocks() {
  document.getElementById('fmt-12').addEventListener('click', () => setFormat('12'));
  document.getElementById('fmt-24').addEventListener('click', () => setFormat('24'));
  setFormat(use24Hour ? '24' : '12');
  syncClock();
  renderClocks();
  setInterval(renderClocks, 1000);
  setInterval(syncClock, 15 * 60 * 1000); // re-sync periodically to correct drift
}

// =====================================================================
// Flight tracker — OpenSky Network (free, anonymous, no key)
// =====================================================================

let flightMap, flightMarker, routeLine;

function initFlightMap() {
  flightMap = L.map('flight-map', {
    zoomControl: false,
    scrollWheelZoom: false
  }).setView([45, -30], 3);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 8,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(flightMap);

  const routePoints = greatCirclePoints(
    FLIGHT.origin.lat, FLIGHT.origin.lng, FLIGHT.dest.lat, FLIGHT.dest.lng, 64
  );
  routeLine = L.polyline(routePoints, { color: '#8B96AD', weight: 1.5, dashArray: '4 6' }).addTo(flightMap);
  L.circleMarker([FLIGHT.origin.lat, FLIGHT.origin.lng], { radius: 4, color: '#2DD4BF' }).addTo(flightMap);
  L.circleMarker([FLIGHT.dest.lat, FLIGHT.dest.lng], { radius: 4, color: '#2DD4BF' }).addTo(flightMap);

  flightMap.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
  setTimeout(() => flightMap.invalidateSize(), 200);

  document.getElementById('flight-origin').textContent = FLIGHT.origin.code;
  document.getElementById('flight-dest').textContent = FLIGHT.dest.code;
  document.getElementById('flight-number').textContent = FLIGHT.label;
}

function planeIcon(rotationDeg) {
  return L.divIcon({
    className: '',
    html: `<svg class="plane-icon" width="26" height="26" viewBox="0 0 24 24" style="transform:rotate(${rotationDeg}deg)">
      <path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

async function fetchOpenSky() {
  const { lamin, lomin, lamax, lomax } = FLIGHT.bbox;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('direct ' + r.status);
    return await r.json();
  } catch (e) {
    // OpenSky doesn't always send CORS headers for browser fetches — fall
    // back through a free public CORS proxy. Swap this URL if it's ever down.
    const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    const r2 = await fetch(proxied);
    if (!r2.ok) throw new Error('proxy ' + r2.status);
    return await r2.json();
  }
}

async function updateFlight() {
  const dot = document.getElementById('flight-live-dot');
  const note = document.getElementById('flight-note');
  try {
    const data = await fetchOpenSky();
    const rows = data.states || [];
    const row = rows.find(r => (r[1] || '').replace(/\s+/g, '').toUpperCase() === FLIGHT.callsign);

    if (!row) {
      dot.classList.remove('live');
      document.getElementById('flight-status').textContent = 'No live signal';
      document.getElementById('flight-altitude').textContent = '—';
      document.getElementById('flight-speed').textContent = '—';
      document.getElementById('flight-progress').textContent = '—';
      document.getElementById('flight-updated').textContent = new Date().toLocaleTimeString();
      note.textContent = `OpenSky isn't reporting ${FLIGHT.label} right now. That's expected if it hasn't departed yet, has already landed, or is over the mid-Atlantic where ground-based ADS-B coverage is thin (OpenSky uses ground receivers, not satellites). You can cross-check at flightaware.com/live/flight/DLH428.`;
      note.classList.remove('hidden');
      return;
    }

    note.classList.add('hidden');
    const [, , , , , lon, lat, baroAlt, onGround, velocity, trueTrack, , , geoAlt] = row;
    const altitude = geoAlt || baroAlt || 0;
    const speedKmh = velocity ? Math.round(velocity * 3.6) : 0;

    dot.classList.add('live');
    document.getElementById('flight-status').textContent = onGround ? 'On ground' : 'En route';
    document.getElementById('flight-altitude').textContent = altitude ? `${Math.round(altitude).toLocaleString()} m` : '—';
    document.getElementById('flight-speed').textContent = speedKmh ? `${speedKmh.toLocaleString()} km/h` : '—';
    document.getElementById('flight-updated').textContent = new Date().toLocaleTimeString();

    const totalKm = haversineKm(FLIGHT.origin.lat, FLIGHT.origin.lng, FLIGHT.dest.lat, FLIGHT.dest.lng);
    const remainingKm = haversineKm(lat, lon, FLIGHT.dest.lat, FLIGHT.dest.lng);
    const progressPct = Math.max(0, Math.min(100, Math.round((1 - remainingKm / totalKm) * 100)));
    document.getElementById('flight-progress').textContent = `${progressPct}%`;

    if (!flightMarker) {
      flightMarker = L.marker([lat, lon], { icon: planeIcon(trueTrack || 0) }).addTo(flightMap);
    } else {
      flightMarker.setLatLng([lat, lon]);
      flightMarker.setIcon(planeIcon(trueTrack || 0));
    }
  } catch (err) {
    dot.classList.remove('live');
    document.getElementById('flight-status').textContent = 'Tracker unavailable';
    note.textContent = 'Could not reach the flight data source just now. It will retry automatically on the next refresh.';
    note.classList.remove('hidden');
    console.error('Flight tracker error:', err);
  }
}

function startFlightTracking() {
  initFlightMap();
  updateFlight();
  setInterval(() => {
    if (document.visibilityState === 'visible') updateFlight();
  }, FLIGHT.pollMs);
  document.getElementById('flight-refresh').addEventListener('click', updateFlight);
}

// =====================================================================
// Family location sharing — Firebase Realtime Database + Leaflet
// =====================================================================

let db = null;
let familyMap;
let watchId = null;
let sharingName = null;
const markers = {}; // name -> L.marker
const palette = ['#2DD4BF', '#F5A623', '#F472B6', '#60A5FA', '#A78BFA', '#34D399'];

function colorFor(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 997;
  return palette[Math.abs(hash) % palette.length];
}

function encodeKey(name) {
  // Firebase Realtime Database keys can't contain . $ # [ ] or /
  return name.trim().replace(/[.$#[\]/]/g, '_');
}

function initFamilyMap() {
  familyMap = L.map('family-map').setView([20, 30], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(familyMap);
  setTimeout(() => familyMap.invalidateSize(), 200);
}

function markerIcon(name) {
  const color = colorFor(name);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin" style="background:${color}"><span>${initial}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });
}

function renderSharersList(entries) {
  const list = document.getElementById('sharers-list');
  list.innerHTML = '';
  const names = Object.keys(entries);
  if (names.length === 0) {
    list.innerHTML = '<li style="color:var(--muted); justify-content:center;">Nobody is sharing their location right now.</li>';
    return;
  }
  names.forEach(name => {
    const info = entries[name];
    const age = Date.now() - (info.updatedAt || 0);
    const stale = age > 3 * 60 * 1000;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="dot" style="background:${stale ? '#8B96AD' : colorFor(name)}"></span>
      <span class="name">${name}</span>
      <span class="freshness">${stale ? 'Lost signal · last seen ' : 'Updated '}${timeAgo(info.updatedAt || Date.now())}</span>
    `;
    list.appendChild(li);
  });
}

function listenToLocations() {
  const locRef = ref(db, 'locations');
  onValue(locRef, (snap) => {
    const entries = snap.val() || {};
    renderSharersList(entries);

    Object.keys(markers).forEach(key => {
      if (!entries[key]) {
        familyMap.removeLayer(markers[key]);
        delete markers[key];
      }
    });

    const latlngs = [];
    Object.entries(entries).forEach(([key, info]) => {
      if (typeof info.lat !== 'number' || typeof info.lng !== 'number') return;
      latlngs.push([info.lat, info.lng]);
      if (markers[key]) {
        markers[key].setLatLng([info.lat, info.lng]);
      } else {
        markers[key] = L.marker([info.lat, info.lng], { icon: markerIcon(info.name || key) })
          .addTo(familyMap)
          .bindPopup(info.name || key);
      }
    });

    if (latlngs.length === 1) {
      familyMap.setView(latlngs[0], 14);
    } else if (latlngs.length > 1) {
      familyMap.fitBounds(latlngs, { padding: [40, 40] });
    }
  });
}

function startSharing(name) {
  if (!navigator.geolocation) {
    document.getElementById('share-status').textContent = "This browser doesn't support location sharing.";
    return;
  }
  sharingName = name;
  localStorage.setItem('familyTrackerName', name);

  const myRef = ref(db, 'locations/' + encodeKey(name));
  onDisconnect(myRef).remove(); // auto-clear if the tab closes or connection drops

  let lastWrite = 0;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const nowMs = Date.now();
      if (nowMs - lastWrite < 3000) return; // throttle writes to ~1 per 3s
      lastWrite = nowMs;
      set(myRef, {
        name,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        updatedAt: nowMs
      });
    },
    (err) => {
      document.getElementById('share-status').textContent =
        'Location error: ' + err.message + ' — sharing stopped.';
      stopSharing();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );

  const btn = document.getElementById('share-btn');
  btn.textContent = 'Stop sharing';
  btn.classList.add('active');
  document.getElementById('share-status').textContent =
    `Sharing as ${name}. Keep this tab open and the screen on — most phone browsers pause location updates once the screen locks or the tab goes to the background.`;
}

function stopSharing() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (sharingName) remove(ref(db, 'locations/' + encodeKey(sharingName)));
  const btn = document.getElementById('share-btn');
  btn.textContent = 'Share my location';
  btn.classList.remove('active');
  document.getElementById('share-status').textContent = 'Stopped sharing.';
  sharingName = null;
}

function initSharing() {
  const firebaseApp = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(firebaseApp);

  const nameInput = document.getElementById('share-name');
  nameInput.value = localStorage.getItem('familyTrackerName') || '';

  document.getElementById('share-btn').addEventListener('click', () => {
    if (watchId !== null) { stopSharing(); return; }
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    startSharing(name);
  });

  initFamilyMap();
  listenToLocations();
}

// =====================================================================
// Optional passcode gate + boot
// =====================================================================

function boot() {
  startClocks();
  startFlightTracking();
  initSharing();
}

function initGate() {
  const app = document.getElementById('app');
  if (!FAMILY_PASSCODE) { app.classList.remove('hidden'); boot(); return; }

  const alreadyUnlocked = localStorage.getItem('familyGateUnlocked') === '1';
  if (alreadyUnlocked) { app.classList.remove('hidden'); boot(); return; }

  const gate = document.getElementById('gate');
  gate.classList.remove('hidden');

  function tryUnlock() {
    const val = document.getElementById('gate-input').value;
    if (val === FAMILY_PASSCODE) {
      localStorage.setItem('familyGateUnlocked', '1');
      gate.classList.add('hidden');
      app.classList.remove('hidden');
      boot();
    } else {
      document.getElementById('gate-error').classList.remove('hidden');
    }
  }

  document.getElementById('gate-submit').addEventListener('click', tryUnlock);
  document.getElementById('gate-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
}

initGate();
