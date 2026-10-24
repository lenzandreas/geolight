import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build runs from any sub-path (GitHub Pages, itch.io, file servers).
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
