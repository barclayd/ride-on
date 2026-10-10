import { defineConfig } from '@playwright/test';

// One worker: the mock API listens on the fixed port baked into the e2e build.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
});
