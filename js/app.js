// Jeanty Tracker — app controller: routing, state, modals, data loading.

import { SPORTS, SPORT_ORDER, loadSettings, saveSettings } from './config.js';
import { fetchConditions, geocode, reverseLabel } from './api.js';
import * as ui from './ui.js';
import {
  registerServiceWorker, notificationsSupported, permissionState,
  requestPermission, sendTestNotification, enableBackgroundChecks, checkSunsetAlerts,
  pushConfigToSW,
} from './notifications.js';

const view = document.getElementById('view');
let settings = loadSettings();
let dataset = null;
let loadingPromise = null;
const selectedDay = {}; // per-sport selected date key

window.__jeantyUnits = settings.units;

// ---------- Routing ----------
const ROUTES = ['tubing', 'wakeboarding', 'speedboating', 'hydrofoiling', 'sunset'];

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(hash) ? hash : 'tubing';
}

function setActiveTab(route) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === route);
  });
}

async function ensureData() {
  if (!settings.location) return null;
  if (dataset) return dataset;
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetchConditions(settings.location.lat, settings.location.lon)
    .then((d) => { dataset = d; return d; })
    .finally(() => { loadingPromise = null; });
  return loadingPromise;
}

async function render() {
  const route = currentRoute();
  setActiveTab(route);

  if (!settings.location) {
    view.innerHTML = ui.noLocationView();
    return;
  }

  view.innerHTML = ui.loadingView();
  let data;
  try {
    data = await ensureData();
  } catch (e) {
    view.innerHTML = ui.errorView(e.message || 'Network error');
    return;
  }

  if (currentRoute() !== route) return; // route changed while loading

  if (route === 'sunset') {
    view.innerHTML = ui.sunsetView(data, settings.sunsetThreshold);
  } else {
    view.innerHTML = ui.sportView(data, route, selectedDay[route]);
  }
}

// Day-chip selection (event delegation).
view.addEventListener('click', (e) => {
  const chip = e.target.closest('.day-chip');
  if (chip) {
    const route = currentRoute();
    selectedDay[route] = chip.dataset.day;
    render();
    return;
  }
  if (e.target.closest('#open-location')) openLocationModal();
});

window.addEventListener('hashchange', render);

// ---------- Location modal ----------
const locModal = document.getElementById('location-modal');
const settingsModal = document.getElementById('settings-modal');

function openLocationModal() {
  document.getElementById('lat-input').value = settings.location?.lat ?? '';
  document.getElementById('lon-input').value = settings.location?.lon ?? '';
  document.getElementById('place-input').value = '';
  document.getElementById('place-results').innerHTML = '';
  locModal.showModal();
}

document.getElementById('location-btn').addEventListener('click', openLocationModal);
document.getElementById('location-cancel').addEventListener('click', () => locModal.close());

document.getElementById('use-gps').addEventListener('click', () => {
  const btn = document.getElementById('use-gps');
  if (!navigator.geolocation) { btn.textContent = 'Geolocation not available'; return; }
  btn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const label = await reverseLabel(latitude, longitude);
      await applyLocation(latitude, longitude, label);
      locModal.close();
    },
    () => { btn.textContent = '📍 Location blocked — enter manually'; },
    { enableHighAccuracy: false, timeout: 10000 }
  );
});

let searchTimer = null;
document.getElementById('place-input').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  const box = document.getElementById('place-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const results = await geocode(q);
      box.innerHTML = results.map((r, i) =>
        `<button type="button" data-i="${i}">${r.label}</button>`
      ).join('') || '<p class="muted small">No matches.</p>';
      box.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', async () => {
          const r = results[Number(b.dataset.i)];
          await applyLocation(r.lat, r.lon, r.label);
          locModal.close();
        });
      });
    } catch { box.innerHTML = '<p class="muted small">Search failed.</p>'; }
  }, 350);
});

document.getElementById('location-save').addEventListener('click', async () => {
  const lat = parseFloat(document.getElementById('lat-input').value);
  const lon = parseFloat(document.getElementById('lon-input').value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) { locModal.close(); return; }
  const label = await reverseLabel(lat, lon);
  await applyLocation(lat, lon, label);
  locModal.close();
});

async function applyLocation(lat, lon, label) {
  settings.location = { lat, lon, label };
  saveSettings(settings);
  document.getElementById('location-label').textContent = label;
  dataset = null; // invalidate cache
  render();
  pushConfigToSW();
  checkSunsetAlerts();
}

// ---------- Settings modal ----------
const unitsSelect = document.getElementById('units-select');
const notifyToggle = document.getElementById('notify-toggle');
const thresholdRange = document.getElementById('threshold-range');
const thresholdVal = document.getElementById('threshold-val');
const notifyStatus = document.getElementById('notify-status');

function syncSettingsUI() {
  unitsSelect.value = settings.units;
  notifyToggle.checked = settings.notifyEnabled;
  thresholdRange.value = settings.sunsetThreshold;
  thresholdVal.textContent = settings.sunsetThreshold;
  updateNotifyStatus();
}

function updateNotifyStatus() {
  if (!notificationsSupported()) {
    notifyStatus.textContent = 'Notifications aren\'t supported in this browser. On iPhone, add the app to your Home Screen first.';
    return;
  }
  const p = permissionState();
  if (p === 'denied') notifyStatus.textContent = 'Notifications are blocked in your browser settings.';
  else if (p === 'granted') notifyStatus.textContent = settings.notifyEnabled ? 'Alerts on — you\'ll be notified of standout sunsets.' : 'Permission granted. Toggle on to receive alerts.';
  else notifyStatus.textContent = 'Toggle on to allow sunset alerts.';
}

document.getElementById('settings-btn').addEventListener('click', () => {
  syncSettingsUI();
  settingsModal.showModal();
});
document.getElementById('settings-close').addEventListener('click', () => settingsModal.close());

unitsSelect.addEventListener('change', () => {
  settings.units = unitsSelect.value;
  window.__jeantyUnits = settings.units;
  saveSettings(settings);
  render();
});

notifyToggle.addEventListener('change', async () => {
  if (notifyToggle.checked) {
    const p = await requestPermission();
    if (p !== 'granted') {
      notifyToggle.checked = false;
      settings.notifyEnabled = false;
      updateNotifyStatus();
      saveSettings(settings);
      return;
    }
    settings.notifyEnabled = true;
    saveSettings(settings);
    pushConfigToSW();
    await enableBackgroundChecks();
    checkSunsetAlerts();
  } else {
    settings.notifyEnabled = false;
    saveSettings(settings);
    pushConfigToSW();
  }
  saveSettings(settings);
  updateNotifyStatus();
});

thresholdRange.addEventListener('input', () => {
  thresholdVal.textContent = thresholdRange.value;
});
thresholdRange.addEventListener('change', () => {
  settings.sunsetThreshold = Number(thresholdRange.value);
  saveSettings(settings);
  pushConfigToSW();
  if (currentRoute() === 'sunset') render();
});

document.getElementById('test-notify').addEventListener('click', async () => {
  const ok = await sendTestNotification();
  notifyStatus.textContent = ok ? 'Test notification sent.' : 'Couldn\'t send — permission not granted.';
});

// ---------- Boot ----------
function boot() {
  if (settings.location) {
    document.getElementById('location-label').textContent = settings.location.label;
  }
  if (!location.hash) location.hash = '#/tubing';
  render();
  registerServiceWorker().then(() => {
    pushConfigToSW();
    if (settings.notifyEnabled) { enableBackgroundChecks(); checkSunsetAlerts(); }
  });
}

boot();
