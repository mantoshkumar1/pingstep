import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 15_000,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  webServer: { command: 'node test/e2e-server.mjs', port: 4173, reuseExistingServer: true }
});
