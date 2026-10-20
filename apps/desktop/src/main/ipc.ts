import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from "electron";
import { isCoreSection, type CoreSection } from "@pear/sdk/core-config";
import {
  type Bootstrap,
  CHANNEL,
  type CoreCommandName,
  type CoreCommands,
  type CoreState,
} from "@pear/sdk/protocol";
import { isSettingsUrl, isYtmUrl } from "../shared/user-agent.ts";
import type { PageRequests } from "./page-requests.ts";
import type { PlayerMirror } from "./player.ts";
import type { PluginHost } from "./plugins.ts";

/** YTM (with the page runtime) and the standalone settings window. */
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  const frame = event.senderFrame;
  // Only top-level frames: an iframe on YTM's origin is not the runtime.
  if (!frame || frame.parent) return false;
  return isYtmUrl(frame.url) || isSettingsUrl(frame.url);
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
    setConfig(section: CoreSection, patch: Record<string, unknown>): void | Promise<void>;
    /** The theme files' CSS. */
    themes(): string[];
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
        if (isYtmUrl(window.webContents.getURL())) window.webContents.toggleDevTools();
      }
    },
    "player:update": (state) => player.update(state),
  };

  ipcMain.handle(CHANNEL.invoke, (event, name: unknown, args: unknown) => {
    if (!isTrustedSender(event)) throw new Error("[pear] invoke from untrusted frame");
    // Only the page runtime answers requests and reports the player.
    if ((name === "plugin:respond" || name === "player:update") && !isYtmUrl(event.senderFrame!.url)) {
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
    if (isYtmUrl(event.senderFrame!.url)) onRuntimeBootstrap(event.sender);
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      plugins: plugins.states(),
      meta: plugins.meta(),
      errors: plugins.errors(),
      statuses: plugins.statuses(),
      core: core.states(),
      app: {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      },
      themes: core.themes(),
      language: plugins.i18n?.language ?? "en",
      strings: plugins.i18n?.strings ?? {},
      catalog: plugins.plugins.map((plugin) => {
        // pear-desktop's translated plugin names and descriptions, where they exist.
        const t = plugins.t;
        const description = plugin.description ? t(`plugins.${plugin.id}.description`, plugin.description) : undefined;
        const actions = Object.entries((plugin.actions ?? {}) as Record<string, { label: string; description?: string } | undefined>).flatMap(
          ([name, action]) => {
            if (!action) return [];
            const key = `plugins.${plugin.id}.actions.${name}`;
            const actionDescription = action.description ? t(`${key}.description`, action.description) : undefined;
            return [{ name, label: t(`${key}.label`, action.label), ...(actionDescription ? { description: actionDescription } : {}) }];
          },
        );
        return {
          id: plugin.id,
          name: t(`plugins.${plugin.id}.name`, plugin.name),
          ...(description ? { description } : {}),
          config: plugin.config ?? {},
          ...(actions.length > 0 ? { actions } : {}),
        };
      }),
    } satisfies Bootstrap;
  });
}
