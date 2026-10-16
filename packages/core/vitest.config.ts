import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // L1: pure unit tests, no network (docs/dev/testing.md).
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/l2/**'] } },
      // L2: core driven against tools/mock-inox over real HTTP and WebSocket on localhost.
      { extends: true, test: { name: 'l2', include: ['test/l2/**/*.test.ts'], testTimeout: 20_000 } },
    ],
  },
});
