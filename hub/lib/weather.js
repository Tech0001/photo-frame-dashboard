'use strict';
const tune = require('./tune');
const { problem, ymd } = require('./util');
function condition(code, daylight = true) {
  if (code === 0) return daylight ? 'sun' : 'moon';
  if (code === 1 || code === 2) return daylight ? 'partly' : 'moon';
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95) return 'rain';
  return 'cloud';
}
const round = n => typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
function transform(j, cfg) {
  if (!j.hourly?.time || !j.daily?.time || !j.current) throw problem('Incomplete forecast', 502);
  const today = ymd(), first = j.daily.time.indexOf(today);
  if (first < 0) throw problem('Forecast does not contain today', 502);
  const hourMap = new Map(j.hourly.time.map((stamp,i) => [stamp.slice(0,13),i]));
  function hours(day) {
    const out = { t:[], c:[], p:[] };
    for (let hour = 0; hour < 24; hour++) { const i = hourMap.get(day + 'T' + String(hour).padStart(2,'0')); out.t.push(round(j.hourly.temperature_2m[i])); out.c.push(condition(j.hourly.weather_code[i], !!j.hourly.is_day[i])); out.p.push(round(j.hourly.precipitation_probability[i])); }
    return out;
  }
  const solar = iso => { const parts = String(iso || '').match(/T(\d{2}):(\d{2})/); return parts ? Number(parts[1]) + Number(parts[2]) / 60 : null; };
  const daily = i => ({ date:j.daily.time[i], hi:round(j.daily.temperature_2m_max[i]), lo:round(j.daily.temperature_2m_min[i]), c:condition(j.daily.weather_code[i]), p:round(j.daily.precipitation_probability_max[i]), uv:round(j.daily.uv_index_max[i]), rise:solar(j.daily.sunrise[i]), set:solar(j.daily.sunset[i]) });
  const current = hours(today), hh = { t:[], c:[], p:[] };
  for (const date of j.daily.time.slice(first, first + 7)) { const h = hours(date); for (const key of Object.keys(hh)) hh[key].push(...h[key]); }
  const now = daily(first);
  return { ...current, hi:now.hi, lo:now.lo, feels:round(j.current.apparent_temperature), humidity:round(j.current.relative_humidity_2m), wind:round(j.current.wind_speed_10m), gust:round(j.current.wind_gusts_10m), today:now, days:j.daily.time.slice(first + 1, first + 7).map((_,i) => daily(first + i + 1)), hh, h48:Object.fromEntries(Object.entries(hh).map(([key,values]) => [key,values.slice(0,48)])), units:cfg.weather.units === 'f' ? 'F' : 'C', updatedAt:new Date().toISOString(), stale:false };
}
function createWeather(fetcher = fetch) {
  const entries = new Map();
  return async function getWeather(cfg, refresh = false) {
    if (!cfg.weather) return null;
    const w = cfg.weather, key = JSON.stringify([w,cfg.timezone]);
    let entry = entries.get(key);
    if (!entry) { entry = { at:0, data:null, pending:null }; entries.set(key,entry); }
    if (!refresh && Date.now() - entry.at < tune.get('weatherMin') * 60000) return entry.data;
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
      try {
        const q = new URLSearchParams({ latitude:w.lat, longitude:w.lon, timezone:cfg.timezone, forecast_days:'7', hourly:'temperature_2m,precipitation_probability,weather_code,is_day', daily:'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,uv_index_max,sunrise,sunset', current:'apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m', temperature_unit:w.units === 'f' ? 'fahrenheit':'celsius', wind_speed_unit:w.units === 'f' ? 'mph':'kmh' });
        const response = await fetcher('https://api.open-meteo.com/v1/forecast?' + q, { signal:AbortSignal.timeout(12000), redirect:'error' });
        if (!response.ok) throw problem('Forecast service unavailable', 502);
        entry.data = transform(await response.json(),cfg); entry.at = Date.now();
      } catch { entry.at = Date.now() - tune.get('weatherMin') * 60000 + 30000; if (entry.data) entry.data = { ...entry.data, stale:true }; }
      finally { entry.pending = null; }
      return entry.data;
    })();
    return entry.pending;
  };
}
const getWeather = createWeather();
module.exports = { getWeather, createWeather, transform, condition, reset() {} };
