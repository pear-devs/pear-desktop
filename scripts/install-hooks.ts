// Runs as `prepare` on every install: points git at the repository's shared
// hooks (.githooks), so everyone gets them without a manual step.

import { execFileSync } from "node:child_process";

try {
  // Not a git checkout (a tarball, a CI cache…): nothing to install.
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
} catch {
  // No git, or not a repository.
}
