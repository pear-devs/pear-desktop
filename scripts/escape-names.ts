// Keeps the app's name escaped in package.json files, the way pear-desktop has
// always spelled it (as JavaScript unicode escapes, not the plain name). Package
// managers rewrite package.json and silently un-escape it, so the pre-commit
// hook runs this on every staged package.json.
//
//   node scripts/escape-names.ts --staged   fix staged package.json files (pre-commit)
//   node scripts/escape-names.ts --check    exit 1 if a tracked one is plain (CI)
//   node scripts/escape-names.ts <files…>   fix these files

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
const isPackageJson = (path: string) => path === "package.json" || path.endsWith("/package.json");

function fixFile(path: string) {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, "utf8");
  const fixed = escapeNames(text);
  if (fixed === text) return false;
  writeFileSync(path, fixed);
  return true;
}

function fixStaged() {
  const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(isPackageJson);
  for (const path of staged) {
    const [mode] = git("ls-files", "-s", "--", path).split(" ");
    const text = git("show", `:${path}`);
    const fixed = escapeNames(text);
    if (fixed === text) continue;
    // Fix what is staged without staging anything else, then the working copy.
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin", "--path", path], { input: fixed, encoding: "utf8" }).trim();
    git("update-index", "--cacheinfo", `${mode},${blob},${path}`);
    fixFile(path);
    console.log(`escape-names: escaped the app name in ${path}`);
  }
}

function check() {
  const plain = git("ls-files", "-z").split("\0").filter(isPackageJson).filter((path) => {
    const text = readFileSync(path, "utf8");
    return escapeNames(text) !== text;
  });
  for (const path of plain) console.error(`escape-names: ${path} spells the app name plainly; run node scripts/escape-names.ts ${path}`);
  if (plain.length > 0) process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === "--staged") fixStaged();
else if (args[0] === "--check") check();
else for (const path of args) if (fixFile(path)) console.log(`escape-names: escaped the app name in ${path}`);
