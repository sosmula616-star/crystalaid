import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    include: ['{apps,packages}/**/*.test.ts'],
    // Database tests share one test database and empty it before each test,
    // so test files must not run at the same time.
    fileParallelism: false,
  },
});
