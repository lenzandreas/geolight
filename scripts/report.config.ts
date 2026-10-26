import { defineConfig } from 'vitest/config';

/** Runs the level report (npm run report), kept apart from the test suite because it is slow. */
export default defineConfig({
  test: {
    include: ['scripts/level-report.ts'],
    testTimeout: 0,
    silent: false,
  },
});
