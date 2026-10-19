// Commands the page can invoke on the host. Each entry maps a command name to
// its (args) => result signature; main implements them, preload and page
// derive their types from here.

export interface HostCommands {
  ping(message: string): string;
  "app:version"(): string;
}

export type CommandName = keyof HostCommands;

export const INVOKE_CHANNEL = "pear:invoke";
