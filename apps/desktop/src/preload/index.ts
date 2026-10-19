// Runs in an isolated world before the page's scripts, on every top-level page
// the window navigates to. On YTM it exposes the typed bridge and
// injects the page runtime; other origins (e.g. Google sign-in) are left alone.

import { contextBridge, ipcRenderer } from "electron";
import pageRuntime from "virtual:pear/page-runtime";
import { INVOKE_CHANNEL, type CommandName, type HostCommands } from "../shared/ipc.ts";
import { YTM_ORIGIN } from "../shared/user-agent.ts";

const bridge = {
  invoke<K extends CommandName>(
    name: K,
    ...args: Parameters<HostCommands[K]>
  ): Promise<ReturnType<HostCommands[K]>> {
    return ipcRenderer.invoke(INVOKE_CHANNEL, name, args);
  },
};

export type PearBridge = typeof bridge;

if (location.origin === YTM_ORIGIN) {
  contextBridge.exposeInMainWorld("__pear", bridge);
  // The page runtime is a self-contained IIFE string; CSP is stripped by the
  // host, so indirect eval runs it in the main world's global scope.
  contextBridge.executeInMainWorld({
    func: (code: string) => {
      (0, eval)(code);
    },
    args: [pageRuntime],
  });
}
