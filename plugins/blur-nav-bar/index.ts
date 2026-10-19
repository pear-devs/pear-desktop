import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "blur-nav-bar",
  name: "Blur navigation bar",
  description: "Makes the top bar translucent with a blur behind it.",
  config: {
    blur: config.number(8, { label: "Blur radius", min: 0, max: 32, step: 1, unit: "px" }),
    opacity: config.number(30, { label: "Background opacity", min: 0, max: 100, step: 5, unit: "%" }),
  },
  // Static CSS checked at build time; config flows in through custom properties.
  style: css`
    sel(nav_bar.background),
    sel(browse.header) {
      background: rgb(0 0 0 / var(--pear-nav-opacity, 0.3)) !important;
      backdrop-filter: blur(var(--pear-nav-blur, 8px)) !important;
    }
    sel(tabs) {
      backdrop-filter: blur(var(--pear-nav-blur, 8px)) !important;
    }
    sel(tabs.stuck) {
      background: rgb(0 0 0 / var(--pear-nav-opacity, 0.3)) !important;
    }
    sel(nav_bar.divider) {
      display: none !important;
    }
  `,
  page: {
    runAt: "start",
    start(ctx) {
      applyVariables(ctx.config);
      ctx.onCleanup(() => {
        document.documentElement.style.removeProperty("--pear-nav-blur");
        document.documentElement.style.removeProperty("--pear-nav-opacity");
      });
    },
    onConfigChange: applyVariables,
  },
});

function applyVariables(config: { blur: number; opacity: number }) {
  document.documentElement.style.setProperty("--pear-nav-blur", `${config.blur}px`);
  document.documentElement.style.setProperty("--pear-nav-opacity", String(config.opacity / 100));
}
