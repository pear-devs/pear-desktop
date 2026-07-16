import { app } from "electron";

import * as config from "@/config";
import { restart } from "@/providers/app-controls";
import { createBackend } from "@/utils";

import type { SettingsUIConfig } from "./index";

export const backend = createBackend<
  { unwatch: (() => void) | undefined },
  SettingsUIConfig
>({
  unwatch: undefined as (() => void) | undefined,

  start(ctx) {
    const { ipc, window } = ctx;

    ipc.handle("ytmd-sui:load-store", () => config.getStore());

    ipc.handle("ytmd-sui:option-set", (key: string, value: unknown) => {
      config.set(key, value);
    });

    ipc.handle("ytmd-sui:plugin-toggle", (id: string, enabled: boolean) => {
      if (enabled) config.plugins.enable(id);
      else config.plugins.disable(id);
    });

    ipc.handle("ytmd-sui:config-edit", () => config.edit());
    ipc.handle("ytmd-sui:toggle-devtools", () =>
      window.webContents.toggleDevTools(),
    );
    ipc.handle("ytmd-sui:restart", () => restart());
    ipc.handle("ytmd-sui:app-meta", () => ({
      version: app.getVersion(),
      platform: process.platform,
    }));

    this.unwatch = config.watch(() => {
      window.webContents.send("ytmd-sui:store-changed", config.getStore());
    });
  },

  stop(ctx) {
    this.unwatch?.();
    this.unwatch = undefined;

    for (const channel of [
      "ytmd-sui:load-store",
      "ytmd-sui:option-set",
      "ytmd-sui:plugin-toggle",
      "ytmd-sui:config-edit",
      "ytmd-sui:toggle-devtools",
      "ytmd-sui:restart",
      "ytmd-sui:app-meta",
    ]) {
      ctx.ipc.removeHandler(channel);
    }
  },
});
