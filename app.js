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

// =====================================================================
// Clocks — corrected against a free online time API, ticked locally
// =====================================================================

let clockOffsetMs = 0; // serverTime - deviceTime, added to Date.now()
let use24Hour = localStorage.getItem('clockFormat') === '24';

function now() { return new Date(Date.now() + clockOffsetMs); }

function parseTimeApiMs(d) {
  const iso = d.dateTime || d.utcDateTime || d.datetime;
  if (iso) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  if (Number.isFinite(d.unixTime)) return d.unixTime * 1000;
  if (Number.isFinite(d.unixtime)) return d.unixtime * 1000;
  const seconds = d.seconds ?? d.second ?? 0;
  const millis = d.milliSeconds ?? d.milliseconds ?? 0;
  return Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, seconds, millis);
}

async function syncClock() {
  const badge = document.getElementById('sync-badge');
  const sources = [
    async () => {
      const r = await fetch('https://timeapi.io/api/time/current/zone?timeZone=UTC', { cache: 'no-store' });
      if (!r.ok) throw new Error('timeapi.io ' + r.status);
      return parseTimeApiMs(await r.json());
    },
    async () => {
      const r = await fetch('https://time.now/developer/api/timezone/UTC', { cache: 'no-store' });
      if (!r.ok) throw new Error('time.now ' + r.status);
      return parseTimeApiMs(await r.json());
    }
  ];

  for (const getServerMs of sources) {
    try {
      const before = Date.now();
      const serverMs = await getServerMs();
      if (!Number.isFinite(serverMs)) throw new Error('invalid server time');
      const after = Date.now();
      const roundTrip = after - before;
      const offset = serverMs - (before + roundTrip / 2);
      if (Math.abs(offset) > 60 * 1000) throw new Error('suspicious offset');
      clockOffsetMs = offset;
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
  setInterval(syncClock, 15 * 60 * 1000);
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
  const firebaseApp = initializeApp(firebaseConfig);
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
