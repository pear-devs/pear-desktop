import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { INVOKE_CHANNEL, type CommandName, type HostCommands } from "../shared/ipc.ts";

const handlers: HostCommands = {
  ping: (message) => `pong: ${message}`,
  "app:version": () => app.getVersion(),
};

const TRUSTED_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

function isTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  return url !== undefined && new URL(url).origin === TRUSTED_ORIGIN;
}

export function setupIpc() {
  ipcMain.handle(INVOKE_CHANNEL, (event, name: unknown, args: unknown) => {
    if (!isTrustedSender(event)) throw new Error("[pear] invoke from untrusted frame");
    if (typeof name !== "string" || !Object.hasOwn(handlers, name)) {
      throw new Error(`[pear] unknown command: ${String(name)}`);
    }
    if (!Array.isArray(args)) throw new Error("[pear] invoke args must be an array");
    const handler = handlers[name as CommandName] as (...a: unknown[]) => unknown;
    return handler(...args);
  });
}
