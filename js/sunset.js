// Sunset "beauty" model.
//
// Vivid sunsets need high & mid clouds to catch the low-angle light AND clean,
// clear air for the colour to actually show. The earlier model over-rewarded
// cloud cover, so a bright hazy/milky veil (lots of high cloud, humid, hazy air)
// could score high even though it washes out to flat grey-pink in reality.
//
// This version treats cloud as the "canvas" and air clarity as a hard gate:
// no matter how much cloud is present, hazy/humid/low-visibility air caps the
// score. That pulls washed-out skies down where they belong while keeping
// clean cirrus-over-a-sharp-horizon evenings high.
//
// IMPORTANT: sunsetScoreForHour is duplicated verbatim in sw.js so background
// notifications match the in-app number. test/sunset-parity.mjs asserts they
// stay identical — update both together.

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// A "sweet spot" curve: 0 below `lo`, ramps to 1 across [lo, hiIdeal],
// stays 1 until `hiFull`, then ramps back down to 0 at `max`.
function band(v, lo, hiIdeal, hiFull, max) {
  if (v == null) return 0.5;
  if (v <= lo) return 0;
  if (v < hiIdeal) return (v - lo) / (hiIdeal - lo);
  if (v <= hiFull) return 1;
  if (v >= max) return 0;
  return 1 - (v - hiFull) / (max - hiFull);
}

/**
 * Score a single hour's atmospheric state for sunset beauty (0..100).
 * Keep in sync with sw.js `sunsetScore`.
 */
export function sunsetScoreForHour(h) {
  if (!h) return null;

  // --- Canvas: high & mid cloud to catch the light ---
  const high = band(h.cloudHigh, 5, 20, 55, 95);
  const mid = band(h.cloudMid, 5, 15, 45, 85);
  const canvas = 0.65 * high + 0.35 * mid;                     // 0..1

  // --- Air clarity: this GATES how much colour can show ---
  // Drier air = cleaner, more saturated colour. Steep: washed out by ~85% RH.
  const humidityClear = h.humidity != null ? clamp01((85 - h.humidity) / 45) : 0.55;
  // Visibility toward the horizon: poor below 8 km, excellent at 25 km+.
  const vis = h.visibility != null ? clamp01((h.visibility - 8000) / 17000) : 0.6;
  // Low cloud blocks the horizon light.
  const lowClear = h.cloudLow != null ? clamp01(1 - h.cloudLow / 60) : 0.7;
  // Aerosol optical depth: a little deepens colour, a lot means haze/smog.
  const aodClean = h.aod != null ? clamp01(1 - (h.aod - 0.15) / 0.45) : 0.7;
  const aodColour = h.aod != null ? band(h.aod, 0, 0.05, 0.15, 0.5) : 0.4;

  const clarity = clamp01(0.5 * humidityClear + 0.3 * vis + 0.2 * lowClear);
  const dry = h.precip != null ? clamp01(1 - h.precip / 1.5) : 1;

  // You need canvas AND clarity — multiply so a hazy sky can't score high
  // however much cloud there is.
  let score = canvas * (0.30 + 0.70 * clarity);
  score += 0.12 * aodColour * clarity;               // small colour boost when clean

  // Haze ceiling: the murkiest of {humidity, visibility, aerosol} caps the max.
  const hazeCap = 0.30 + 0.70 * Math.min(humidityClear, vis, aodClean);
  score = Math.min(score, hazeCap);

  score *= dry;
  score *= (0.55 + 0.45 * lowClear);                 // extra emphasis: low cloud hurts

  // A clear, dry sky is a pleasant-but-plain sunset — modest floor, still
  // capped by haze so a milky clear sky doesn't read high.
  if ((h.cloudHigh ?? 0) < 8 && (h.cloudMid ?? 0) < 8 && (h.cloudLow ?? 0) < 20) {
    score = Math.max(score, 0.34 * humidityClear);
    score = Math.min(score, hazeCap);
  }

  return Math.round(clamp01(score) * 100);
}

