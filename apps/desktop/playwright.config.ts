import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  reporter: "list",
  // Tests drive the real YTM: pre-roll ads and network hiccups are
  // outside our control, so one retry separates flakes from real failures.
  retries: 1,
  workers: 2,
});
