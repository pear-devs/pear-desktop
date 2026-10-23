import { describe, expect, test } from "vitest";
import { splitPlugin } from "../src/split.ts";

const source = `
import { definePlugin, config } from "@pear/sdk";
import { css, sel } from "@pear/sdk/macros" with { type: "macro" };
import { readFile } from "node:fs/promises";
import MprisService from "mpris-service";
import { formatTime, helper } from "./shared.ts";
import type { Track } from "@pear/sdk";

function hostOnly(path: string) {
  return readFile(path, "utf8");
}

const pageOnly = (t: Track) => formatTime(t.durationSeconds);

export default definePlugin({
  id: "demo",
  name: "Demo",
  config: { enabled: config.bool(true, { label: "On" }) },
  host: {
    start(ctx) {
      new MprisService({ name: "pear" });
      void hostOnly("/tmp/x");
      helper();
    },
  },
  page: (ctx) => {
    ctx.player.on("trackChange", (t) => console.log(pageOnly(t)));
    document.querySelector(sel("player_bar"));
  },
  style: css\`sel(nav_bar) { color: red }\`,
});
`;

describe("splitPlugin", () => {
  test("page target drops host code and its imports", () => {
    const out = splitPlugin(source, "demo.ts", "page");
    expect(out).not.toContain("host:");
    expect(out).not.toContain("mpris-service");
    expect(out).not.toContain("node:fs");
    expect(out).not.toContain("hostOnly");
    expect(out).toContain('import { formatTime } from "./shared.ts";');
    expect(out).toContain('import { css, sel } from "@pear/sdk/macros" with { type: "macro" };');
    expect(out).toContain("pageOnly");
    expect(out).toContain("style:");
  });

  test("host target drops page code, style and their imports", () => {
    const out = splitPlugin(source, "demo.ts", "host");
    expect(out).not.toContain("page:");
    expect(out).not.toContain("style:");
    expect(out).not.toContain("@pear/sdk/macros");
    expect(out).not.toContain("pageOnly");
    expect(out).not.toContain("formatTime");
    expect(out).toContain('import { helper } from "./shared.ts";');
    expect(out).toContain('import MprisService from "mpris-service";');
    expect(out).toContain("function hostOnly");
    expect(out).toContain('import { definePlugin, config } from "@pear/sdk";');
  });

  test("keeps side-effect imports and exported helpers", () => {
    const out = splitPlugin(
      `import "./polyfill.ts";
       export function util() {}
       export default definePlugin({ id: "a", name: "A", host: { start() {} } });`,
      "a.ts",
      "page",
    );
    expect(out).toContain('import "./polyfill.ts";');
    expect(out).toContain("export function util");
  });

  test("prunes unused pure constants that reference host imports", () => {
    const out = splitPlugin(
      `import Mpris from "mpris";
       const STATUS = { none: Mpris.NONE, all: [Mpris.ALL] } as const;
       const sideEffect = register(Mpris);
       export default definePlugin({ id: "a", name: "A", host: { start() { STATUS.none; } } });`,
      "a.ts",
      "page",
    );
    expect(out).not.toContain("STATUS");
    // Impure initializers stay (and keep their imports alive).
    expect(out).toContain("register(Mpris)");
  });

  test("supports a named plugin constant", () => {
    const out = splitPlugin(
      `import os from "node:os";
       const plugin = definePlugin({ id: "a", name: "A", host: { start() { os.arch(); } } });
       export default plugin;`,
      "a.ts",
      "page",
    );
    expect(out).not.toContain("node:os");
  });

  test("host code named only in types stays out of the page", () => {
    const out = splitPlugin(
      `import { Presence } from "./presence.ts";
       import { createNotifier } from "./notifier.ts";
       type Notifier = ReturnType<typeof createNotifier>;
       const presences = new WeakMap<object, Presence>();
       export default definePlugin({
         id: "a",
         name: "A",
         host: { start(ctx) { presences.set(ctx, new Presence(createNotifier() as Notifier)); } },
         page: (ctx) => { presences.get(ctx); },
       });`,
      "a.ts",
      "page",
    );
    expect(out).not.toContain("./presence.ts");
    expect(out).not.toContain("./notifier.ts");
    expect(out).toContain("new WeakMap()");
  });

  test("keeps JSX and the JSX pragma in .tsx files", () => {
    const out = splitPlugin(
      `/** @jsxImportSource @pear/sdk */
       import { Icon } from "@pear/sdk/dom";
       export default definePlugin({ id: "a", name: "A", page: () => { document.body.append(<Icon path="M0" />); } });`,
      "a.tsx",
      "page",
    );
    expect(out).toContain("@jsxImportSource @pear/sdk");
    expect(out).toContain('<Icon path="M0" />');
    expect(out).toContain('import { Icon } from "@pear/sdk/dom";');
  });

  test("rejects files without a plugin export", () => {
    expect(() => splitPlugin("export const x = 1;", "bad.ts", "page")).toThrow(/definePlugin/);
  });
});
