import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // The apps' windows go to a virtual display, off the desktop (see the file).
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  reporter: "list",
  // Tests drive the real YTM: pre-roll ads and network hiccups are
  // outside our control, so one retry separates flakes from real failures.
  retries: 1,
  // On CI (GitHub's IPs), one app talks to YTM at a time.
  workers: process.env.CI ? 1 : 2,
});
