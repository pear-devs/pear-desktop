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
    document.querySelector(sel("player_bar.next"));
  },
  style: css`sel(nav_bar.divider) { display: none !important; }`,
});