export function sunsetClass(score) {
  if (score == null) return 'score-mid';
  if (score >= 80) return 'score-good';
  if (score >= 65) return 'score-ok';
  if (score >= 45) return 'score-mid';
  return 'score-poor';
}

export function sunsetLabel(score) {
  if (score == null) return 'Unknown';
  if (score >= 88) return 'Spectacular';
  if (score >= 80) return 'Stunning';
  if (score >= 65) return 'Beautiful';
  if (score >= 50) return 'Pleasant';
  if (score >= 35) return 'Muted';
  return 'Flat';
}

export function sunsetDesc(score, hour) {
  if (score == null) return 'Not enough data.';
  const low = hour?.cloudLow ?? null;
  const high = hour?.cloudHigh ?? null;
  const hum = hour?.humidity ?? null;
  const visM = hour?.visibility ?? null;
  const hazy = (hum != null && hum > 75) || (visM != null && visM < 12000);

  if (score >= 80) return 'High clouds catching the light over a clean, sharp horizon — worth stopping the boat for.';
  if (score >= 65) return 'Good colour likely; clouds to light up with clear enough air to show it.';
  if (score >= 50) {
    if (hazy) return 'Some colour, but hazy/humid air will soften and mute it.';
    if (low != null && low > 60) return 'Low cloud near the horizon may block the best colour.';
    return 'A decent, understated sunset.';
  }
  if (score >= 35) {
    if (hazy) return 'Hazy, milky air likely to wash the colour out to a flat glow.';
    if (high != null && high < 8) return 'Mostly clear — a soft glow rather than fireworks.';
    return 'Muted; not much for the sky to work with.';
  }
  if (hazy) return 'Thick haze or humidity likely to grey it out.';
  return 'Thick or low cloud likely to grey out the sunset.';
}

/**
 * Pick the atmospheric snapshot closest to a day's sunset time.
 */
export function hourNearest(hours, targetDate) {
  if (!targetDate) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const h of hours) {
    const diff = Math.abs(h.time - targetDate);
    if (diff < bestDiff) { bestDiff = diff; best = h; }
  }
  return best;
}

/**
 * Build per-day sunset forecasts from a dataset.
 * Returns [{ date, sunsetDate, score, hour }].
 */
export function sunsetForecast(dataset) {
  return dataset.days
    .filter((d) => d.sunsetDate)
    .map((d) => {
      const hour = hourNearest(dataset.hours, d.sunsetDate);
      return {
        date: d.date,
        sunsetDate: d.sunsetDate,
        sunriseDate: d.sunriseDate,
        score: sunsetScoreForHour(hour),
        hour,
      };
    });
}

// ---------- Near-term score lock (stability) ----------
// Once a sunset is within ~24h its forecast is reliable, so freeze the first
// score we showed for it — small model wobble shouldn't keep nudging the number
// for tonight's sunset. Scores further out still move as the forecast updates.
const LOCK_KEY = 'jeanty.sunsetlocks.v1';

function loadLocks() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); } catch { return {}; }
}
function saveLocks(o) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(o)); } catch { /* ignore */ }
}

/**
 * Return a display score that's frozen once the sunset is within 24 hours.
 * `locKey` scopes locks per spot so harbors don't collide.
 * Returns { score, locked }.
 */
export function stableScore(locKey, date, sunsetDate, liveScore) {
  if (liveScore == null || !sunsetDate) return { score: liveScore, locked: false };
  const ms = sunsetDate.getTime() - Date.now();
  const within = ms <= 24 * 3600 * 1000 && ms > -6 * 3600 * 1000; // up to 6h after sunset
  if (!within) return { score: liveScore, locked: false };

  const all = loadLocks();
  const key = locKey || 'default';
  const bucket = all[key] || {};

  if (bucket[date] != null) return { score: bucket[date], locked: true };

  bucket[date] = liveScore;
  // Prune dates older than 2 days.
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  for (const d of Object.keys(bucket)) if (d < cutoff) delete bucket[d];
  all[key] = bucket;
  saveLocks(all);
  return { score: liveScore, locked: true };
}
