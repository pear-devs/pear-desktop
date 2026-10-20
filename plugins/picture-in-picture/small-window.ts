// The "small window" mode: the main window shrinks to a floating, always-on-top
// window showing YTM's full-screen player.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostContextOf } from "@pear/sdk";
import { debounce } from "@pear/sdk/util";
import type { Rectangle } from "electron";
import type { pipConfig } from "./config.ts";

type Ctx = HostContextOf<typeof pipConfig>;
type Point = Pick<Rectangle, "x" | "y">;
type Size = Pick<Rectangle, "width" | "height">;

const DEFAULT_BOUNDS: Rectangle = { x: 10, y: 10, width: 450, height: 275 };
// The main window's minimum size (apps/desktop), restored when leaving the small window.
const MAIN_MIN_SIZE: Size = { width: 360, height: 300 };
// The main window's minimum size would keep the small window from shrinking.
const SMALL_MIN_SIZE: Size = { width: 200, height: 120 };
// Above other always-on-top windows, full-screen ones included.
const ON_TOP_LEVEL = "screen-saver";
const ON_TOP_RELATIVE_LEVEL = 1;
const SAVE_DELAY_MS = 500;
const LEAVE_FULLSCREEN_TIMEOUT_MS = 1000;

const rectangle = (position: Point, size: Size): Rectangle => ({
  x: position.x,
  y: position.y,
  width: size.width,
  height: size.height,
});

/** How the main window was before it shrank, to put it back. */
interface Restore {
  bounds: Rectangle;
  maximized: boolean;
  fullscreen: boolean;
  /** The core "Always on top" option keeps the window there (at the default level). */
  alwaysOnTop: boolean;
}

/** The small window's position and size, remembered in userData as pear-desktop did. */
class SavedBounds {
  readonly #file: string;
  #bounds: Rectangle;
  #pending = false;
  readonly #writeLater = debounce(() => this.flush(), SAVE_DELAY_MS);

  constructor(file: string) {
    this.#file = file;
    this.#bounds = SavedBounds.#load(file);
  }

  static #load(file: string): Rectangle {
    try {
      return { ...DEFAULT_BOUNDS, ...JSON.parse(readFileSync(file, "utf8")) };
    } catch {
      return DEFAULT_BOUNDS;
    }
  }

  get bounds() {
    return this.#bounds;
  }

  set(bounds: Rectangle) {
    this.#bounds = bounds;
    this.#pending = true;
    this.#writeLater();
  }

  /** Writes a pending change now. */
  flush() {
    if (!this.#pending) return;
    this.#writeLater.cancel();
    this.#pending = false;
    writeFileSync(this.#file, JSON.stringify(this.#bounds));
  }
}

export class SmallWindow {
  readonly #ctx: Ctx;
  readonly #saved: SavedBounds;
  #restore: Restore | undefined;
  /** The small window's current bounds. */
  #current: Rectangle = DEFAULT_BOUNDS;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    this.#saved = new SavedBounds(join(ctx.app.getPath("userData"), "picture-in-picture.json"));
  }

  get active() {
    return !!this.#restore;
  }

  toggle() {
    if (this.#restore) this.exit();
    else this.enter();
  }

  enter() {
    if (this.#restore) return;
    const { window, config } = this.#ctx;
    this.#restore = {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
      alwaysOnTop: window.isAlwaysOnTop(),
    };
    if (this.#restore.fullscreen) window.setFullScreen(false);
    if (this.#restore.maximized) window.unmaximize();
    window.setMaximizable(false);
    window.setFullScreenable(false);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (config.alwaysOnTop) window.setAlwaysOnTop(true, ON_TOP_LEVEL, ON_TOP_RELATIVE_LEVEL);

    const saved = this.#saved.bounds;
    const position = config.savePosition ? saved : DEFAULT_BOUNDS;
    const size = config.saveSize ? saved : DEFAULT_BOUNDS;
    this.#current = rectangle(position, size);
    window.setMinimumSize(SMALL_MIN_SIZE.width, SMALL_MIN_SIZE.height);
    window.setBounds(this.#current);
    window.setWindowButtonVisibility?.(false);
    window.on("move", this.#remember);
    window.on("resize", this.#remember);
    this.#ctx.emit("pip", true);
  }

  exit() {
    const { window } = this.#ctx;
    const previous = this.#restore;
    if (!previous || window.isDestroyed()) return;
    this.#restore = undefined;
    window.off("move", this.#remember);
    window.off("resize", this.#remember);
    this.#ctx.emit("pip", false);
    window.setAlwaysOnTop(previous.alwaysOnTop);
    window.setVisibleOnAllWorkspaces(false);
    window.setMaximizable(true);
    window.setWindowButtonVisibility?.(true);
    window.setMinimumSize(MAIN_MIN_SIZE.width, MAIN_MIN_SIZE.height);
    window.setBounds(previous.bounds);
    if (previous.maximized) window.maximize();
    this.#restoreFullScreen(previous);
  }

  /** Stops, writing the remembered bounds if a write is pending. */
  dispose() {
    this.exit();
    this.#saved.flush();
  }

  // Only once the page has left YTM's full screen, or the whole window would follow it.
  #restoreFullScreen(previous: Restore) {
    const { window } = this.#ctx;
    // A plain timer: it must still run when exiting because the plugin stopped.
    const fallback = setTimeout(() => finish(), LEAVE_FULLSCREEN_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(fallback);
      window.off("leave-html-full-screen", finish);
      if (window.isDestroyed() || this.#restore) return;
      window.setFullScreenable(true);
      if (previous.fullscreen) window.setFullScreen(true);
    };
    window.on("leave-html-full-screen", finish);
  }

  readonly #remember = () => {
    const { window, config } = this.#ctx;
    if (!this.#restore || window.isDestroyed()) return;
    const bounds = window.getBounds();
    // Chromium re-asserts YTM's HTML full screen when the window regains focus,
    // which snaps it back to its normal size; keep it small.
    const snappedBack = bounds.width === this.#restore.bounds.width && bounds.height === this.#restore.bounds.height;
    if (snappedBack) {
      window.setBounds(this.#current);
      return;
    }
    this.#current = bounds;
    const saved = this.#saved.bounds;
    const position = config.savePosition ? bounds : saved;
    const size = config.saveSize ? bounds : saved;
    this.#saved.set(rectangle(position, size));
  };
}
