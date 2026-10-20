import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from "electron";
import { isCoreSection, type CoreSection } from "@pear/sdk/core-config";
import {
  type Bootstrap,
  CHANNEL,
  type CoreCommandName,
  type CoreCommands,
  type CoreState,
} from "@pear/sdk/protocol";
import { isSettingsUrl, YTM_ORIGIN } from "../shared/user-agent.ts";
import type { PageRequests } from "./page-requests.ts";
import type { PlayerMirror } from "./player.ts";
import type { PluginHost } from "./plugins.ts";

/** YTM (with the page runtime) and the standalone settings window. */
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  const frame = event.senderFrame;
  // Only top-level frames: an iframe on YTM's origin is not the runtime.
  if (!frame || frame.parent) return false;
  return URL.parse(frame.url)?.origin === YTM_ORIGIN || isSettingsUrl(frame.url);
}

type Handlers = { [K in CoreCommandName]: (...args: Parameters<CoreCommands[K]>) => unknown };

export interface IpcEnvironment {
  plugins: PluginHost;
  player: PlayerMirror;
  requests: PageRequests;
  settingsPath: string;
  /** The page runtime of the main window has bootstrapped (it can show the in-page settings). */
  onRuntimeBootstrap(sender: Electron.WebContents): void;
  core: {
    states(): Record<CoreSection, CoreState>;
    setConfig(section: CoreSection, patch: Record<string, unknown>): Promise<void>;
  };
}

export function setupIpc({ plugins, player, requests, settingsPath, onRuntimeBootstrap, core }: IpcEnvironment) {
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
    "plugin:respond": (requestId, ok, value) => requests.respond(Number(requestId), Boolean(ok), value),
    "core:set-config": async (section, patch) => {
      if (!isCoreSection(String(section))) throw new Error(`[pear] unknown settings section: ${String(section)}`);
      if (typeof patch !== "object" || patch === null) throw new Error("[pear] config patch must be an object");
      await core.setConfig(section, patch);
    },
    "app:show-settings-file": () => shell.showItemInFolder(settingsPath),
    "app:toggle-devtools": () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (URL.parse(window.webContents.getURL())?.origin === YTM_ORIGIN) window.webContents.toggleDevTools();
      }
    },
    "player:update": (state) => player.update(state),
  };

  ipcMain.handle(CHANNEL.invoke, (event, name: unknown, args: unknown) => {
    if (!isTrustedSender(event)) throw new Error("[pear] invoke from untrusted frame");
    // Only the page runtime answers requests and reports the player.
    if ((name === "plugin:respond" || name === "player:update") && URL.parse(event.senderFrame!.url)?.origin !== YTM_ORIGIN) {
      throw new Error(`[pear] ${name} is for the page runtime`);
    }
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
    if (URL.parse(event.senderFrame!.url)?.origin === YTM_ORIGIN) onRuntimeBootstrap(event.sender);
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      plugins: plugins.states(),
      meta: plugins.meta(),
      errors: plugins.errors(),
      core: core.states(),
      app: {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      catalog: plugins.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        ...(plugin.description ? { description: plugin.description } : {}),
        config: plugin.config ?? {},
      })),
    } satisfies Bootstrap;
  });
}
