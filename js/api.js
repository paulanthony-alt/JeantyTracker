// Data layer — Open-Meteo (free, no API key required).
// Weather + Marine + Air-quality merged into one normalized hourly dataset.

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL  = 'https://marine-api.open-meteo.com/v1/marine';
const AIR_URL     = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_URL     = 'https://geocoding-api.open-meteo.com/v1/search';

const FORECAST_DAYS = 7;
const CACHE_TTL_MS = 15 * 60 * 1000;

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function geocode(query) {
  const url = `${GEO_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const data = await getJSON(url);
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
  }));
}

export async function reverseLabel(lat, lon) {
  // Best-effort friendly name for a coordinate.
  try {
    const url = `${GEO_URL}?name=&latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`;
    const data = await getJSON(url);
    if (data.results && data.results[0]) {
      const r = data.results[0];
      return [r.name, r.admin1].filter(Boolean).join(', ');
    }
  } catch { /* ignore */ }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function toDate(str) {
  // Open-Meteo returns local wall-clock ISO like "2026-08-08T18:30". Treat as local.
  return new Date(str);
}

function buildIndex(times) {
  const idx = new Map();
  (times || []).forEach((t, i) => idx.set(t, i));
  return idx;
}

export async function fetchConditions(lat, lon) {
  const cacheKey = `jeanty.data.${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return reviveDataset(cached.data);
    }
  } catch { /* ignore */ }

  const weatherUrl = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}` +
    '&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,' +
    'weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,cloud_cover_low,' +
    'cloud_cover_mid,cloud_cover_high,visibility,relative_humidity_2m,is_day' +
    '&daily=sunrise,sunset&wind_speed_unit=kn&timezone=auto' +
    `&forecast_days=${FORECAST_DAYS}`;

  const marineUrl = `${MARINE_URL}?latitude=${lat}&longitude=${lon}` +
    '&hourly=wave_height,wave_direction,wave_period,ocean_current_velocity,' +
    'ocean_current_direction,sea_level_height_msl&timezone=auto' +
    `&forecast_days=${FORECAST_DAYS}`;

  const airUrl = `${AIR_URL}?latitude=${lat}&longitude=${lon}` +
    `&hourly=aerosol_optical_depth&timezone=auto&forecast_days=${Math.min(FORECAST_DAYS, 7)}`;

  // Weather is required; marine + air are best-effort (may be unavailable inland).
  const [weather, marine, air] = await Promise.all([
    getJSON(weatherUrl),
    getJSON(marineUrl).catch(() => null),
    getJSON(airUrl).catch(() => null),
  ]);

  const wh = weather.hourly;
  const marineIdx = marine?.hourly ? buildIndex(marine.hourly.time) : null;
  const airIdx = air?.hourly ? buildIndex(air.hourly.time) : null;
  const hasMarine = !!(marine?.hourly && marine.hourly.wave_height &&
    marine.hourly.wave_height.some((v) => v != null));

  const hours = wh.time.map((t, i) => {
    const mi = marineIdx?.has(t) ? marineIdx.get(t) : null;
    const ai = airIdx?.has(t) ? airIdx.get(t) : null;
    const m = marine?.hourly;
    const currKmh = mi != null ? m.ocean_current_velocity?.[mi] : null;
    return {
      iso: t,
      temp: wh.temperature_2m?.[i] ?? null,
      apparentTemp: wh.apparent_temperature?.[i] ?? null,
      precip: wh.precipitation?.[i] ?? null,
      precipProb: wh.precipitation_probability?.[i] ?? null,
      weatherCode: wh.weather_code?.[i] ?? null,
      windKn: wh.wind_speed_10m?.[i] ?? null,
      gustKn: wh.wind_gusts_10m?.[i] ?? null,
      windDir: wh.wind_direction_10m?.[i] ?? null,
      cloud: wh.cloud_cover?.[i] ?? null,
      cloudLow: wh.cloud_cover_low?.[i] ?? null,
      cloudMid: wh.cloud_cover_mid?.[i] ?? null,
      cloudHigh: wh.cloud_cover_high?.[i] ?? null,
      visibility: wh.visibility?.[i] ?? null,
      humidity: wh.relative_humidity_2m?.[i] ?? null,
      isDay: wh.is_day?.[i] === 1,
      waveM: mi != null ? (m.wave_height?.[mi] ?? null) : null,
      wavePeriod: mi != null ? (m.wave_period?.[mi] ?? null) : null,
      waveDir: mi != null ? (m.wave_direction?.[mi] ?? null) : null,
      currentKn: currKmh != null ? currKmh / 1.852 : null,
      currentDir: mi != null ? (m.ocean_current_direction?.[mi] ?? null) : null,
      tideM: mi != null ? (m.sea_level_height_msl?.[mi] ?? null) : null,
      aod: ai != null ? (air.hourly.aerosol_optical_depth?.[ai] ?? null) : null,
    };
  });

  const days = (weather.daily?.time || []).map((d, i) => ({
    date: d,
    sunrise: weather.daily.sunrise?.[i] ?? null,
    sunset: weather.daily.sunset?.[i] ?? null,
  }));

  const dataset = {
    lat, lon,
    timezone: weather.timezone,
    hours,
    days,
    hasMarine,
    fetchedAt: new Date().toISOString(),
  };

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: dataset }));
  } catch { /* ignore */ }

  return reviveDataset(dataset);
}

function reviveDataset(d) {
  // Attach Date objects (they don't survive JSON round-trips).
  d.hours.forEach((h) => { h.time = toDate(h.iso); });
  d.days.forEach((day) => {
    day.sunriseDate = day.sunrise ? toDate(day.sunrise) : null;
    day.sunsetDate = day.sunset ? toDate(day.sunset) : null;
  });
  return d;
}
