import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

/** Emits sw.js with a precache list of every built file, so the game works offline after the first visit. */
function serviceWorker(): Plugin {
  return {
    name: 'geolight-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`), './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 10);
      const source = readFileSync('src/platform/sw.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build runs from any sub-path (GitHub Pages, itch.io, plain file servers).
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2020',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
