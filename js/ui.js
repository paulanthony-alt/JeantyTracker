// Pure-ish render functions that return HTML strings for the main view.

import { SPORTS, fmtTemp, fmtWind, fmtWave, fmtCurrent, fmtTide } from './config.js';
import { scoreHour, scoreClass, scoreLabel, groupByDay, summarizeDay } from './scoring.js';
import { sunsetForecast, sunsetClass, sunsetLabel, sunsetDesc } from './sunset.js';
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

  const marineNote = dataset.hasMarine ? '' :
    `<div class="notice">No marine (wave/current/tide) data for this spot — it looks inland.
     Scores use weather, wind and temperature only.</div>`;

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

  const metrics = [
    `<span class="m">💨 <b>${fmtWind(h.windKn, units)}</b></span>`,
    h.waveM != null ? `<span class="m">🌊 <b>${fmtWave(h.waveM, units)}</b></span>` : '',
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
    <span>💨 wind · 🌊 wave · 🧭 current · 🌙 tide · 🌡️ air</span>
  </div>`;
}

// ---------- Sunset page ----------
export function sunsetView(dataset, threshold) {
  const forecast = sunsetForecast(dataset);
  const cards = forecast.map((f) => sunsetCard(f, threshold)).join('');

  const best = forecast.reduce((a, b) => (
    (b.score ?? -1) > (a?.score ?? -1) ? b : a
  ), null);

  const heroNote = best && best.score != null
    ? `<div class="notice"><b>Pick of the week:</b> ${esc(dayName(best.sunsetDate))} —
        ${sunsetLabel(best.score)} (${best.score}/100) at ${timeStr(best.sunsetDate)}.</div>`
    : '';

  const marineNote = '';

  return `
    <div class="page-title"><span class="emoji">🌅</span><h2>Sunsets</h2></div>
    <p class="page-sub">Beauty score from cloud layers, horizon clarity, humidity and haze.
      Turn on alerts in ⚙️ to get pinged for the best ones.</p>
    ${heroNote}
    ${marineNote}
    ${cards}
    <div class="legend"><span>Scores 0–100 · higher = more vivid colour likely</span></div>
  `;
}

function dayName(date) {
  const key = date.toISOString().slice(0, 10);
  if (isToday(key)) return 'Today';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function sunsetCard(f, threshold) {
  const cls = sunsetClass(f.score);
  const hot = f.score != null && f.score >= threshold;
  const pct = f.score ?? 0;
  const ring = `conic-gradient(var(--accent-2) ${pct * 3.6}deg, var(--border) 0deg)`;

  return `<div class="sunset-day ${hot ? 'hot' : ''}">
    <div class="sunset-meter" style="border-radius:50%;background:${ring};display:flex;align-items:center;justify-content:center">
      <div style="width:44px;height:44px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-weight:800">
        ${f.score ?? '–'}
      </div>
    </div>
    <div class="sunset-info">
      <h3>${esc(dayName(f.sunsetDate))}</h3>
      <div class="time">${timeStr(f.sunsetDate)}</div>
      <div class="desc"><b>${sunsetLabel(f.score)}.</b> ${esc(sunsetDesc(f.score, f.hour))}</div>
      ${hot ? '<span class="sunset-tag">🔔 Alert-worthy</span>' : ''}
    </div>
  </div>`;
}
