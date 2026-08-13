/* Jeanty Tracker service worker: offline app shell + background sunset alerts. */

const CACHE = 'jeanty-shell-v4';
const CONFIG_CACHE = 'jeanty-config';
const CONFIG_KEY = '/__jeanty-config';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/scoring.js',
  './js/sunset.js',
  './js/ui.js',
  './js/notifications.js',
  './js/weathercodes.js',
  './assets/logo.svg',
  './assets/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== CONFIG_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache API traffic — always fetch fresh forecast data.
  if (url.hostname.endsWith('open-meteo.com')) return;
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Network-first for the app shell: always show the latest version when online,
  // fall back to the cached copy when offline.
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});

// ---------- Config bridge (written by the page, read here) ----------
async function readConfig() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const res = await cache.match(CONFIG_KEY);
    return res ? res.json() : null;
  } catch { return null; }
}
async function writeConfig(cfg) {
  const cache = await caches.open(CONFIG_CACHE);
  await cache.put(CONFIG_KEY, new Response(JSON.stringify(cfg), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'config') {
    event.waitUntil(writeConfig(event.data.payload));
  }
});

// ---------- Background sunset check ----------
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sunset-check') {
    event.waitUntil(runSunsetCheck());
  }
});

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function band(v, lo, hiIdeal, hiFull, max) {
  if (v == null) return 0.5;
  if (v <= lo) return 0;
  if (v < hiIdeal) return (v - lo) / (hiIdeal - lo);
  if (v <= hiFull) return 1;
  if (v >= max) return 0;
  return 1 - (v - hiFull) / (max - hiFull);
}
// Compact mirror of js/sunset.js sunsetScoreForHour.
// Verbatim copy of sunsetScoreForHour in js/sunset.js — keep in sync.
// test/sunset-parity.mjs asserts this matches. Update both together.
function sunsetScore(h) {
  if (!h) return null;
  const high = band(h.cloudHigh, 5, 20, 55, 95);
  const mid = band(h.cloudMid, 5, 15, 45, 85);
  const canvas = 0.65 * high + 0.35 * mid;
  const humidityClear = h.humidity != null ? clamp01((85 - h.humidity) / 45) : 0.55;
  const vis = h.visibility != null ? clamp01((h.visibility - 8000) / 17000) : 0.6;
  const lowClear = h.cloudLow != null ? clamp01(1 - h.cloudLow / 60) : 0.7;
  const aodClean = h.aod != null ? clamp01(1 - (h.aod - 0.15) / 0.45) : 0.7;
  const aodColour = h.aod != null ? band(h.aod, 0, 0.05, 0.15, 0.5) : 0.4;
  const clarity = clamp01(0.5 * humidityClear + 0.3 * vis + 0.2 * lowClear);
  const dry = h.precip != null ? clamp01(1 - h.precip / 1.5) : 1;
  let score = canvas * (0.30 + 0.70 * clarity);
  score += 0.12 * aodColour * clarity;
  const hazeCap = 0.30 + 0.70 * Math.min(humidityClear, vis, aodClean);
  score = Math.min(score, hazeCap);
  score *= dry;
  score *= (0.55 + 0.45 * lowClear);
  if ((h.cloudHigh ?? 0) < 8 && (h.cloudMid ?? 0) < 8 && (h.cloudLow ?? 0) < 20) {
    score = Math.max(score, 0.34 * humidityClear);
    score = Math.min(score, hazeCap);
  }
  return Math.round(clamp01(score) * 100);
}

async function runSunsetCheck() {
  const cfg = await readConfig();
  if (!cfg || !cfg.notifyEnabled || !cfg.location) return;

  const { lat, lon } = cfg.location;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&hourly=precipitation,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m' +
    '&daily=sunset&timezone=auto&forecast_days=3';
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    '&hourly=aerosol_optical_depth&timezone=auto&forecast_days=3';

  let data, air;
  try { data = await (await fetch(url)).json(); } catch { return; }
  try { air = await (await fetch(airUrl)).json(); } catch { air = null; }

  const wh = data.hourly;
  const idx = new Map(wh.time.map((t, i) => [t, i]));
  const airIdx = air?.hourly ? new Map(air.hourly.time.map((t, i) => [t, i])) : null;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  for (const sunsetStr of (data.daily?.sunset || [])) {
    const date = sunsetStr.slice(0, 10);
    if (date < today) continue;
    const sunsetTime = new Date(sunsetStr).getTime();
    if (sunsetTime < now) continue;

    // Nearest hourly sample to sunset.
    const hourKey = sunsetStr.slice(0, 13) + ':00';
    const i = idx.has(hourKey) ? idx.get(hourKey) : null;
    if (i == null) continue;
    const ai = airIdx && airIdx.has(hourKey) ? airIdx.get(hourKey) : null;
    const h = {
      precip: wh.precipitation?.[i],
      cloudLow: wh.cloud_cover_low?.[i],
      cloudMid: wh.cloud_cover_mid?.[i],
      cloudHigh: wh.cloud_cover_high?.[i],
      visibility: wh.visibility?.[i],
      humidity: wh.relative_humidity_2m?.[i],
      aod: ai != null ? air.hourly.aerosol_optical_depth?.[ai] : null,
    };
    const score = sunsetScore(h);
    if (score != null && score >= (cfg.sunsetThreshold || 80)) {
      if (cfg.lastNotifiedDate === date) return;
      const time = new Date(sunsetStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      await self.registration.showNotification('Beautiful sunset ahead 🌅', {
        body: `Vivid sunset forecast (${score}/100) at ${time}. Take the boat out!`,
        icon: './assets/logo.svg',
        badge: './assets/logo.svg',
        tag: `jeanty-sunset-${date}`,
        data: { url: './index.html#/sunset' },
      });
      cfg.lastNotifiedDate = date;
      await writeConfig(cfg);
      return;
    }
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './index.html#/sunset';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(target); return c.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
