import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Unit tests run with vitest (`pnpm test:unit`).
  testIgnore: '**/unit/**',
});
