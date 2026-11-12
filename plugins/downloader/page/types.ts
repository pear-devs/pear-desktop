import type { PageContextOf } from "@pear/sdk";
import type { DownloaderCommands } from "../commands.ts";
import type { downloaderConfig } from "../config.ts";

export type Ctx = PageContextOf<typeof downloaderConfig, DownloaderCommands>;

// Material "download" icon.
export const ICON = "M11 4h2v8.17l3.09-3.08 1.41 1.41L12 16l-5.5-5.5 1.41-1.41L11 12.17V4Zm-6 14h14v2H5v-2Z";
