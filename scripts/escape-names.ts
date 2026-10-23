// Keeps the trademarked app name out of the sources, the way pear-desktop
// always has: in JSON (package.json, en.json, test data) it is written as
// unicode escapes, which this fixes automatically; in code and docs it must be
// escaped in strings or left out of prose ("YTM"), which this reports. Package
// managers and JSON writers un-escape JSON, so the pre-commit hook runs this on
// every commit, and CI runs --check.
//
//   node scripts/escape-names.ts --staged   fix staged JSON, reject other plain uses (pre-commit)
//   node scripts/escape-names.ts --check    exit 1 on any plain use in tracked files (CI)
//   node scripts/escape-names.ts <files…>   fix these JSON files

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BACKSLASH = String.fromCharCode(92);
const NAME = /\u0079\u006f\u0075\u0074\u0075\u0062\u0065(?:[ -]?music)?/gi;

/** Escapes every spelling of the name inside the JSON text (keys and values alike). */
export function escapeNames(json: string): string {
  return json.replace(NAME, (match) =>
    [...match].map((char) => `${BACKSLASH}u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""),
  );
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
// pear-desktop's own files, kept as it wrote them; and the lockfile, which is generated
// and names third-party packages (YAML has no escapes for them).
const isUpstream = (path: string) => path === "changelog.md" || path.startsWith(".github/") || path === "pnpm-lock.yaml";
const isJson = (path: string) => path.endsWith(".json");
const isText = (path: string) => /\.(m|c)?(ts|tsx|js|jsx|json|md|ya?ml|css|html|txt)$/.test(path);

/** Lines that spell the name plainly. */
function plainLines(text: string) {
  return text.split("\n").flatMap((line, index) => (escapeNames(line) !== line ? [index + 1] : []));
}

function fixFile(path: string) {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  const fixed = escapeNames(text);
  if (fixed === text) return false;
  writeFileSync(path, fixed);
  return true;
}

function report(found: [path: string, lines: number[]][]) {
  for (const [path, lines] of found) console.error(`escape-names: ${path}:${lines.join(",")} spells the app name plainly`);
  if (found.length > 0) {
    console.error("escape-names: write it as unicode escapes in strings (as pear-desktop does), or say YTM in prose.");
  }
  return found.length === 0;
}

function fixStaged() {
  const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    .split("\0")
    .filter((path) => path && isText(path) && !isUpstream(path));
  const found: [string, number[]][] = [];
  for (const path of staged) {
    const text = git("show", `:${path}`);
    if (!isJson(path)) {
      const lines = plainLines(text);
      if (lines.length > 0) found.push([path, lines]);
      continue;
    }
    const fixed = escapeNames(text);
    if (fixed === text) continue;
    // Fix what is staged without staging anything else, then the working copy.
    const [mode] = git("ls-files", "-s", "--", path).split(" ");
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin", "--path", path], { input: fixed, encoding: "utf8" }).trim();
    git("update-index", "--cacheinfo", `${mode},${blob},${path}`);
    fixFile(path);
    console.log(`escape-names: escaped the app name in ${path}`);
  }
  if (!report(found)) process.exit(1);
}

function check() {
  const found: [string, number[]][] = [];
  for (const path of git("ls-files", "-z").split("\0")) {
    if (!path || !isText(path) || isUpstream(path) || !existsSync(path)) continue;
    const lines = plainLines(readFileSync(path, "utf8"));
    if (lines.length > 0) found.push([path, lines]);
  }
  if (!report(found)) process.exit(1);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--staged") fixStaged();
  else if (args[0] === "--check") check();
  else for (const path of args) if (fixFile(path)) console.log(`escape-names: escaped the app name in ${path}`);
}
