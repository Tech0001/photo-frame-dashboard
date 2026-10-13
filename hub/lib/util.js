'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJsonAtomic(file, obj, mode) {
  require('./backup').snapshot(file);   // keep what was there before this change (state.json and config.json only)
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
  if (mode && process.platform !== 'win32') { try { fs.chmodSync(file, mode); } catch (e) { /* best effort */ } }
}

/** YYYY-MM-DD for a Date in the process timezone (TZ is set from config at startup). */
function ymd(d) {
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body)) {
    h['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(body);
  }
  res.writeHead(code, h);
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 2 * 1024 * 1024)) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) {
        const err = new Error('invalid JSON'); err.userError = true; reject(err);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { ROOT, readJson, writeJsonAtomic, ymd, uid, send, readBody };
