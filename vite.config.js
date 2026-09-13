import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: POST /__snap?name=foo with a data-URL body saves a JPEG next to the project
// (used by the automated visual checks; never part of the build).
function snapPlugin() {
  return {
    name: 'suspect-dev-snap',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snap', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const dir = process.env.SUSPECT_SNAP_DIR || path.join(process.cwd(), '.snaps');
        fs.mkdirSync(dir, { recursive: true });
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'snap').replace(/[^a-z0-9_-]/gi, '');
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

// GitHub Pages serves the project at /Suspect/ — override with VITE_BASE for other hosts (e.g. "/").
export default defineConfig({
  base: process.env.VITE_BASE || '/Suspect/',
  plugins: [snapPlugin()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, host: true },
});
