'use strict';
// Rolling backups of the hub's own JSON files (state.json and config.json). Every write goes through util.writeJsonAtomic,
// which calls snapshot() first, so the file as it was BEFORE a change is kept. One backup per file per window, so a burst of
// chore ticks does not make forty copies, and only the newest KEEP are retained. secrets.json is never copied.
const fs = require('fs');
const path = require('path');

const WINDOW_MS = 10 * 60 * 1000;   // at most one backup per file in this window
const KEEP = 40;
const WATCHED = ['state.json', 'config.json'];   // anything else (secrets.json, caches) is never copied
const last = new Map();             // file -> time of the newest backup made by this process

const dirFor = (file) => path.join(path.dirname(file), 'backups');
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');   // 20261011-141530-123: milliseconds too, so two backups in one second never collide

function snapshot(file, force) {
  try {
    if (!WATCHED.includes(path.basename(file)) || !fs.existsSync(file)) return;
    const now = Date.now();
    if (!force && now - (last.get(file) || 0) < WINDOW_MS) return;
    const dir = dirFor(file), base = path.basename(file, '.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, base + '.' + stamp(new Date(now)) + '.json'));
    last.set(file, now);
    const mine = fs.readdirSync(dir).filter((n) => n.startsWith(base + '.') && n.endsWith('.json')).sort();
    mine.slice(0, Math.max(0, mine.length - KEEP)).forEach((n) => { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* best effort */ } });
  } catch (e) { /* a failed backup must never block a save */ }
}

/** Newest first: [{ file, name, at (ISO), bytes }] for state.json or config.json. */
function list(file) {
  try {
    const dir = dirFor(file), base = path.basename(file, '.json');
    return fs.readdirSync(dir).filter((n) => n.startsWith(base + '.') && n.endsWith('.json')).sort().reverse().map((n) => {
      const m = n.match(/\.(\d{8})-(\d{6})(?:-\d{3})?\.json$/), st = fs.statSync(path.join(dir, n));
      const at = m ? new Date(m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6, 8) + 'T' + m[2].slice(0, 2) + ':' + m[2].slice(2, 4) + ':' + m[2].slice(4, 6) + 'Z').toISOString() : st.mtime.toISOString();
      return { name: n, at, bytes: st.size };
    });
  } catch (e) { return []; }
}

/** Parsed contents of one backup of `file`, or null. Only names that list() returns are accepted (no path tricks). */
function read(file, name) {
  if (!list(file).some((b) => b.name === name)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dirFor(file), name), 'utf8')); } catch (e) { return null; }
}

module.exports = { snapshot, list, read, WINDOW_MS, KEEP };
