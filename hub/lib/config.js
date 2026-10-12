'use strict';
// Loads config/config.json (settings, safe to share) and config/secrets.json (tokens and URLs, never commit).
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./util');

/** Missing file -> fallback. Present but invalid -> stop with a message, never silently use defaults. */
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
    console.error('\nERROR: ' + file + ' is not valid JSON: ' + e.message);
    console.error('Tip: in JSON, Windows paths need forward slashes ("Z:/photos") or doubled backslashes.\n');
    process.exit(1);
  }
}

const DEFAULT_CONFIG = {
  timezone: 'America/Toronto',
  port: 8099,
  photosDir: '/photos',
  photosRoot: null,         // folder the photo choices are relative to (the mounted share); defaults to photosDir
  photoFolders: null,       // chosen folders (relative to photosRoot); null = just photosDir
  dashboardDir: path.join(ROOT, '..', 'dashboard', 'dist'),
  dataDir: path.join(ROOT, 'data'),
  cacheDir: path.join(ROOT, 'cache'),
  calendars: [],            // [{ name, secret, people: ['alex'] }]  secret = key in secrets.json -> ical
  proxmenux: { url: '', tokenSecret: 'proxmenux_token', insecureTLS: false },
  homelab: require('./homelab').defaults(),
  homeassistant: require('./homeassistant').defaults(),
  weather: null,            // { lat, lon } for Open-Meteo, or null to keep the demo weather
};

function load() {
  const cfgFile = process.env.HUB_CONFIG || path.join(ROOT, 'config', 'config.json');
  const secFile = process.env.HUB_SECRETS || path.join(ROOT, 'config', 'secrets.json');
  const cfg = Object.assign({}, DEFAULT_CONFIG, readJson(cfgFile, {}));
  cfg.proxmenux = Object.assign({}, DEFAULT_CONFIG.proxmenux, cfg.proxmenux || {});
  cfg.homeassistant = Object.assign({}, DEFAULT_CONFIG.homeassistant, cfg.homeassistant || {});
  // Environment variables win, so Docker users can set paths without editing files.
  if (process.env.PHOTOS_DIR) cfg.photosDir = process.env.PHOTOS_DIR;
  if (process.env.PHOTOS_ROOT) cfg.photosRoot = process.env.PHOTOS_ROOT;
  if (process.env.DASHBOARD_DIR) cfg.dashboardDir = process.env.DASHBOARD_DIR;
  if (process.env.DATA_DIR) cfg.dataDir = process.env.DATA_DIR;
  if (process.env.CACHE_DIR) cfg.cacheDir = process.env.CACHE_DIR;
  if (process.env.PORT) cfg.port = +process.env.PORT;
  if (process.env.TZ) cfg.timezone = process.env.TZ;
  const secrets = readJson(secFile, {});
  return { cfg, secrets, cfgFile, secFile };
}

module.exports = { load };
