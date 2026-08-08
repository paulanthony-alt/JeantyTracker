// Suitability scoring for each watersport, plus daily roll-ups.

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

  const waveS = rampDown(hour.waveM, sport.wave.ideal, sport.wave.tolerable);
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
