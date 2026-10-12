'use strict';
// Lists the photos in your NAS folders and serves resized copies. The frame has ~1 GB of RAM, so it
// never gets the multi-megapixel originals.
//
// Which folders feed the frame is chosen in /admin (Photos tab): `photoFolders` in config.json is a list of folder paths
// relative to `photosRoot`, and everything inside a ticked folder is included. With nothing chosen, `photosDir` is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./util');

let sharp = null, exifr = null;
try { sharp = require('sharp'); } catch (e) { /* serve originals */ }
try { exifr = require('exifr'); } catch (e) { /* no EXIF dates */ }

// bump when how a photo's date is worked out changes, so cached entries are recomputed
const META_V = 3;
const EXT = /\.(jpe?g|png|webp)$/i;
const SKIP = /\.(heic|heif)$/i;
const hidden = (name) => name.startsWith('.') || name === '@eaDir' || name === '#recycle' || name === 'Thumbs.db';

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function walk(dir, out, skipped, root) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of names) {
    if (hidden(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out, skipped, root);
    else if (EXT.test(d.name)) out.push(full);
    else if (SKIP.test(d.name)) skipped.push(path.relative(root, full));
  }
}

function dateFromName(name) {
  // not part of a longer number: social-media file names carry long IDs that can contain something date-shaped
  const m = /(?<!\d)((?:19|20)\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?!\d)/.exec(name);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}
const p2 = (n) => (n < 10 ? '0' : '') + n;
const dstr = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());

class Photos {
  constructor(cfg) {
    this.cfg = cfg;
    this.cacheDir = cfg.cacheDir;
    this.indexFile = path.join(cfg.cacheDir, 'photo-index.json');
    this.index = readJson(this.indexFile, {});   // relpath from root -> { m: mtimeMs, o, w, h, date }
    this.list = [];
    this.skipped = [];
    this.at = 0;
    this.busy = null;
  }

  /** The folder every choice is relative to (what the NAS share is mounted as). Defaults to the single photos folder. */
  get root() { return path.resolve(this.cfg.photosRoot || this.cfg.photosDir); }

  /** Folders currently feeding the frame, as absolute paths inside the root. */
  dirs() {
    const root = this.root;
    let rel = Array.isArray(this.cfg.photoFolders) && this.cfg.photoFolders.length ? this.cfg.photoFolders : null;
    if (!rel) rel = [path.relative(root, path.resolve(this.cfg.photosDir)) || '.'];
    const out = [];
    for (const r of rel) {
      const full = path.resolve(root, r);
      if (inside(full, root) && !out.includes(full) && isDir(full)) out.push(full);   // deleted/renamed folders are ignored
    }
    // a folder inside another chosen folder is already included
    return out.filter((d) => !out.some((o) => o !== d && inside(d, o)));
  }

  /** Photos added from the browser live here, inside the hub's own data folder (so Proxmox backups of the container include them). */
  get uploadsDir() { return path.resolve(this.cfg.uploadsDir || path.join(this.cfg.dataDir, 'uploads')); }

