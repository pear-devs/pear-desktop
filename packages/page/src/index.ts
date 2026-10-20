/// <reference path="./virtual.d.ts" />
// Page runtime: runs in YTM's main world before any of its own
// scripts. Boots the player facade and the plugin runner.

import type { NowPlaying } from "@pear/sdk";
import type { Bridge } from "@pear/sdk/protocol";
import { mountSettings, type SettingsController } from "@pear/ui";
import plugins from "virtual:pear/page-plugins";
import { registerApiHandlers } from "./api.ts";
import { Appearance } from "./appearance.ts";
import { domReady } from "./dom.ts";
import { Player } from "./player.ts";
import { PluginRunner } from "./plugins.ts";

export interface RuntimeMarker {
  /** performance.now() at the moment the runtime executed. */
  injectedAt: number;
  /** document.readyState when the runtime executed; "loading" means before the page parsed. */
  readyState: DocumentReadyState;
  /** Number of <script> elements already in the document when the runtime executed. */
  scriptsBefore: number;
}

export interface Runtime {
  readonly marker: RuntimeMarker;
  readonly player: Player;
  readonly plugins: PluginRunner;
  /** Available once the document has loaded. */
  readonly settings: SettingsController | undefined;
}

declare global {
  interface Window {
    __pear?: Bridge;
    __pearRuntime?: Runtime;
  }
}

const marker: RuntimeMarker = {
  injectedAt: performance.now(),
  readyState: document.readyState,
  scriptsBefore: document.scripts.length,
};

const bridge = window.__pear;
if (!bridge) throw new Error("[pear] bridge missing; preload did not expose __pear");

// Position-only updates are batched; everything else goes to the host at once.
const POSITION_PUBLISH_MS = 1000;
let lastPublished = 0;
let pending: ReturnType<typeof setTimeout> | undefined;
let latest: NowPlaying | undefined;
function publish(state: NowPlaying, urgent: boolean) {
  latest = state;
  const send = () => {
    pending = undefined;
    lastPublished = Date.now();
    if (latest) void bridge!.invoke("player:update", latest);
  };
  if (urgent || Date.now() - lastPublished >= POSITION_PUBLISH_MS) {
    clearTimeout(pending);
    send();
  } else {
    pending ??= setTimeout(send, POSITION_PUBLISH_MS);
  }
}

const player = new Player(publish, () => runner.core("appearance").config);
const runner = new PluginRunner(plugins, bridge, player);
const appearance = new Appearance();
appearance.apply(runner.core("appearance"));
appearance.setThemes(bridge.bootstrap.themes);

bridge.onEvent((event) => {
  switch (event.type) {
    case "plugin-state":
      return runner.applyState(event.id, event.state);
    case "plugin-event":
      return runner.dispatch(event.id, event.event, event.payload);
    case "plugin-error":
      return runner.reportError(event.id, event.message, "host");
    case "plugin-request":
      return void runner.request(event.id, event.event, event.payload, event.requestId);
    case "core-state":
      runner.applyCore(event.section, event.state);
      if (event.section === "appearance") {
        appearance.apply(event.state);
        player.refreshTrack();
      }
      return;
    case "themes":
      return appearance.setThemes(event.css);
    case "player-control":
      return player.control(event.action);
    case "ui":
      return void domReady().then(() => {
        if (event.action === "open-settings") settings?.open();
        else if (event.action === "close-settings") settings?.close();
        else settings?.toggle();
      });
  }
});

let settings: SettingsController | undefined;

window.__pearRuntime = Object.freeze({
  marker,
  player,
  plugins: runner,
  get settings() {
    return settings;
  },
});
console.info("[pear] runtime injected", marker);

registerApiHandlers(runner, player);
runner.startEnabled();
void domReady().then(() => {
  settings = mountSettings(runner);
});
