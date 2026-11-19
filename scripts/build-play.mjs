import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'web/play-react/main.jsx')],
  outfile: path.join(root, 'web/play/app.js'),
  bundle: true,
  external: ['/play/*'],
  minify: true,
  sourcemap: false,
  target: ['es2022'],
  format: 'iife',
  legalComments: 'none'
});

// Keep the activity page stylesheet beside the public player assets. The
// player server serves files from web/play, while the React source lives in
// web/play-react.
await copyFile(
  path.join(root, 'web/play-react/activities.css'),
  path.join(root, 'web/play/activities.css')
);

console.log('Built React player at web/play/app.js');
