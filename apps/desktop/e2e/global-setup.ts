// The apps under test open their windows on a virtual X display (Xvfb), not on
// the desktop: they render and take input as usual, out of the way. Linux with
// Xvfb installed only; PEAR_E2E_SHOW=1 shows them, and CI has its own display.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/** The display the apps open on; launch.ts points them at it. */
export const E2E_DISPLAY = "PEAR_E2E_DISPLAY";
const XVFB = "/usr/bin/Xvfb";
const SCREEN = "1920x1080x24";

export default async function globalSetup() {
  if (process.platform !== "linux" || process.env.CI || process.env.PEAR_E2E_SHOW === "1" || !existsSync(XVFB)) return;
  // Xvfb picks a free display and writes its number to fd 3 once it accepts connections.
  const xvfb = spawn(XVFB, ["-displayfd", "3", "-screen", "0", SCREEN, "-nolisten", "tcp"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
  const display = await new Promise<string>((resolve, reject) => {
    let output = "";
    xvfb.stdio[3]!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("\n")) resolve(`:${output.trim()}`);
    });
    xvfb.once("exit", (code) => reject(new Error(`Xvfb exited (${code}) before it started`)));
    xvfb.once("error", reject);
  });
  // Workers start after this and inherit it.
  process.env[E2E_DISPLAY] = display;
  return () => {
    xvfb.kill();
  };
}
