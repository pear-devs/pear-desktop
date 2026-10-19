import { definePlugin } from "@pear/sdk";
import { sel } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "broken",
  name: "Broken",
  // @ts-expect-error intentionally unknown
  page: () => document.querySelector(sel("does.not.exist")),
});
