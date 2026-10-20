// Runs in an isolated world before the page's scripts, on every top-level page
// the window navigates to. On YTM it exposes the bridge and injects
// the page runtime (with all plugin page parts); in the standalone settings
// window it only exposes the bridge. Other origins (e.g. Google sign-in) are
// left alone.

import { contextBridge, ipcRenderer } from "electron";
import type { Bootstrap, Bridge, HostEvent } from "@pear/sdk/protocol";
import { CHANNEL, SETTINGS_ORIGIN } from "@pear/sdk/protocol";
import pageRuntime from "virtual:pear/page-runtime";
import { YTM_ORIGIN } from "../shared/user-agent.ts";

const isYtm = location.origin === YTM_ORIGIN;
if (isYtm || location.origin === SETTINGS_ORIGIN) {
  const bootstrap = ipcRenderer.sendSync(CHANNEL.bootstrap) as Bootstrap | null;
  if (bootstrap) {
    const listeners = new Set<(event: HostEvent) => void>();
    ipcRenderer.on(CHANNEL.event, (_, event: HostEvent) => {
      for (const listener of listeners) listener(event);
    });

    const bridge: Bridge = {
      bootstrap,
      invoke: (name, ...args) => ipcRenderer.invoke(CHANNEL.invoke, name, args),
      onEvent: (listener) => void listeners.add(listener),
    };
    contextBridge.exposeInMainWorld("__pear", bridge);
  }
  if (bootstrap && isYtm) {
    // The page runtime is a self-contained IIFE string; CSP is stripped by the
    // host, so indirect eval runs it in the main world's global scope.
    contextBridge.executeInMainWorld({
      func: (code: string) => {
        (0, eval)(code);
      },
      args: [pageRuntime],
    });
  }
}
