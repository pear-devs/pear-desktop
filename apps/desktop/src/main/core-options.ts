// The core settings sections the app applies itself (the API server applies
// its own): their state for the settings UI and the page, and the options that
// take effect live.

import { app } from "electron";
import type { CoreSection } from "@pear/sdk/core-config";
import type { Translate } from "@pear/sdk/i18n";
import type { CoreState } from "@pear/sdk/protocol";
import type { Settings } from "./config.ts";
import { type MainWindow, windowTitle } from "./main-window.ts";
import { applyHideMenu, syncMenu } from "./menu.ts";
import { Themes } from "./themes.ts";

export type AppSection = Exclude<CoreSection, "apiServer">;

export class CoreOptions {
  readonly themes: Themes;
  #settings: Settings;
  #t: Translate;
  #mainWindow: MainWindow;

  constructor(settings: Settings, t: Translate, mainWindow: MainWindow) {
    this.#settings = settings;
    this.#t = t;
    this.#mainWindow = mainWindow;
    this.themes = new Themes(() => {
      mainWindow.send({ type: "themes", css: this.themes.css });
      mainWindow.send({ type: "core-state", section: "appearance", state: this.state("appearance") });
    });
  }

  /** Reads and watches the theme files. */
  start() {
    this.themes.set(this.#settings.core("appearance").themes);
  }

  stop() {
    this.themes.stop();
  }

  /** A section's state for the settings UI and the page. */
  state(section: AppSection): CoreState {
    const state: CoreState = { config: this.#settings.core(section) };
    if (section === "appearance" && this.themes.missing.length > 0) state.error = this.#missingThemes();
    return state;
  }

  states(): Record<AppSection, CoreState> {
    return {
      general: this.state("general"),
      window: this.state("window"),
      appearance: this.state("appearance"),
      advanced: this.state("advanced"),
      site: this.state("site"),
    };
  }

  /** Applies the options that take effect live. */
  apply(section: CoreSection) {
    if (section === "window") this.#applyWindow();
    else if (section === "appearance") this.#applyAppearance();
  }

  /** Changes options like the settings UI does (and tells it). */
  set(section: AppSection, patch: Record<string, unknown>) {
    this.#settings.setCore(section, patch);
    this.apply(section);
    this.#mainWindow.send({ type: "core-state", section, state: this.state(section) });
  }

  #applyWindow() {
    const options = this.#settings.core("window");
    syncMenu(options.alwaysOnTop);
    const window = this.#mainWindow.window;
    if (!window) return;
    window.setAlwaysOnTop(options.alwaysOnTop);
    if (process.platform !== "darwin") applyHideMenu(window, options.hideMenu);
    if (process.platform === "win32" || process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: options.startAtLogin, args: [] });
    }
  }

  #applyAppearance() {
    // The page applies the rest itself (core-state events).
    if (this.themes.set(this.#settings.core("appearance").themes)) this.#mainWindow.send({ type: "themes", css: this.themes.css });
    const window = this.#mainWindow.window;
    if (window) window.setTitle(windowTitle(this.#settings, window));
  }

  #missingThemes() {
    return this.themes.missing
      .map((cssFile) => this.#t("main.console.theme.css-file-not-found", 'CSS file "{{cssFile}}" does not exist, ignoring', { cssFile }))
      .join("\n");
  }
}
