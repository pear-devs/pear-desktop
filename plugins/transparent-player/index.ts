import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import type { BrowserWindow } from "electron";

const OPAQUE_BACKGROUND = "#030303";
const WINDOWS_MATERIALS = ["mica", "acrylic", "tabbed"] as const;
const MACOS_MATERIALS = ["window", "fullscreen-ui", "content", "under-window", "under-page"] as const;

type Material = "none" | (typeof WINDOWS_MATERIALS)[number] | (typeof MACOS_MATERIALS)[number];

export default definePlugin({
  id: "transparent-player",
  name: "Transparent player",
  description: "Makes the window see-through, with a blurred material behind it on Windows 11 and macOS.",
  config: {
    opacity: config.number(50, { label: "Background opacity", min: 0, max: 100, step: 5, unit: "%" }),
    type: config.select(
      "none",
      [
        { value: "none", label: "None (plain transparency)" },
        { value: "mica", label: "Mica (Windows 11)" },
        { value: "acrylic", label: "Acrylic (Windows 11)" },
        { value: "tabbed", label: "Tabbed (Windows 11)" },
        { value: "window", label: "Window (macOS)" },
        { value: "fullscreen-ui", label: "Full-screen UI (macOS)" },
        { value: "content", label: "Content (macOS)" },
        { value: "under-window", label: "Under window (macOS)" },
        { value: "under-page", label: "Under page (macOS)" },
      ],
      {
        label: "Material",
        description: "Blurs what's behind the window. Linux compositors only support plain transparency.",
      },
    ),
  },
  host: {
    // A window can only be made transparent when it is created.
    windowOptions: () => ({ transparent: true, backgroundColor: "#00000000" }),
    start(ctx) {
      applyMaterial(ctx.window, ctx.config.type);
      ctx.window.setBackgroundColor("#00000000");
      ctx.onCleanup(() => {
        if (ctx.window.isDestroyed()) return;
        applyMaterial(ctx.window, "none");
        ctx.window.setBackgroundColor(OPAQUE_BACKGROUND);
      });
    },
    onConfigChange(config, ctx) {
      applyMaterial(ctx.window, config.type);
    },
  },
  style: css`
    :root {
      --pear-transparent-tint: rgb(17 17 17 / var(--pear-transparent-opacity, 0.5));
      --pear-transparent-tint-dark: rgb(17 17 17 / 0.8);
      --pear-transparent-blur: blur(20px);
    }
    html {
      background: transparent !important;
    }
    body {
      background: var(--pear-transparent-tint) !important;
    }
    sel(browse.background) {
      display: none !important;
    }
    sel(guide.background),
    sel(guide.mini_background),
    sel(player_bar),
    sel(player.page),
    sel(browse.gradient) {
      background: none !important;
      border: 0 !important;
    }
    sel(nav_bar.background),
    sel(player_bar.background) {
      background: var(--pear-transparent-tint-dark) !important;
      backdrop-filter: var(--pear-transparent-blur) !important;
    }
    sel(app.layout)[player-page-open] sel(nav_bar.background),
    sel(app.layout)[player-page-open] sel(player_bar.background) {
      background: none !important;
    }
    sel(tabs.stuck),
    sel(popup.menu) {
      background: var(--pear-transparent-tint) !important;
      backdrop-filter: var(--pear-transparent-blur) !important;
    }
  `,
  page: {
    runAt: "start",
    start(ctx) {
      // Shared with album-color-theme, which mixes its colors at this opacity.
      ctx.addStyle(`:root{--pear-transparent-opacity:${ctx.config.opacity / 100}}`);
    },
  },
});

function applyMaterial(window: BrowserWindow, material: Material) {
  if (process.platform === "win32") {
    window.setBackgroundMaterial((WINDOWS_MATERIALS as readonly string[]).includes(material) ? (material as "mica") : "none");
  } else if (process.platform === "darwin") {
    window.setVibrancy((MACOS_MATERIALS as readonly string[]).includes(material) ? (material as "window") : null);
  }
}
