'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const problem = (message, status = 400) => Object.assign(new Error(message), { status, userError: status < 500 });
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw problem('Cannot read JSON: ' + path.basename(file), 500); }
}
function writeJsonAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', mode);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch {} }
}
function ymd(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
const uid = prefix => prefix + crypto.randomUUID();
function send(res, status, data, extra = {}) {
  const json = data && typeof data === 'object' && !Buffer.isBuffer(data);
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(json ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...extra });
  res.end(json ? JSON.stringify(data) : data);
}
async function readBytes(req, limit = 1024 * 1024) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw problem('Request too large', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readBody(req, limit) { const raw = await readBytes(req, limit); try { return raw.length ? JSON.parse(raw) : {}; } catch { throw problem('Invalid JSON'); } }
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw problem('Cross-site writes are not allowed', 403);
  if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { throw problem('Invalid origin', 403); } if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw problem('Cross-site writes are not allowed', 403); }
}
function equalSecret(given, expected) { const a = Buffer.from(String(given || '')), b = Buffer.from(String(expected || '')); return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
module.exports = { ROOT, problem, readJson, writeJsonAtomic, ymd, uid, send, readBody, readBytes, sameOrigin, equalSecret };
