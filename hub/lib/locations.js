'use strict';

// Resolve a user-entered city or postal code; no device location is inferred.
async function searchLocations(query, request = fetch) {
  const name = String(query || '').trim();
  if (name.length < 2 || name.length > 100) {
    throw Object.assign(new Error('Enter a city or postal code (2–100 characters)'), { userError: true });
  }
  const params = new URLSearchParams({ name, count: '8', language: 'en', format: 'json' });
  const res = await request('https://geocoding-api.open-meteo.com/v1/search?' + params,
    { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Location search is unavailable; try again or enter coordinates');
  const data = await res.json();
  return (data.results || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    .map((p) => ({ name: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
      lat: p.latitude, lon: p.longitude, timezone: p.timezone || '' }));
}

module.exports = { searchLocations };
