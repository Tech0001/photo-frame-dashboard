'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { problem } = require('./util');
const image = /\.(jpe?g|png|webp|heic|heif|avif)$/i;
class Photos {
  constructor(cfg) { this.cfg = cfg; this.files = new Map(); this.scanned = 0; this.skipped = []; }
  async scan(refresh = false) {
    if (!refresh && Date.now() - this.scanned < 60000) return [...this.files.values()].map(p => p.public);
    const found = new Map(); this.skipped = [];
    const root = path.resolve(this.cfg.photosRoot || this.cfg.photosDir);
    const folders = Array.isArray(this.cfg.photoFolders) ? this.cfg.photoFolders : [path.relative(root,this.cfg.photosDir)];
    const walk = async folder => {
      if (folder !== root && !folder.startsWith(root + path.sep)) return;
      let entries; try { entries = await fs.readdir(folder, {withFileTypes:true}); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || found.size >= 5000) continue;
        const file = path.join(folder,entry.name);
        if (entry.isDirectory()) { await walk(file); continue; }
        if (!entry.isFile() || !image.test(entry.name)) continue;
        try {
          const meta = await sharp(file).metadata(), stat = await fs.stat(file);
          const id = crypto.createHash('sha256').update(path.relative(root,file)).digest('hex').slice(0,32);
          const rotated = [5,6,7,8].includes(meta.orientation);
          const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
          found.set(id, { file, mtime:stat.mtimeMs, public:{ id,url:'/photo/' + id,o:width >= height ? 'l':'p',date:new Date(stat.mtimeMs).toISOString().slice(0,10),dated:false,place:'',from:'family',tag:'photos' } });
        } catch { this.skipped.push(entry.name); }
      }
    };
    for (const folder of folders) { const target = path.resolve(root,folder); try { if ((await fs.lstat(target)).isSymbolicLink()) continue; } catch { continue; } await walk(target); }
    this.files = found; this.scanned = Date.now(); return [...found.values()].map(p => p.public);
  }
  async sized(id, width = 1280) {
    await this.scan(); const item = this.files.get(id); if (!item) return null;
    // Recheck the real path before serving, including if a directory was replaced by a symlink.
    const root = await fs.realpath(this.cfg.photosRoot || this.cfg.photosDir), actual = await fs.realpath(item.file);
    if (!actual.startsWith(root + path.sep)) throw problem('Photo outside library',403);
    const size = Math.min(2560,Math.max(320,Math.round(Number(width) || 1280)));
    const output = path.join(this.cfg.cacheDir, id + '-' + item.mtime + '-' + size + '.jpg');
    await fs.mkdir(this.cfg.cacheDir,{recursive:true,mode:0o700});
    try { await fs.access(output); } catch { const temporary = output + '.' + crypto.randomUUID() + '.tmp'; try { await sharp(actual).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toFile(temporary); await fs.rename(temporary,output); } finally { await fs.rm(temporary,{force:true}); } }
    return { file:output,type:'image/jpeg' };
  }
  async upload(bytes, name) {
    if (!bytes.length || !image.test(name)) throw problem('Choose an image file');
    await sharp(bytes).metadata().catch(() => { throw problem('Unsupported image'); });
    await fs.mkdir(this.cfg.photosDir,{recursive:true,mode:0o700});
    const extension = path.extname(name).toLowerCase(), file = path.join(this.cfg.photosDir,crypto.randomUUID() + extension);
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o600}); this.scanned = 0; return {ok:true};
  }
}
module.exports = { Photos };
