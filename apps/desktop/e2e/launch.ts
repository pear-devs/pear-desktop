import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "@playwright/test";

/** Launch the built app with a fresh, isolated profile. */
export function launchApp() {
  const userData = mkdtempSync(join(tmpdir(), "pear-e2e-"));
  return electron.launch({ args: ["."], env: { ...process.env, PEAR_USER_DATA: userData } });
}