  /** One level of folders under the uploads folder; '' is the top level. Anything odd in a name is replaced, so no path can escape. */
  cleanFolder(f) { return String(f == null ? '' : f).trim().replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 60); }
  folderPath(f) { return path.join(this.uploadsDir, this.cleanFolder(f)); }
  uploadFolders() {
    try { return fs.readdirSync(this.uploadsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !hidden(d.name)).map((d) => d.name).sort((x, y) => x.localeCompare(y)); } catch (e) { return []; }
  }
  createFolder(name) {
    const f = this.cleanFolder(name);
    if (!f) throw Object.assign(new Error('give the folder a name'), { userError: true });
    if (fs.existsSync(this.folderPath(f))) throw Object.assign(new Error('a folder called "' + f + '" already exists'), { userError: true });
    fs.mkdirSync(this.folderPath(f), { recursive: true });
    this.reset();
    return f;
  }
  /** Only an empty folder can be removed, so photos are never deleted by accident. */
  deleteFolder(name) {
    const f = this.cleanFolder(name), dir = this.folderPath(f);
    if (!f || !isDir(dir)) throw Object.assign(new Error('no such folder'), { userError: true });
    if (fs.readdirSync(dir).some((n) => !hidden(n))) throw Object.assign(new Error('the folder is not empty; move or remove its photos first'), { userError: true });
    fs.rmSync(dir, { recursive: true, force: true });
    this.reset();
  }
  uniqueName(dir, base) {
    const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
    let out = base;
    for (let i = 1; fs.existsSync(path.join(dir, out)); i++) out = stem + '-' + i + ext;
    return out;
  }

  /** Save one uploaded image (a finished temp file) into a folder. Returns the stored file name. */
  async saveUpload(name, tmpFile, takenMs, folder) {
    const dir = this.folderPath(folder);
    fs.mkdirSync(dir, { recursive: true });
    const base = String(name || 'photo').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(-120) || 'photo';
    if (!EXT.test(base)) throw Object.assign(new Error('only JPEG, PNG and WebP photos can be added'), { userError: true });
    const out = this.uniqueName(dir, base);
    fs.renameSync(tmpFile, path.join(dir, out));
    // keep the original file's date (the browser sends it), the last fallback when a photo has no EXIF date
    if (takenMs > 0 && takenMs < Date.now() + 864e5) { try { fs.utimesSync(path.join(dir, out), new Date(), new Date(takenMs)); } catch (e) { /* best effort */ } }
    this.reset();
    return out;
  }

  uploadFile(folder, name) {
    const dir = this.folderPath(folder), file = path.join(dir, path.basename(String(name || '')));
    return path.dirname(file) === dir && EXT.test(file) && fs.existsSync(file) ? file : null;
  }
  deleteUpload(name, folder) {
    const file = this.uploadFile(folder, name);
    if (!file) return false;
    fs.unlinkSync(file);
    delete this.index['@uploads/' + path.relative(this.uploadsDir, file).split(path.sep).join('/')];
    this.reset();
    return true;
  }
  moveUpload(name, from, to) {
    const file = this.uploadFile(from, name);
    if (!file) throw Object.assign(new Error('no such uploaded photo'), { userError: true });
    const dest = this.folderPath(to);
    if (this.cleanFolder(to) && !isDir(dest)) throw Object.assign(new Error('no such folder'), { userError: true });
    if (dest === path.dirname(file)) return path.basename(file);
    const out = this.uniqueName(dest, path.basename(file));
    fs.renameSync(file, path.join(dest, out));
    delete this.index['@uploads/' + path.relative(this.uploadsDir, file).split(path.sep).join('/')];
    this.reset();
    return out;
  }

  reset() { this.at = 0; }

  async scan(force) {
    if (!force && Date.now() - this.at < 60000 && this.list.length) return this.list;
    if (this.busy) return this.busy;
    const run = (async () => {
      const root = this.root, files = [], skipped = [];
      for (const d of this.dirs()) walk(d, files, skipped, root);
      const ups = [];
      walk(this.uploadsDir, ups, skipped, this.uploadsDir);
      const out = [];
      let dirty = false;
      for (const full of files.concat(ups)) {
        const up = ups.includes(full);
        const rel = up ? '@uploads' + path.sep + path.relative(this.uploadsDir, full) : path.relative(root, full);
        let st; try { st = fs.statSync(full); } catch (e) { continue; }
        let meta = this.index[rel];
        if (!meta || meta.m !== st.mtimeMs || meta.v !== META_V) {
          meta = { m: st.mtimeMs, v: META_V, o: 'l', w: 0, h: 0, date: null };
          try {
            if (sharp) {
              const md = await sharp(full).metadata();
              const swap = md.orientation && md.orientation >= 5;
              meta.w = swap ? md.height : md.width; meta.h = swap ? md.width : md.height;
              meta.o = meta.h > meta.w ? 'p' : 'l';
            }
            if (exifr) {
              const ex = await exifr.parse(full, ['DateTimeOriginal', 'CreateDate']).catch(() => null);
              const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
              if (d instanceof Date && !isNaN(d)) { meta.date = dstr(d); meta.src = 'exif'; }
            }
          } catch (e) { /* unreadable image: still list it, the frame will skip a broken load */ }
          if (!meta.date) { meta.date = dateFromName(path.basename(full)); if (meta.date) meta.src = 'name'; }
          // no date taken anywhere: the file time only says when it was copied here, so it is used for ordering but never shown
          if (!meta.date) { meta.date = dstr(st.mtime); meta.src = 'file'; }
          this.index[rel] = meta; dirty = true;
        }
        const parts = rel.split(path.sep);
        out.push({
          id: b64(parts.join('/')),
          name: path.basename(full),
          o: meta.o, date: meta.date, dated: meta.src !== 'file',
          place: up ? (parts.length > 2 ? parts[parts.length - 2] : '') : (parts.length > 1 ? parts[parts.length - 2] : ''),
          from: 'family', tag: up ? 'uploads' : (parts.length > 1 ? parts[0] : 'frame')
        });
      }
      if (dirty) { try { writeJsonAtomic(this.indexFile, this.index); } catch (e) { /* cache only */ } }
      out.sort((a, b) => a.date.localeCompare(b.date));
      this.list = out; this.skipped = skipped; this.at = Date.now();
      return out;
    })();
    // Clear the in-progress flag only after it has been set. A scan that finishes without awaiting anything (every photo already
    // indexed) would otherwise clear it first and leave a finished promise there forever, so rescans would return stale results.
    this.busy = run;
    const clear = () => { if (this.busy === run) this.busy = null; };
    run.then(clear, clear);
    return run;
  }

  /** Folders under the root with how many photos each holds, for the chooser in /admin. */
  tree() {
    const root = this.root, nodes = [];
    const visit = (dir, depth) => {
      let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return { direct: 0, total: 0 }; }
      let direct = 0, total = 0;
      const subs = [];
      for (const d of names) {
        if (hidden(d.name)) continue;
        if (d.isDirectory()) subs.push(d.name);
        else if (EXT.test(d.name)) direct++;
      }
      total = direct;
      const idx = nodes.length;
      const rel = path.relative(root, dir) || '.';
      if (depth > 0) nodes.push({ path: rel.split(path.sep).join('/'), name: path.basename(dir), depth, direct: 0, total: 0 });
      if (depth < 5 && nodes.length < 400) for (const s of subs.sort()) total += visit(path.join(dir, s), depth + 1).total;
      if (depth > 0) { nodes[idx].direct = direct; nodes[idx].total = total; }
      return { direct, total };
    };
    const top = visit(root, 0);
    return { root, rootDirect: top.direct, rootTotal: top.total, nodes };
  }

  /** Resolve an id to a file inside a folder that is currently chosen (no path escapes). */
  resolve(id) {
    let rel; try { rel = unb64(id); } catch (e) { return null; }
    if (rel.startsWith('@uploads/')) {
      const f = path.resolve(this.uploadsDir, rel.slice(9));
      return inside(f, this.uploadsDir) && fs.existsSync(f) ? f : null;
    }
    const root = this.root, full = path.resolve(root, rel);
    if (!inside(full, root) || !this.dirs().some((d) => inside(full, d))) return null;
    return fs.existsSync(full) ? full : null;
  }

  /** Path of a resized JPEG (created on first request) or the original if sharp is unavailable. */
  async sized(id, width) {
    const full = this.resolve(id);
    if (!full) return null;
    if (!sharp) return { file: full, type: 'image/jpeg' };
    const w = Math.max(160, Math.min(2560, width || 1280));
    const st = fs.statSync(full);
    const key = crypto.createHash('sha1').update(id + '|' + st.mtimeMs + '|' + w).digest('hex');
    const out = path.join(this.cacheDir, 'img', key + '.jpg');
    if (!fs.existsSync(out)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = out + '.' + process.pid + '.tmp';
      await sharp(full).rotate().resize({ width: w, height: w * 2, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true }).toFile(tmp);
      fs.renameSync(tmp, out);
    }
    return { file: out, type: 'image/jpeg' };
  }
}

module.exports = { Photos };
