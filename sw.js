/* Jeanty Tracker service worker: offline app shell + background sunset alerts. */

const CACHE = 'jeanty-shell-v3';
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
function sunsetScore(h) {
  if (!h) return null;
  const high = band(h.cloudHigh, 5, 25, 65, 100);
  const mid = band(h.cloudMid, 5, 20, 55, 95);
  const lowP = h.cloudLow != null ? clamp01(1 - h.cloudLow / 70) : 0.7;
  const humidity = h.humidity != null ? clamp01(1 - (h.humidity - 40) / 55) : 0.6;
  const vis = h.visibility != null ? clamp01(h.visibility / 20000) : 0.7;
  const dry = h.precip != null ? clamp01(1 - h.precip / 1.5) : 1;
  const cloudStructure = 0.62 * high + 0.38 * mid;
  const clarity = 0.45 * lowP + 0.25 * vis + 0.30 * humidity;
  let score = 0.55 * cloudStructure + 0.30 * clarity + 0.15 * 0.5;
  score *= (0.6 + 0.4 * lowP);
  score *= dry;
  if ((h.cloudHigh || 0) < 8 && (h.cloudMid || 0) < 8 && (h.cloudLow || 0) < 20) {
    score = Math.max(score, 0.42 * humidity);
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

  let data;
  try { data = await (await fetch(url)).json(); } catch { return; }

  const wh = data.hourly;
  const idx = new Map(wh.time.map((t, i) => [t, i]));
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
    const h = {
      precip: wh.precipitation?.[i],
      cloudLow: wh.cloud_cover_low?.[i],
      cloudMid: wh.cloud_cover_mid?.[i],
      cloudHigh: wh.cloud_cover_high?.[i],
      visibility: wh.visibility?.[i],
      humidity: wh.relative_humidity_2m?.[i],
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
