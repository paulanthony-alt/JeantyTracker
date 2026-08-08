// Sunset "beauty" model.
//
// Vivid sunsets need high & mid clouds to catch and scatter the low-angle light,
// a clear path to the horizon (few low clouds, decent visibility, not too humid),
// and a touch of haze/aerosol adds colour — but too much just greys everything out.
// This is a heuristic scorer inspired by SunsetWx-style forecasting, tuned to the
// data Open-Meteo provides.

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
 */
export function sunsetScoreForHour(h) {
  if (!h) return null;

  // High cloud (cirrus) is the star — best around 25–65% coverage.
  const high = band(h.cloudHigh, 5, 25, 65, 100);          // 0..1
  // Mid cloud helps too, but less, and saturates lower.
  const mid = band(h.cloudMid, 5, 20, 55, 95);
  // Low cloud is the enemy — blocks the horizon light.
  const lowPenalty = h.cloudLow != null ? clamp01(1 - h.cloudLow / 70) : 0.7;
  // Humidity: drier air = cleaner, more saturated colour.
  const humidity = h.humidity != null ? clamp01(1 - (h.humidity - 40) / 55) : 0.6;
  // Visibility (metres) toward the horizon; 20km+ is excellent.
  const vis = h.visibility != null ? clamp01(h.visibility / 20000) : 0.7;
  // Aerosol optical depth: a little adds fiery colour, a lot means haze/smog.
  const aod = h.aod != null ? band(h.aod, 0, 0.12, 0.28, 0.8) : 0.5;
  // Rain kills it.
  const dry = h.precip != null ? clamp01(1 - h.precip / 1.5) : 1;

  // Weighted blend. Cloud structure dominates; horizon clarity gates it.
  const cloudStructure = 0.62 * high + 0.38 * mid;         // 0..1
  const clarity = 0.45 * lowPenalty + 0.25 * vis + 0.30 * humidity;

  let score = (0.55 * cloudStructure + 0.30 * clarity + 0.15 * aod);
  score *= (0.6 + 0.4 * lowPenalty);   // extra emphasis: low cloud really hurts
  score *= dry;

  // A totally clear sky is a pleasant-but-plain sunset, not a spectacular one —
  // give it a modest floor so clear evenings don't read as "0".
  if ((h.cloudHigh ?? 0) < 8 && (h.cloudMid ?? 0) < 8 && (h.cloudLow ?? 0) < 20) {
    score = Math.max(score, 0.42 * humidity);
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
  if (score >= 80) return 'High clouds catching the light with a clear horizon — worth stopping the boat for.';
  if (score >= 65) return 'Good colour likely; some clouds to light up without blocking the sun.';
  if (score >= 45) {
    if (low != null && low > 60) return 'Low cloud near the horizon may mute the colour.';
    return 'A decent but understated sunset.';
  }
  if (high != null && high < 8) return 'Mostly clear — a soft glow rather than fireworks.';
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
  // Only trust it if within ~90 minutes of the sunset.
  return bestDiff <= 90 * 60 * 1000 ? best : best;
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
