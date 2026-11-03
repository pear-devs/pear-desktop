import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, shell } from "electron";
import { pluginActions } from "@pear/sdk";
import { isCoreSection, type CoreSection } from "@pear/sdk/core-config";
import {
  type Bootstrap,
  CHANNEL,
  type CoreCommandName,
  type CoreCommands,
  type CoreState,
  type PluginInfo,
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

/** The page runtime of a YTM window; trusted senders only. */
function isPageRuntime(event: IpcMainInvokeEvent | IpcMainEvent) {
  return isYtmUrl(event.senderFrame!.url);
}

/** Commands only the page runtime sends: it answers requests and reports the player. */
const PAGE_RUNTIME_COMMANDS = new Set<unknown>(["plugin:respond", "player:update"]);

function assertPatch(patch: unknown): asserts patch is Record<string, unknown> {
  if (typeof patch !== "object" || patch === null) throw new Error("[pear] config patch must be an object");
}

type Handlers = { [K in CoreCommandName]: (...args: Parameters<CoreCommands[K]>) => unknown };

export interface IpcEnvironment {
  plugins: PluginHost;
  player: PlayerMirror;
  requests: PageRequests;
  settingsPath: string;
  /** The page runtime of the main window has bootstrapped (it can show the in-page settings). */
  onRuntimeBootstrap(sender: Electron.WebContents): void;
  /** Whether the main window is on screen. */
  windowVisible(): boolean;
  core: {
    states(): Record<CoreSection, CoreState>;
    setConfig(section: CoreSection, patch: Record<string, unknown>): void | Promise<void>;
    /** The theme files' CSS. */
    themes(): string[];
  };
}

export function setupIpc({ plugins, player, requests, settingsPath, onRuntimeBootstrap, windowVisible, core }: IpcEnvironment) {
  const handlers: Handlers = {
    ping: (message) => `pong: ${message}`,
    "app:version": () => app.getVersion(),
    "app:relaunch": () => {
      app.relaunch();
      app.exit(0);
    },
    "plugin:set-enabled": async (id, enabled) => void (await plugins.setEnabled(String(id), Boolean(enabled))),
    "plugin:set-config": async (id, patch) => {
      assertPatch(patch);
      await plugins.setConfig(String(id), patch);
    },
    "plugin:invoke": (id, command, args) => {
      if (!Array.isArray(args)) throw new Error("[pear] plugin invoke args must be an array");
      return plugins.invoke(String(id), String(command), args);
    },
    "plugin:respond": (requestId, ok, value) => requests.respond(Number(requestId), Boolean(ok), value),
    "core:set-config": async (section, patch) => {
      if (!isCoreSection(String(section))) throw new Error(`[pear] unknown settings section: ${String(section)}`);
      assertPatch(patch);
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
    if (PAGE_RUNTIME_COMMANDS.has(name) && !isPageRuntime(event)) {
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
    if (isPageRuntime(event)) onRuntimeBootstrap(event.sender);
    event.returnValue = { ...bootstrapPayload(plugins, core), windowVisible: windowVisible() };
  });
}

function bootstrapPayload(plugins: PluginHost, core: IpcEnvironment["core"]): Omit<Bootstrap, "windowVisible"> {
  return {
    // Also in `app`: the page runtime reads these, the settings UI the copies there.
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
    catalog: pluginCatalog(plugins),
  };
}

/** Plugins in settings-UI form, with pear-desktop's translated names and descriptions where they exist. */
function pluginCatalog({ plugins, t }: PluginHost): PluginInfo[] {
  return plugins.map((plugin) => {
    const description = plugin.description ? t(`plugins.${plugin.id}.description`, plugin.description) : undefined;
    const actions = pluginActions(plugin).map(([name, action]) => {
      const key = `plugins.${plugin.id}.actions.${name}`;
      const actionDescription = action.description ? t(`${key}.description`, action.description) : undefined;
      return { name, label: t(`${key}.label`, action.label), ...(actionDescription ? { description: actionDescription } : {}) };
    });
    return {
      id: plugin.id,
      name: t(`plugins.${plugin.id}.name`, plugin.name),
      ...(description ? { description } : {}),
      config: plugin.config ?? {},
      ...(actions.length > 0 ? { actions } : {}),
    };
  });
}
