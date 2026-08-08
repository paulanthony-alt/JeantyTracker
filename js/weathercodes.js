// WMO weather interpretation codes -> emoji + short label.
// https://open-meteo.com/en/docs (weather_code)

const MAP = {
  0:  ['☀️', 'Clear'],
  1:  ['🌤️', 'Mostly clear'],
  2:  ['⛅', 'Partly cloudy'],
  3:  ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'],
  48: ['🌫️', 'Rime fog'],
  51: ['🌦️', 'Light drizzle'],
  53: ['🌦️', 'Drizzle'],
  55: ['🌧️', 'Heavy drizzle'],
  56: ['🌧️', 'Freezing drizzle'],
  57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'],
  63: ['🌧️', 'Rain'],
  65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'],
  67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'],
  73: ['🌨️', 'Snow'],
  75: ['❄️', 'Heavy snow'],
  77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Light showers'],
  81: ['🌧️', 'Showers'],
  82: ['⛈️', 'Violent showers'],
  85: ['🌨️', 'Snow showers'],
  86: ['🌨️', 'Snow showers'],
  95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Storm w/ hail'],
  99: ['⛈️', 'Storm w/ hail'],
};

export function weatherIcon(code, isDay = true) {
  const entry = MAP[code];
  if (!entry) return '🌡️';
  if ((code === 0 || code === 1) && !isDay) return code === 0 ? '🌙' : '🌛';
  return entry[0];
}

export function weatherText(code) {
  return MAP[code]?.[1] ?? '—';
}
