import { readFileSync } from "node:fs";
import { definePlugin } from "@pear/sdk";
import { css, sel } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "demo",
  name: "Demo",
  host: {
    start() {
      readFileSync("/HOST_ONLY_MARKER");
    },
  },
  page: () => {
    // TypeScript-only syntax must not trip up the macro expansion.
    const typed = (window as { demo?: { ready: boolean } }).demo;
    document.querySelector(sel("player_bar.next"));
    return () => void typed;
  },
  style: css`sel(nav_bar.divider) { display: none !important; }`,
});
