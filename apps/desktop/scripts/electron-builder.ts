// Runs electron-builder as the package scripts used to, with one change: it is
// told the package manager is npm.
//
// electron-builder lists the app's production dependencies with the project's
// package manager, which it guesses from npm_config_user_agent. nub reports
// itself as pnpm there, so electron-builder ran `pnpm list`, and the build failed
// wherever pnpm isn't installed (CI installs only nub). The app ships no
// node_modules (electron-vite bundles everything into out/), so the listing finds
// nothing either way; npm is always there, next to node.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("electron-builder/cli.js");
const { status, error } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, npm_config_user_agent: `npm node/${process.version}`, npm_execpath: "" },
});
if (error) throw error;
process.exit(status ?? 1);
