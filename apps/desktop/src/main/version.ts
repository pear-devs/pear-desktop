// Version ordering, for config migrations and the update check.

/** Compares "major.minor.patch" numerically; a prerelease suffix is ignored. */
export function compareVersions(a: string, b: string) {
  const [x, y] = [releaseParts(a), releaseParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** semver precedence of prerelease identifiers: "beta.2" < "beta.10" < "rc.1". */
export function comparePrerelease(a: string, b: string) {
  const [x, y] = [a.split("."), b.split(".")];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [left, right] = [x[i], y[i]];
    // Equal so far: the shorter list comes first.
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const order = compareIdentifiers(left, right);
    if (order !== 0) return order;
  }
  return 0;
}

function releaseParts(version: string) {
  return version.split("-")[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

const isNumeric = (identifier: string) => /^\d+$/.test(identifier);

/** Numeric identifiers compare as numbers and come before alphanumeric ones. */
function compareIdentifiers(left: string, right: string) {
  const leftNumeric = isNumeric(left);
  const rightNumeric = isNumeric(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return Math.sign(left.localeCompare(right));
}
