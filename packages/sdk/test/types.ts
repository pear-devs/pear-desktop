// Compile-time contract of the SDK, checked by `tsc` (nub run typecheck).

import { config, definePlugin } from "../src/index.ts";

definePlugin({
  id: "typed",
  name: "Typed",
  config: {
    count: config.number(1, { label: "Count" }),
    mode: config.select("a", [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ], { label: "Mode" }),
  },
  host: {
    commands: {
      add(a: number, b: number) {
        // `this` is the host context with the typed config.
        const count: number = this.config.count;
        return a + b + count;
      },
    },
  },
  page: async (ctx) => {
    const sum: number = await ctx.host.invoke("add", 1, 2);
    const mode: "a" | "b" = ctx.config.mode;
    ctx.$("player_bar");
    // @ts-expect-error unknown command
    await ctx.host.invoke("missing");
    // @ts-expect-error wrong argument type
    await ctx.host.invoke("add", "1", 2);
    // @ts-expect-error unknown selector name
    ctx.$("not-a-selector");
    // @ts-expect-error config values keep their types
    const wrong: string = ctx.config.count;
    void [sum, mode, wrong];
  },
});
