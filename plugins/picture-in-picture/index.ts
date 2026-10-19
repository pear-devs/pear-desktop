import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import type { Rectangle } from "electron";
import { matchesAccelerator } from "./accelerator.ts";

const PIP_ICON =
  "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z";
const DEFAULT_BOUNDS = { x: 10, y: 10, width: 450, height: 275 };
const SAVE_DELAY_MS = 500;
const LEAVE_FULLSCREEN_TIMEOUT_MS = 1000;
// The popup menu that opens right after a click on the player bar's menu button is the track's menu.
const MENU_CLICK_WINDOW_MS = 2000;

export default definePlugin({
  id: "picture-in-picture",
  name: "Picture in picture",
  description: "Watch in a small floating window, from the track menu or a hotkey.",
  config: {
    hotkey: config.shortcut("P", { label: "Hotkey", description: "Works while the window is focused." }),
    useNativePiP: config.bool(true, {
      label: "Use the browser's picture-in-picture",
      description: "Pops out just the video. Turn off to shrink the whole window, controls included.",
    }),
    alwaysOnTop: config.bool(true, { label: "Keep the small window on top" }),
    savePosition: config.bool(true, { label: "Remember the small window's position" }),
    saveSize: config.bool(false, { label: "Remember the small window's size" }),
  },
  host: {
    start(ctx) {
      const { window } = ctx;
      const file = join(ctx.app.getPath("userData"), "picture-in-picture.json");
      const load = (): Rectangle => {
        try {
          return { ...DEFAULT_BOUNDS, ...JSON.parse(readFileSync(file, "utf8")) };
        } catch {
          return DEFAULT_BOUNDS;
        }
      };
      let saved = load();
      let restore: { bounds: Rectangle; maximized: boolean; fullscreen: boolean } | undefined;

      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      const save = () => {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        writeFileSync(file, JSON.stringify(saved));
      };
      // The small window's current bounds.
      let current: Rectangle = DEFAULT_BOUNDS;
      const remember = () => {
        if (!restore || window.isDestroyed()) return;
        const { x, y, width, height } = window.getBounds();
        // Chromium re-asserts YTM's HTML full screen when the window regains focus,
        // which snaps it back to its normal size; keep it small.
        if (width === restore.bounds.width && height === restore.bounds.height) {
          window.setBounds(current);
          return;
        }
        current = { x, y, width, height };
        saved = {
          ...(ctx.config.savePosition ? { x, y } : { x: saved.x, y: saved.y }),
          ...(ctx.config.saveSize ? { width, height } : { width: saved.width, height: saved.height }),
        };
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, SAVE_DELAY_MS);
      };

      const enter = () => {
        if (restore) return;
        restore = { bounds: window.getNormalBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
        if (restore.fullscreen) window.setFullScreen(false);
        if (restore.maximized) window.unmaximize();
        window.setMaximizable(false);
        window.setFullScreenable(false);
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        if (ctx.config.alwaysOnTop) window.setAlwaysOnTop(true, "screen-saver", 1);
        const bounds = {
          ...(ctx.config.savePosition ? { x: saved.x, y: saved.y } : { x: DEFAULT_BOUNDS.x, y: DEFAULT_BOUNDS.y }),
          ...(ctx.config.saveSize ? { width: saved.width, height: saved.height } : DEFAULT_SIZE),
        };
        // The normal minimum size would keep the small window from shrinking.
        window.setMinimumSize(200, 120);
        current = bounds;
        window.setBounds(bounds);
        window.setWindowButtonVisibility?.(false);
        window.on("move", remember);
        window.on("resize", remember);
        ctx.emit("pip", true);
      };

      const exit = () => {
        if (!restore || window.isDestroyed()) return;
        const previous = restore;
        restore = undefined;
        window.off("move", remember);
        window.off("resize", remember);
        ctx.emit("pip", false);
        window.setAlwaysOnTop(false);
        window.setVisibleOnAllWorkspaces(false);
        window.setMaximizable(true);
        window.setWindowButtonVisibility?.(true);
        window.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height);
        window.setBounds(previous.bounds);
        if (previous.maximized) window.maximize();
        // Only once the page has left YTM's full screen, or the whole window would follow it.
        const finish = () => {
          clearTimeout(fallback);
          window.off("leave-html-full-screen", finish);
          if (window.isDestroyed() || restore) return;
          window.setFullScreenable(true);
          if (previous.fullscreen) window.setFullScreen(true);
        };
        const fallback = setTimeout(finish, LEAVE_FULLSCREEN_TIMEOUT_MS);
        window.on("leave-html-full-screen", finish);
      };

      pipControls.set(ctx, { toggle: () => (restore ? exit() : enter()), exit, active: () => !!restore });
      ctx.onCleanup(() => {
        exit();
        if (saveTimer) save();
        pipControls.delete(ctx);
      });
    },
    // Settings are read when entering the small window.
    onConfigChange() {},
    commands: {
      toggle() {
        pipControls.get(this)?.toggle();
        return pipControls.get(this)?.active() ?? false;
      },
      exit() {
        pipControls.get(this)?.exit();
      },
      active() {
        return pipControls.get(this)?.active() ?? false;
      },
    },
  },
  style: css`
    .pear-pip-drag {
      position: fixed;
      top: 0;
      left: 56px;
      right: 56px;
      height: 32px;
      z-index: 2147483647;
      -webkit-app-region: drag;
    }
    .pear-pip-item {
      display: flex;
      align-items: center;
      gap: 16px;
      height: 48px;
      padding: 0 16px;
      color: var(--ytmusic-text-primary, #fff);
      font: 400 14px Roboto, "Noto Naskh Arabic UI", Arial, sans-serif;
      cursor: pointer;
    }
    .pear-pip-item:hover,
    .pear-pip-item:focus-visible {
      background: rgb(255 255 255 / 0.1);
      outline: none;
    }
    .pear-pip-item svg {
      width: 24px;
      height: 24px;
      fill: rgb(255 255 255 / 0.7);
    }
  `,
  page: (ctx) => {
    const root = document.documentElement;
    // The small window shows YTM's own full-screen player; the window is not
    // full-screenable meanwhile, so it fills just the small window.
    const dragStrip = document.createElement("div");
    dragStrip.className = "pear-pip-drag";
    let pip = false;
    const setPip = (active: boolean) => {
      pip = active;
      root.classList.toggle("pear-pip", active);
      const fullscreen = ctx.$("player.container")?.getAttribute("player-ui-state") === "FULLSCREEN";
      if (active) {
        if (!fullscreen) ctx.$("player.fullscreen_button")?.click();
        document.body.append(dragStrip);
      } else {
        dragStrip.remove();
        if (document.fullscreenElement) void document.exitFullscreen();
      }
    };
    ctx.host.on("pip", (active) => setPip(active === true));
    ctx.onCleanup(() => {
      if (pip) setPip(false);
      root.classList.remove("pear-pip");
    });
    void ctx.host.invoke("active").then((active) => setPip(active === true));
    // Leaving YTM's full screen (its button, or Escape) leaves the small window too.
    ctx.listen(document, "fullscreenchange", () => {
      if (pip && !document.fullscreenElement) void ctx.host.invoke("exit");
    });

    const toggle = async () => {
      if (ctx.config.useNativePiP) {
        try {
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else await ctx.player.video()?.requestPictureInPicture();
          return;
        } catch (error) {
          ctx.log.warn("native picture-in-picture failed; shrinking the window instead", error);
        }
      }
      await ctx.host.invoke("toggle");
    };

    const isMac = navigator.platform.startsWith("Mac");
    ctx.listen(
      window,
      "keydown",
      (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
        if (pip && event.key === "Escape") {
          event.preventDefault();
          void ctx.host.invoke("exit");
          return;
        }
        if (!matchesAccelerator(event, ctx.config.hotkey, isMac)) return;
        event.preventDefault();
        void toggle();
      },
      { capture: true },
    );

    // A "Picture in picture" entry in the current track's menu.
    const item = document.createElement("div");
    item.className = "pear-pip-item";
    item.setAttribute("role", "option");
    item.tabIndex = -1;
    item.append(icon(PIP_ICON), "Picture in picture");
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      // Close YTM's menu the way it closes itself.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      void toggle();
    });
    ctx.onCleanup(() => item.remove());

    let menuClickedAt = 0;
    ctx.listen(
      document,
      "click",
      (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest(ctx.sel("player_bar.menu_button"))) {
          menuClickedAt = Date.now();
        } else if (!(event.target instanceof Element && event.target.closest(ctx.sel("popup.listbox")))) {
          menuClickedAt = 0;
        }
      },
      { capture: true },
    );
    const placeItem = () => {
      const listbox = ctx.$("popup.listbox");
      if (!listbox) return;
      const forTrack = Date.now() - menuClickedAt < MENU_CLICK_WINDOW_MS;
      if (forTrack && item.parentElement !== listbox) listbox.prepend(item);
      else if (!forTrack && item.isConnected) item.remove();
    };
    void ctx.waitFor("popup.container").then((container) => {
      const observer = new MutationObserver(placeItem);
      observer.observe(container, { childList: true, subtree: true });
      ctx.onCleanup(() => observer.disconnect());
    }, () => {});
  },
});

const DEFAULT_SIZE = { width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height };
// The main window's minimum size (apps/desktop), restored when leaving the small window.
const MIN_SIZE = { width: 360, height: 300 };

const pipControls = new WeakMap<object, { toggle(): void; exit(): void; active(): boolean }>();

function icon(d: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}
