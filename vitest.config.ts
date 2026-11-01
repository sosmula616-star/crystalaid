import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database tests share one test database and empty it before each test,
    // so test files must not run at the same time.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          globalSetup: ['./vitest.global-setup.ts'],
          include: ['{apps,packages}/**/*.test.ts'],
        },
      },
      {
        // Component tests: React in jsdom.
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./packages/design-system/vitest.dom-setup.ts'],
          include: ['{apps/activity,packages/design-system}/**/*.test.tsx'],
        },
      },
    ],
  },
});
