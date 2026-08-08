# 🌅 Jeanty Tracker

A mobile-first web app for finding the best days and hours to take the boat out —
and the most beautiful sunsets to catch while you're on the water.

It tracks, **hour by hour**, the conditions that matter for four watersports, plus a
dedicated sunset forecaster with push alerts.

## Sports pages

Each sport has its own page with an hour-by-hour breakdown and a tuned suitability
score (0–100) that highlights the best window of the day:

| Sport | What it likes |
|-------|---------------|
| 🛟 **Tubing** | Fun and forgiving; a little chop is fine, avoids rough water & strong wind |
| 🏄 **Wakeboarding** | Glassy water — best at dawn/dusk when wind drops |
| 🚤 **Speedboating** | Tolerates more wind and swell; only avoids genuinely rough seas |
| 🪽 **Hydrofoiling** | Flat, clean water and light wind |

Every hour shows the four requested variables:

- **Weather conditions** — sky/precip icon, air temperature, rain chance, wind & gusts
- **Wave conditions** — significant wave height (and period)
- **Current** — ocean current speed
- **Tide** — sea-level height relative to mean sea level

## 🌅 Sunset page

A per-day **beauty score** predicts how vivid each sunset will be, using cloud layers
(high/mid clouds catch the light, low clouds block it), horizon clarity, humidity, and
haze/aerosols. The best upcoming sunset is called out, and days above your threshold are
flagged as "alert-worthy."

### Sunset push notifications

Turn on **Settings → Sunset alerts** to get a push notification when an exceptionally
beautiful sunset is forecast (default: score ≥ 80, adjustable).

- **Works everywhere:** the app checks upcoming sunsets every time you open it and
  notifies you (once per sunset).
- **Background alerts (Android/Chromium):** when supported, the installed PWA also uses
  Periodic Background Sync to check twice a day and alert you without the app open.
- **iPhone:** add the app to your Home Screen first (Share → *Add to Home Screen*), then
  enable notifications. iOS only allows web notifications for installed PWAs.

> Fully server-pushed alerts (delivered even if you never open the app on iOS) would need
> a small backend with web-push/VAPID keys. This version uses the on-device options above
> so it stays a zero-cost static app with no server to run.

## Data

All forecast data comes from [Open-Meteo](https://open-meteo.com) — free, no API key:

- **Weather** (`api.open-meteo.com`) — hourly weather, wind, clouds, visibility, humidity, sunrise/sunset
- **Marine** (`marine-api.open-meteo.com`) — waves, ocean current, tide (sea-level height)
- **Air quality** (`air-quality-api.open-meteo.com`) — aerosols for the sunset model

Marine data is only available near coasts/large water bodies. On an inland lake the app
gracefully falls back to weather-, wind- and temperature-based scores and tells you so.

## Running it

It's a static site — no build step. Serve the folder over HTTP:

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

A service worker, geolocation and notifications all require a **secure context**
(`https://` or `localhost`).

### Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch**, pick the branch and
   `/ (root)`.
3. Open the `https://<user>.github.io/<repo>/` URL on your phone and *Add to Home Screen*.

## Swapping in the real logo

A placeholder logo lives at `assets/logo.svg` (and `assets/icon-maskable.svg` for the app
icon). Replace those files with the real Jeanty Tracker artwork — keep the same filenames
and everything (header, favicon, install icon, notifications) picks it up automatically.
PNG works too; if you use PNG, update the `<link rel="icon">` in `index.html` and the
`icons` entries in `manifest.webmanifest`.

## Project structure

```
index.html                 App shell, tab bar, modals
manifest.webmanifest       PWA manifest (installable)
sw.js                      Service worker: offline cache + background sunset check
css/styles.css             Nautical dark theme, mobile-first
js/
  app.js                   Controller: routing, state, modals, data loading
  api.js                   Open-Meteo fetching + normalization
  config.js                Sport definitions, thresholds, settings, unit formatting
  scoring.js               Per-hour sport suitability + daily roll-up
  sunset.js                Sunset beauty model
  notifications.js         Permission, alerts, SW config bridge
  weathercodes.js          WMO code → icon/label
  ui.js                    HTML rendering for pages
assets/                    Logo / icons (placeholder until real logo arrives)
```
