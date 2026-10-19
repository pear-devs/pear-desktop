import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { type Bootstrap, CHANNEL, type CoreCommandName, type CoreCommands } from "@pear/sdk/protocol";
import { YTM_ORIGIN } from "../shared/user-agent.ts";
import type { PlayerMirror } from "./player.ts";
import type { PluginHost } from "./plugins.ts";

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  const url = event.senderFrame?.url;
  return url !== undefined && URL.parse(url)?.origin === YTM_ORIGIN;
}

type Handlers = { [K in CoreCommandName]: (...args: Parameters<CoreCommands[K]>) => unknown };

export function setupIpc(plugins: PluginHost, player: PlayerMirror) {
  const handlers: Handlers = {
    ping: (message) => `pong: ${message}`,
    "app:version": () => app.getVersion(),
    "app:relaunch": () => {
      app.relaunch();
      app.exit(0);
    },
    "plugin:set-enabled": async (id, enabled) => void (await plugins.setEnabled(String(id), Boolean(enabled))),
    "plugin:set-config": async (id, patch) => {
      if (typeof patch !== "object" || patch === null) throw new Error("[pear] config patch must be an object");
      await plugins.setConfig(String(id), patch);
    },
    "plugin:invoke": (id, command, args) => {
      if (!Array.isArray(args)) throw new Error("[pear] plugin invoke args must be an array");
      return plugins.invoke(String(id), String(command), args);
    },
    "player:update": (state) => player.update(state),
  };

  ipcMain.handle(CHANNEL.invoke, (event, name: unknown, args: unknown) => {
    if (!isTrustedSender(event)) throw new Error("[pear] invoke from untrusted frame");
    if (typeof name !== "string" || !Object.hasOwn(handlers, name)) {
      throw new Error(`[pear] unknown command: ${String(name)}`);
    }
    if (!Array.isArray(args)) throw new Error("[pear] invoke args must be an array");
    return (handlers[name as CoreCommandName] as (...a: unknown[]) => unknown)(...args);
  });

  ipcMain.on(CHANNEL.bootstrap, (event) => {
    if (!isTrustedSender(event)) {
      event.returnValue = null;
      return;
    }
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      plugins: plugins.states(),
    } satisfies Bootstrap;
  });
}
