// Central config: sports, scoring parameters, unit helpers, persisted settings.

// Saved harbors / spots for the quick switcher in the header.
// Coordinates are approximate — tweak lat/lon here to fine-tune any spot.
// `traffic` (0..1) is how busy the spot gets with boats, feeding the boat-wake
// estimate that's added to the raw marine wave forecast.
export const DEFAULT_TRAFFIC = 0.6;
export const PRESET_SPOTS = [
  { id: 'byram',    name: 'Byram Harbor',         lat: 41.0010, lon: -73.6570, traffic: 0.80 },
  { id: 'coscob',   name: 'Cos Cob Harbor',       lat: 41.0250, lon: -73.5980, traffic: 0.85 },
  { id: 'oldgwich', name: 'Old Greenwich Harbor', lat: 41.0300, lon: -73.5670, traffic: 0.70 },
  { id: 'sound',    name: 'Out on the Sound',     lat: 40.9550, lon: -73.6000, traffic: 0.40 },
];

export const SPORTS = {
  tubing: {
    key: 'tubing',
    name: 'Tubing',
    emoji: '🛟',
    blurb: 'Fun and forgiving — a little chop is fine, just avoid rough water and strong wind.',
    // Ideal / tolerable thresholds. Values in metric base units:
    //   wind: knots, wave: metres, current: knots
    wind:    { ideal: 8,  tolerable: 16 },
    wave:    { ideal: 0.35, tolerable: 0.8 },
    current: { ideal: 1.2, tolerable: 3.0 },
    weights: { wind: 0.32, wave: 0.34, current: 0.14, temp: 0.20 },
  },
  wakeboarding: {
    key: 'wakeboarding',
    name: 'Wakeboarding',
    emoji: '🏄',
    blurb: 'Wants glassy water. Best at dawn and dusk when wind drops and the surface goes flat.',
    wind:    { ideal: 5,  tolerable: 11 },
    wave:    { ideal: 0.15, tolerable: 0.45 },
    current: { ideal: 1.0, tolerable: 2.5 },
    weights: { wind: 0.38, wave: 0.40, current: 0.10, temp: 0.12 },
  },
  speedboating: {
    key: 'speedboating',
    name: 'Speedboating',
    emoji: '🚤',
    blurb: 'Cruising tolerates more wind and swell — mostly avoid genuinely rough seas.',
    wind:    { ideal: 12, tolerable: 22 },
    wave:    { ideal: 0.6, tolerable: 1.4 },
    current: { ideal: 2.0, tolerable: 4.0 },
    weights: { wind: 0.30, wave: 0.34, current: 0.16, temp: 0.20 },
  },
  hydrofoiling: {
    key: 'hydrofoiling',
    name: 'Hydrofoiling',
    emoji: '🪽',
    blurb: 'Loves flat, clean water and light wind so the foil stays smooth and predictable.',
    wind:    { ideal: 6,  tolerable: 13 },
    wave:    { ideal: 0.2, tolerable: 0.5 },
    current: { ideal: 1.2, tolerable: 2.8 },
    weights: { wind: 0.34, wave: 0.40, current: 0.14, temp: 0.12 },
  },
};

export const SPORT_ORDER = ['tubing', 'wakeboarding', 'speedboating', 'hydrofoiling'];

// ---------- Settings (persisted) ----------
const LS_KEY = 'jeanty.settings.v1';

const DEFAULTS = {
  location: null,               // { lat, lon, label }
  units: 'imperial',            // 'imperial' | 'metric'
  notifyEnabled: false,
  sunsetThreshold: 80,
  lastNotifiedDate: null,       // ISO date string of last sunset alert
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ---------- Unit conversion & formatting ----------
export function fmtTemp(celsius, units) {
  if (celsius == null) return '–';
  return units === 'imperial'
    ? `${Math.round(celsius * 9 / 5 + 32)}°`
    : `${Math.round(celsius)}°`;
}

// Wind is always fetched in knots (nautical). Display in mph (imperial) or km/h (metric).
export function fmtWind(knots, units) {
  if (knots == null) return '–';
  return units === 'imperial'
    ? `${Math.round(knots * 1.15078)} mph`
    : `${Math.round(knots * 1.852)} km/h`;
}

export function fmtWave(metres, units) {
  if (metres == null) return '–';
  return units === 'imperial'
    ? `${(metres * 3.28084).toFixed(1)} ft`
    : `${metres.toFixed(2)} m`;
}

export function fmtCurrent(knots, units) {
  if (knots == null) return '–';
  return units === 'imperial'
    ? `${(knots * 1.15078).toFixed(1)} mph`
    : `${knots.toFixed(1)} kn`;
}

// Tide height (metres relative to MSL) -> ft or m with sign.
export function fmtTide(metres, units) {
  if (metres == null) return '–';
  const v = units === 'imperial' ? metres * 3.28084 : metres;
  const unit = units === 'imperial' ? 'ft' : 'm';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)} ${unit}`;
}
