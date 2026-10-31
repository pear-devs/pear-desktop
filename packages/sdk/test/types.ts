// Compile-time contract of the SDK, checked by `tsc` (nub run typecheck).

import { config, definePlugin } from "../src/index.ts";
import { v } from "../src/rpc.ts";

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

// RPC: the input type comes from the valibot schema; `this` is the host context.
definePlugin({
  id: "rpc",
  name: "RPC",
  config: { prefix: config.string("x", { label: "Prefix" }) },
  host: {
    rpc: {
      greet: {
        summary: "Greets someone",
        input: v.object({ name: v.string(), times: v.optional(v.number()) }),
        run({ name, times }) {
          const prefix: string = this.config.prefix;
          const count: number | undefined = times;
          // @ts-expect-error name is a string
          const wrong: number = name;
          void [count, wrong];
          return `${prefix} ${name}`;
        },
      },
      noInput: {
        input: v.optional(v.object({})),
        run(input) {
          // @ts-expect-error unknown field
          void input?.missing;
        },
      },
    },
  },
});
