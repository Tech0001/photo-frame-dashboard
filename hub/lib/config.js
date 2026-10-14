'use strict';
const path = require('node:path');
const { ROOT, readJson, problem } = require('./util');
function load(env = process.env) {
  const cfgFile = env.HUB_CONFIG || path.join(ROOT, 'config/config.json');
  const secFile = env.HUB_SECRETS || path.join(ROOT, 'config/secrets.json');
  const defaults = { host: '0.0.0.0', port: 8099, timezone: 'UTC', dashboardDir: path.resolve(ROOT, '../dashboard/dist'), dataDir: path.join(ROOT, 'data'), photosDir: path.join(ROOT, 'photos'), cacheDir: path.join(ROOT, 'cache'), calendars: [], weather: null };
  const cfg = { ...defaults, ...readJson(cfgFile, {}) };
  for (const [key, variable] of Object.entries({ port: 'PORT', timezone: 'TZ', host: 'HUB_HOST', dashboardDir: 'DASHBOARD_DIR', dataDir: 'DATA_DIR', photosDir: 'PHOTOS_DIR', cacheDir: 'CACHE_DIR' })) if (env[variable]) cfg[key] = key === 'port' ? Number(env[variable]) : env[variable];
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw problem('Invalid port');
  try { new Intl.DateTimeFormat('en', { timeZone: cfg.timezone }); } catch { throw problem('Invalid timezone'); }
  const secrets = readJson(secFile, {});
  if (env.HUB_ADMIN_PASSWORD) secrets.admin_password = env.HUB_ADMIN_PASSWORD;
  return { cfg, secrets, cfgFile, secFile };
}
module.exports = { load };
