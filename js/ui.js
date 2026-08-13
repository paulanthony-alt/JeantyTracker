// Pure-ish render functions that return HTML strings for the main view.

import { SPORTS, fmtTemp, fmtWind, fmtWave, fmtCurrent, fmtTide } from './config.js';
import { scoreHour, scoreClass, scoreLabel, groupByDay, summarizeDay,
  effectiveWaveM, boatWakeMetres } from './scoring.js';
import { sunsetForecast, sunsetClass, sunsetLabel, sunsetDesc, stableScore } from './sunset.js';
import { getRating, ratingStats, STAR_WORD } from './ratings.js';
import { weatherIcon, weatherText } from './weathercodes.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

function dow(date) { return date.toLocaleDateString([], { weekday: 'short' }); }
function dom(date) { return date.getDate(); }
function hourLabel(date) {
  return date.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s?([AP]M)/i, '');
}
function ampm(date) {
  const m = date.toLocaleTimeString([], { hour: 'numeric' }).match(/([AP]M)/i);
  return m ? m[1] : '';
}
function timeStr(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function isToday(dateKey) {
  return dateKey === new Date().toISOString().slice(0, 10);
}

export function loadingView(label = 'Loading conditions…') {
  return `<div class="loader"><div class="spinner"></div>${esc(label)}</div>`;
}

export function errorView(msg) {
  return `<div class="notice error-box"><b>Couldn't load data.</b><br>${esc(msg)}
    <br><br>Check your connection and try again, or pick a different location.</div>`;
}

export function noLocationView() {
  return `<div class="page-title"><span class="emoji">📍</span><h2>Set your spot</h2></div>
    <p class="page-sub">Jeanty Tracker needs a location to pull weather, waves, current and tide.</p>
    <button class="btn btn-primary" id="open-location">Choose location</button>`;
}

// ---------- Sport page ----------
export function sportView(dataset, sportKey, selectedDate) {
  const sport = SPORTS[sportKey];
  const byDay = groupByDay(dataset.hours);
  const dayKeys = [...byDay.keys()].slice(0, 7);
  const activeKey = selectedDate && byDay.has(selectedDate) ? selectedDate : dayKeys[0];
  const summaries = new Map(dayKeys.map((k) => [k, summarizeDay(byDay.get(k), sport)]));

  const chips = dayKeys.map((k) => {
    const hours = byDay.get(k);
    const d = hours[0].time;
    const sum = summaries.get(k);
    const cls = scoreClass(sum.dayScore);
    return `<button class="day-chip ${k === activeKey ? 'active' : ''}" data-day="${k}">
      <div class="dow">${isToday(k) ? 'Today' : esc(dow(d))}</div>
      <div class="dom">${dom(d)}</div>
      <div class="dscore badge ${cls}">${sum.dayScore ?? '–'}</div>
    </button>`;
  }).join('');

  const sum = summaries.get(activeKey);
  const activeHours = byDay.get(activeKey);
  const verdictCls = scoreClass(sum.dayScore);

  const bestHoursHtml = sum.bestHours.length
    ? `<div class="best-hours">🕑 Best window: <b>${sum.bestHours.map(timeStr).join(', ')}</b></div>`
    : `<div class="best-hours muted">No standout hours — check other days.</div>`;

  const marineNote = dataset.hasMarine
    ? `<div class="notice">🌊 Wave figures blend the marine forecast with an estimate of
        <b>boat-traffic wake</b> — busier midday and on weekends — because the forecast models
        can't see other boats' wakes. A 🚤 marks hours where wake is the main chop.</div>`
    : `<div class="notice">🌊 No open-water wave model here, so wave figures are estimated from
        <b>boat-traffic wake</b> and wind chop rather than reported as flat calm.
        Current and tide need a marine station and aren't available at this spot.</div>`;

  const rows = activeHours.map((h) => hourRow(h, sport)).join('');

  return `
    <div class="page-title"><span class="emoji">${sport.emoji}</span><h2>${esc(sport.name)}</h2></div>
    <p class="page-sub">${esc(sport.blurb)}</p>
    <div class="day-strip">${chips}</div>
    ${marineNote}
    <div class="summary">
      <div class="verdict">
        <div class="big ${verdictCls}">${sum.dayScore ?? '–'}</div>
        <div>
          <h3>${scoreLabel(sum.dayScore)} day for ${esc(sport.name.toLowerCase())}</h3>
          <p>${esc(dayHeadline(activeHours))}</p>
        </div>
      </div>
      ${bestHoursHtml}
    </div>
    <div class="section-h">Hour by hour</div>
    <div class="hours">${rows}</div>
    ${legend()}
  `;
}

function dayHeadline(hours) {
  const day = hours.filter((h) => h.isDay);
  const pool = day.length ? day : hours;
  const temps = pool.map((h) => h.temp).filter((v) => v != null);
  const winds = pool.map((h) => h.windKn).filter((v) => v != null);
  const bits = [];
  if (temps.length) {
    const hi = Math.max(...temps), lo = Math.min(...temps);
    bits.push(`${Math.round(lo)}–${Math.round(hi)}° air`);
  }
  if (winds.length) {
    bits.push(`wind to ${Math.round(Math.max(...winds) * 1.15078)} mph`);
  }
  return bits.join(' · ') || 'Conditions below.';
}

function hourRow(h, sport) {
  const score = scoreHour(h, sport);
  const cls = scoreClass(score);
  const units = window.__jeantyUnits || 'imperial';
  const borderColor = `var(--${cls.replace('score-', '') === 'good' ? 'good'
    : cls.replace('score-', '') === 'ok' ? 'ok'
    : cls.replace('score-', '') === 'mid' ? 'mid'
    : cls.replace('score-', '') === 'poor' ? 'poor' : 'bad'})`;

  const effWave = effectiveWaveM(h);
  const wake = boatWakeMetres(h);
  const wakeDominant = wake >= 0.10 && wake >= (h.waveM ?? 0);
  const waveTitle = wakeDominant ? 'Chop dominated by estimated boat wake' : 'Marine forecast + estimated boat wake';

  const metrics = [
    `<span class="m">💨 <b>${fmtWind(h.windKn, units)}</b></span>`,
    `<span class="m" title="${waveTitle}">🌊 <b>${fmtWave(effWave, units)}</b>${wakeDominant ? ' 🚤' : ''}</span>`,
    h.currentKn != null ? `<span class="m">🧭 <b>${fmtCurrent(h.currentKn, units)}</b></span>` : '',
    h.tideM != null ? `<span class="m">🌙 <b>${fmtTide(h.tideM, units)}</b></span>` : '',
    `<span class="m">🌡️ <b>${fmtTemp(h.temp, units)}</b></span>`,
    h.precipProb != null && h.precipProb > 5 ? `<span class="m">☔ <b>${h.precipProb}%</b></span>` : '',
  ].filter(Boolean).join('');

  return `<div class="hour-row ${h.isDay ? 'daylight' : 'night'}" style="border-left-color:${borderColor}">
    <div class="hour-time">${hourLabel(h.time)}<span class="ampm">${ampm(h.time)}</span></div>
    <div class="hour-ico" title="${esc(weatherText(h.weatherCode))}">${weatherIcon(h.weatherCode, h.isDay)}</div>
    <div class="hour-metrics">${metrics}</div>
    <div class="hour-score"><span class="badge ${cls}">${score ?? '–'}</span></div>
  </div>`;
}

function legend() {
  return `<div class="legend">
    <span><span class="dot" style="background:var(--good)"></span>Excellent</span>
    <span><span class="dot" style="background:var(--ok)"></span>Good</span>
    <span><span class="dot" style="background:var(--mid)"></span>Fair</span>
    <span><span class="dot" style="background:var(--poor)"></span>Poor</span>
    <span><span class="dot" style="background:var(--bad)"></span>Avoid</span>
    <span>💨 wind · 🌊 wave (incl. boat wake) · 🚤 wake-dominated · 🧭 current · 🌙 tide · 🌡️ air</span>
  </div>`;
}

// ---------- Sunset page ----------
export function sunsetView(dataset, threshold, locKey) {
  const todayKey = new Date().toISOString().slice(0, 10);
  // Apply the near-term score lock so tonight's/tomorrow's number stops drifting.
  const forecast = sunsetForecast(dataset).map((f) => {
    const { score, locked } = stableScore(locKey, f.date, f.sunsetDate, f.score);
    return { ...f, score, locked };
  });
  const cards = forecast.map((f) => sunsetCard(f, threshold, locKey, todayKey)).join('');

  const best = forecast.reduce((a, b) => (
    (b.score ?? -1) > (a?.score ?? -1) ? b : a
  ), null);

  const heroNote = best && best.score != null
    ? `<div class="notice"><b>Pick of the week:</b> ${esc(dayName(best.sunsetDate))} —
        ${sunsetLabel(best.score)} (${best.score}/100) at ${timeStr(best.sunsetDate)}.</div>`
    : '';

  const updated = updatedAgo(dataset.fetchedAt);

  return `
    <div class="page-title"><span class="emoji">🌅</span><h2>Sunsets</h2></div>
    <p class="page-sub">Beauty score from cloud layers, horizon clarity, humidity and haze.
      Turn on alerts in ⚙️ to get pinged for the best ones.</p>
    ${heroNote}
    ${cards}
    ${ratingLog(locKey)}
    <div class="legend">
      <span>Scores 0–100 · higher = more vivid colour likely</span>
      <span>🔒 locked (within 24h)${updated ? ` · Forecast updated ${updated}` : ''}</span>
    </div>
  `;
}

function ratingLog(locKey) {
  const { entries, n, bias, mae } = ratingStats(locKey);
  if (!n) {
    return `<div class="notice">⭐ <b>Rate your sunsets.</b> After you've seen tonight's sunset,
      tap the stars on its card. Your ratings are compared to the model here so it can be tuned to
      what you actually see.</div>`;
  }
  const dir = bias > 3 ? `rates about <b>${Math.round(bias)} pts higher</b> than you`
    : bias < -3 ? `rates about <b>${Math.round(-bias)} pts lower</b> than you`
    : `is <b>well matched</b> to your ratings`;
  const rows = entries.slice(0, 8).map((e) => `
    <div class="log-row">
      <span class="log-date">${esc(shortDate(e.date))}</span>
      <span class="log-stars">${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</span>
      <span class="log-cmp">you ${e.userVal} · model ${e.model}</span>
    </div>`).join('');
  return `
    <div class="section-h">Your sunset log</div>
    <div class="summary">
      <div class="best-hours">Over ${n} rated sunset${n > 1 ? 's' : ''}, the model ${dir}
        (avg miss ${Math.round(mae)} pts).</div>
      <div class="log-list">${rows}</div>
    </div>`;
}

function shortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function updatedAgo(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

function dayName(date) {
  const key = date.toISOString().slice(0, 10);
  if (isToday(key)) return 'Today';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function sunsetCard(f, threshold, locKey, todayKey) {
  const cls = sunsetClass(f.score);
  const hot = f.score != null && f.score >= threshold;
  const pct = f.score ?? 0;
  const ring = `conic-gradient(var(--accent-2) ${pct * 3.6}deg, var(--border) 0deg)`;

  const rating = getRating(locKey, f.date);
  // You can only rate a sunset you've seen: today or earlier.
  const canRate = f.date <= todayKey;
  const rateRow = ratingRow(f, rating, canRate);

  return `<div class="sunset-day ${hot ? 'hot' : ''}">
    <div class="sunset-meter" style="border-radius:50%;background:${ring};display:flex;align-items:center;justify-content:center">
      <div style="width:44px;height:44px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-weight:800">
        ${f.score ?? '–'}
      </div>
    </div>
    <div class="sunset-info">
      <h3>${esc(dayName(f.sunsetDate))}${f.locked ? ' <span title="Locked in — within 24h" style="font-size:0.8rem">🔒</span>' : ''}</h3>
      <div class="time">${timeStr(f.sunsetDate)}</div>
      <div class="desc"><b>${sunsetLabel(f.score)}.</b> ${esc(sunsetDesc(f.score, f.hour))}</div>
      ${hot ? '<span class="sunset-tag">🔔 Alert-worthy</span>' : ''}
      ${rateRow}
    </div>
  </div>`;
}

function ratingRow(f, rating, canRate) {
  if (!canRate && !rating) {
    return `<div class="rate-row muted small">⭐ Rate it after sunset</div>`;
  }
  const stars = [1, 2, 3, 4, 5].map((s) => {
    const on = rating && s <= rating.stars;
    return `<button type="button" class="star ${on ? 'on' : ''}" data-rate-date="${f.date}"
      data-star="${s}" data-model="${f.score ?? ''}" aria-label="${s} star${s > 1 ? 's' : ''}">★</button>`;
  }).join('');
  const meta = rating
    ? `<span class="rate-meta">You: ${esc(STAR_WORD[rating.stars])} · model ${rating.model ?? '–'}</span>`
    : `<span class="rate-meta muted">Tap to rate what you saw</span>`;
  return `<div class="rate-row">${stars}${meta}</div>`;
}
