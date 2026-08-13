// User sunset ratings — lets you score the sunset you actually saw and compare
// it to the model's prediction, building a calibration record per spot.

const KEY = 'jeanty.ratings.v1';

// 1–5 stars mapped onto the model's 0–100 scale (band midpoints) for comparison.
export const STAR_VALUE = { 1: 10, 2: 32, 3: 54, 4: 76, 5: 94 };
export const STAR_WORD = { 1: 'Flat', 2: 'Muted', 3: 'Pleasant', 4: 'Beautiful', 5: 'Spectacular' };

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function saveAll(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ }
}

export function getRating(locKey, date) {
  const all = loadAll();
  return all[locKey || 'default']?.[date] || null;
}

export function setRating(locKey, date, stars, modelScore) {
  const all = loadAll();
  const key = locKey || 'default';
  const bucket = all[key] || (all[key] = {});
  bucket[date] = {
    stars,
    userVal: STAR_VALUE[stars] ?? null,
    model: modelScore ?? null,
    ts: Date.now(),
  };
  saveAll(all);
  return bucket[date];
}

export function clearRating(locKey, date) {
  const all = loadAll();
  const bucket = all[locKey || 'default'];
  if (bucket && bucket[date]) { delete bucket[date]; saveAll(all); }
}

// Aggregate stats for a spot: count, mean model-vs-user bias, and recent entries.
export function ratingStats(locKey) {
  const bucket = loadAll()[locKey || 'default'] || {};
  const entries = Object.entries(bucket)
    .map(([date, v]) => ({ date, ...v }))
    .filter((e) => e.userVal != null && e.model != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const n = entries.length;
  const bias = n ? entries.reduce((s, e) => s + (e.model - e.userVal), 0) / n : null;
  const mae = n ? entries.reduce((s, e) => s + Math.abs(e.model - e.userVal), 0) / n : null;
  return { entries, n, bias, mae };
}
