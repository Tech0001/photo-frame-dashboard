import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const emojiDir = fileURLToPath(new URL('./node_modules/@twemoji/svg/', import.meta.url));
const emojiPath = '/emoji/v15.0.0/';
const emojiAssets = {
  name: 'local-emoji',
  generateBundle() {
    for (const file of fs.readdirSync(emojiDir).filter((f) => f.endsWith('.svg'))) {
      this.emitFile({ type: 'asset', fileName: emojiPath.slice(1) + file, source: fs.readFileSync(path.join(emojiDir, file)) });
    }
  },
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url.startsWith(emojiPath)) return next();
      const name = req.url.slice(emojiPath.length);
      if (!/^[a-f0-9-]+\.svg$/.test(name) || !fs.existsSync(path.join(emojiDir, name))) return next();
      res.setHeader('Content-Type', 'image/svg+xml');
      fs.createReadStream(path.join(emojiDir, name)).pipe(res);
    });
  }
};

// The wall tablet runs Android WebView 106 — keep JS output within Chromium 106.
// CSS targets chrome61 on purpose: the tablet's WebView rejects 4/8-digit hex colours (#0000,
// #ffffffbf) even though Chrome 106 should support them, and a newer target lets the minifier
// rewrite transparent/rgba() into that form. Verified on-device with CSS.supports().
export default defineConfig({
  plugins: [emojiAssets],
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  server: { host: true },
});
