'use strict';
// Today's weather from Open-Meteo (free, no API key). Returns the shape the dashboard's `weather` object uses:
// hi/lo/feels/humidity/wind plus 24 hourly values for temperature, icon and chance of rain.
const tune = require('./tune');
const ttlMs = () => tune.get('weatherMin') * 60 * 1000;   // /admin > Settings > Refresh rates
let cache = null;

function icon(code, isDay) {
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code === 1 || code === 2) return isDay ? 'partly' : 'moon';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloud'; // no snow icon in the dashboard
  return 'cloud';
}

async function getWeather(cfg) {
  const w = cfg.weather;
  if (!w || typeof w.lat !== 'number' || typeof w.lon !== 'number') return null;
  if (cache && Date.now() - cache.at < ttlMs()) return cache.data;
  const f = w.units === 'f';
  const q = new URLSearchParams({
    latitude: String(w.lat), longitude: String(w.lon), timezone: cfg.timezone, forecast_days: '8', past_days: '1',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,uv_index_max,sunrise,sunset',
    current: 'apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m',
    temperature_unit: f ? 'fahrenheit' : 'celsius', wind_speed_unit: f ? 'mph' : 'kmh'
  });
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + q, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const h = j.hourly, dl = j.daily, rd = (n) => Math.round(n), O = 24;   // O: yesterday's 24 hours come first
    const hr = (iso) => { const m = /T(\d\d):(\d\d)/.exec(iso || ''); return m ? Math.round((+m[1] + +m[2] / 60) * 100) / 100 : null; };
    const hours = (from, n, f) => h.temperature_2m.slice(from, from + n).map((v, i) => f(from + i));
    const day = (i) => ({ date: dl.time[i + 2], hi: rd(dl.temperature_2m_max[i + 2]), lo: rd(dl.temperature_2m_min[i + 2]), c: icon(dl.weather_code[i + 2], true), p: dl.precipitation_probability_max[i + 2] == null ? 0 : rd(dl.precipitation_probability_max[i + 2]), uv: dl.uv_index_max[i + 2] == null ? null : rd(dl.uv_index_max[i + 2]), rise: hr(dl.sunrise[i + 2]), set: hr(dl.sunset[i + 2]) });   // index 0 is yesterday, 1 today, 2 tomorrow
    const N = Math.min(168, h.temperature_2m.length - O);   // today and the next six days, hour by hour (index = day * 24 + hour)
    const data = {
      hi: rd(dl.temperature_2m_max[1]), lo: rd(dl.temperature_2m_min[1]),
      feels: rd(j.current.apparent_temperature), humidity: rd(j.current.relative_humidity_2m), wind: rd(j.current.wind_speed_10m), gust: j.current.wind_gusts_10m == null ? null : rd(j.current.wind_gusts_10m),
      t: h.temperature_2m.slice(O, O + 24).map(rd),
      c: h.weather_code.slice(O, O + 24).map((code, i) => icon(code, !!h.is_day[O + i])),
      p: h.precipitation_probability.slice(O, O + 24).map((n) => (n == null ? 0 : rd(n))),
      // today and tomorrow hour by hour (index 0 is midnight today), kept for older frames
      h48: { t: h.temperature_2m.slice(O, O + 48).map(rd), c: h.weather_code.slice(O, O + 48).map((code, i) => icon(code, !!h.is_day[O + i])), p: h.precipitation_probability.slice(O, O + 48).map((n) => (n == null ? 0 : rd(n))) },
      // the Weather page: every hour of today and the next six days
      hh: { t: h.temperature_2m.slice(O, O + N).map(rd), c: h.weather_code.slice(O, O + N).map((code, i) => icon(code, !!h.is_day[O + i])), p: h.precipitation_probability.slice(O, O + N).map((n) => (n == null ? 0 : rd(n))) },
      yday: { t: h.temperature_2m.slice(0, 24).map(rd), hi: rd(dl.temperature_2m_max[0]), lo: rd(dl.temperature_2m_min[0]) },
      today: { hi: rd(dl.temperature_2m_max[1]), lo: rd(dl.temperature_2m_min[1]), c: icon(dl.weather_code[1], true), p: dl.precipitation_probability_max[1] == null ? 0 : rd(dl.precipitation_probability_max[1]), uv: dl.uv_index_max[1] == null ? null : rd(dl.uv_index_max[1]), rise: hr(dl.sunrise[1]), set: hr(dl.sunset[1]) },
      days: [0, 1, 2, 3, 4, 5].map(day).filter((d) => d.date),   // the next six days
      moon: moon(),
      units: f ? 'F' : 'C'
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return cache ? cache.data : null;
  }
}

// Moon phase from the date alone (no extra request): the 29.53-day cycle counted from a known new moon.
function moon() {
  const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000, ph = ((days / 29.530588853) % 1 + 1) % 1;
  const lit = Math.round((1 - Math.cos(2 * Math.PI * ph)) / 2 * 100);
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { name: names[Math.floor(ph * 8 + 0.5) % 8], lit };
}

function reset() { cache = null; }

module.exports = { getWeather, reset };
