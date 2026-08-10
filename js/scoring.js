// Suitability scoring for each watersport, plus daily roll-ups.

// ---------- Boat-traffic wake model ----------
// The marine forecast only models open-water swell + wind-waves; it can't see
// other boats. In a busy harbor on a calm afternoon the real chop is almost all
// boat wake, so a reported 0.1 ft is meaningless. We estimate an "effective"
// significant chop by adding a wake term driven by time of day, day of week,
// how busy the spot is, and whether the weather keeps boats home.

// Per-location busyness (0..1). Set from the active spot; falls back to medium.
let currentTraffic = 0.6;
export function setTraffic(t) {
  if (typeof t === 'number' && !Number.isNaN(t)) currentTraffic = Math.max(0, Math.min(1, t));
}

// Estimated boat-wake chop for an hour, in metres (significant-height equivalent).
export function boatWakeMetres(hour, traffic = currentTraffic) {
  const d = hour.time;
  if (!(d instanceof Date) || Number.isNaN(d)) return 0;

  const h = d.getHours() + d.getMinutes() / 60;
  const dow = d.getDay(); // 0 Sun … 6 Sat

  // Time-of-day activity: near zero overnight, ramps up through the morning,
  // peaks mid-afternoon (~2:30pm), tapers toward dusk.
  let tod;
  if (h < 6 || h > 21) {
    tod = 0.03;
  } else {
    tod = Math.exp(-Math.pow((h - 14.5) / 4.2, 2)); // gaussian peak at 14.5
    tod = Math.max(tod, 0.08);                       // daytime floor
  }
  if (hour.isDay === false) tod *= 0.3;              // little traffic after dark

  // Day of week: weekends busiest, Friday elevated, midweek quieter.
  const dowFactor = (dow === 0 || dow === 6) ? 1.0 : (dow === 5 ? 0.8 : 0.55);

  // Bad weather keeps boats on the trailer.
  let weather = 1;
  if (hour.precip != null && hour.precip > 0) weather *= Math.max(0.15, 1 - hour.precip / 2);
  if (hour.windKn != null && hour.windKn > 15) {
    weather *= Math.max(0.3, 1 - (hour.windKn - 15) / 20);
  }

  // Peak-traffic amplitude (~1.1 ft sig. chop in a busy harbor at full tilt).
  const BASE = 0.34;
  return BASE * traffic * tod * dowFactor * weather;
}

// Effective wave/chop for scoring & display, in metres: the marine model
// combined (in energy) with estimated boat wake. When no marine model is
// available (inland/enclosed water) we substitute a light wind-chop estimate so
// it isn't reported as glass.
export function effectiveWaveM(hour, traffic = currentTraffic) {
  let base = hour.waveM;
  if (base == null) {
    const wind = hour.windKn ?? 0;
    base = Math.max(0, wind - 5) * 0.006; // gentle local wind chop
  }
  const wake = boatWakeMetres(hour, traffic);
  return Math.sqrt(base * base + wake * wake);
}

// Map a value to 0..1: full score at/below `ideal`, linearly down to 0 at `tolerable`.
function rampDown(value, ideal, tolerable) {
  if (value == null) return null;
  if (value <= ideal) return 1;
  if (value >= tolerable) return 0;
  return 1 - (value - ideal) / (tolerable - ideal);
}

// Comfort curve for air temperature (°C). Peaks in the mid-20s to low-30s.
function tempScore(c) {
  if (c == null) return null;
  if (c >= 24 && c <= 32) return 1;
  if (c < 24) return Math.max(0, (c - 8) / (24 - 8));   // 0 at 8°C
  return Math.max(0, 1 - (c - 32) / (42 - 32));         // 0 at 42°C
}

/**
 * Score one hour for a sport. Returns 0..100 (or null if not scorable).
 * Marine components (wave/current) are skipped and their weight redistributed
 * when marine data is unavailable (e.g. inland lakes).
 */
export function scoreHour(hour, sport) {
  const parts = [];
  const w = sport.weights;

  const windS = rampDown(hour.windKn, sport.wind.ideal, sport.wind.tolerable);
  if (windS != null) parts.push([windS, w.wind]);

  // Effective chop includes estimated boat wake, so it's always scorable.
  const waveS = rampDown(effectiveWaveM(hour), sport.wave.ideal, sport.wave.tolerable);
  if (waveS != null) parts.push([waveS, w.wave]);

  const curS = rampDown(hour.currentKn, sport.current.ideal, sport.current.tolerable);
  if (curS != null) parts.push([curS, w.current]);

  const tS = tempScore(hour.temp);
  if (tS != null) parts.push([tS, w.temp]);

  if (!parts.length) return null;

  const totalW = parts.reduce((a, [, weight]) => a + weight, 0);
  let score = parts.reduce((a, [s, weight]) => a + s * weight, 0) / totalW;

  // Precipitation penalty (mm in the hour).
  if (hour.precip != null && hour.precip > 0) {
    score *= Math.max(0.25, 1 - hour.precip / 4);
  }
  // Gust penalty when gusts blow well past the tolerable steady wind.
  if (hour.gustKn != null && hour.gustKn > sport.wind.tolerable) {
    score *= Math.max(0.5, 1 - (hour.gustKn - sport.wind.tolerable) / sport.wind.tolerable);
  }

  return Math.round(clamp01(score) * 100);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

export function scoreClass(score) {
  if (score == null) return 'score-mid';
  if (score >= 80) return 'score-good';
  if (score >= 65) return 'score-ok';
  if (score >= 45) return 'score-mid';
  if (score >= 25) return 'score-poor';
  return 'score-bad';
}

export function scoreLabel(score) {
  if (score == null) return 'No data';
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 45) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Not recommended';
}

// Group dataset hours by local calendar date (YYYY-MM-DD).
export function groupByDay(hours) {
  const map = new Map();
  for (const h of hours) {
    const key = h.iso.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(h);
  }
  return map;
}

/**
 * Daily summary for a sport: score each daylight hour, take the best window.
 * Returns { date, dayScore, bestHours:[Date], scoredHours:[{hour,score}] }.
 */
export function summarizeDay(dayHours, sport) {
  const scored = dayHours.map((h) => ({ hour: h, score: scoreHour(h, sport) }));
  const daylight = scored.filter((s) => s.hour.isDay && s.score != null);
  const pool = daylight.length ? daylight : scored.filter((s) => s.score != null);

  if (!pool.length) return { dayScore: null, bestHours: [], scoredHours: scored };

  // Day score = average of the best 3 daylight hours (the realistic outing window).
  const top = [...pool].sort((a, b) => b.score - a.score).slice(0, 3);
  const dayScore = Math.round(top.reduce((a, s) => a + s.score, 0) / top.length);

  const bestHours = top
    .filter((s) => s.score >= Math.max(60, dayScore - 8))
    .map((s) => s.hour.time)
    .sort((a, b) => a - b);

  return { dayScore, bestHours, scoredHours: scored };
}
