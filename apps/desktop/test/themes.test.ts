import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Themes } from "../src/main/themes.ts";

describe("Themes", () => {
  const dirs: string[] = [];
  const themes: Themes[] = [];
  afterEach(() => {
    for (const t of themes.splice(0)) t.stop();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "pear-themes-"));
    dirs.push(dir);
    const onChange = vi.fn();
    const instance = new Themes(onChange);
    themes.push(instance);
    return { dir, onChange, themes: instance };
  };

  test("reads the files in list order and reports missing ones", () => {
    const { dir, themes } = setup();
    writeFileSync(join(dir, "a.css"), "a {}");
    writeFileSync(join(dir, "b.css"), "b {}");
    expect(themes.set([join(dir, "b.css"), join(dir, "nope.css"), ` ${join(dir, "a.css")} `, ""])).toBe(true);
    expect(themes.css).toEqual(["b {}", "a {}"]);
    expect(themes.missing).toEqual([join(dir, "nope.css")]);
    // The same list again changes nothing.
    expect(themes.set([join(dir, "b.css"), join(dir, "nope.css"), join(dir, "a.css")])).toBe(false);
    expect(themes.set([])).toBe(true);
    expect(themes.css).toEqual([]);
  });

  test("follows edits to a watched file", async () => {
    const { dir, onChange, themes } = setup();
    const file = join(dir, "theme.css");
    writeFileSync(file, "x {}");
    themes.set([file]);
    writeFileSync(file, "y { color: red }");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000, interval: 100 });
    expect(themes.css).toEqual(["y { color: red }"]);
  });
});
