// config.json migrations, with electron-store's semantics (pear-desktop's
// store): each runs once, when the file was last written by a version older
// than the migration's, and the file then records the running version in
// `__internal__.migrations.version`.
//
// Add a migration for every change to what config.json means; never edit a
// released one.

import { compareVersions } from "../version.ts";
import { ensurePluginEntry, isRecord, type MigratedFiles, setNew, type StoredConfig } from "./helpers.ts";
import { PLUGIN_MIGRATIONS } from "./plugins.ts";

export type { MigratedFiles, StoredConfig } from "./helpers.ts";
export { PLUGIN_MIGRATIONS } from "./plugins.ts";

type Migration = (config: StoredConfig, files: MigratedFiles) => void;

const MIGRATIONS: [version: string, migration: Migration][] = [
  [
    // pear-desktop's own: its ad blocker became do-not-track (for files from before 3.12).
    "3.12.0",
    (config) => {
      const blocker = config.plugins?.adblocker;
      // Exactly as pear-desktop released it (arrays included), like every released migration.
      if (!blocker || typeof blocker !== "object") return;
      if (blocker.blocker !== "In player" && blocker.blocker !== "With blocklists") blocker.blocker = "In player";
      config.plugins!["do-not-track"] = blocker;
      delete config.plugins!.adblocker;
    },
  ],
  [
    // pear-desktop 3.x -> the rewrite. Most of the file already means the same:
    // plugin ids, options and their values were kept on purpose. What moved:
    "4.0.0",
    (config, files) => {
      const options = config.options ?? {};
      // The tray was an app option; it is a plugin now.
      if (typeof options.tray === "boolean") ensurePluginEntry(config, "tray").enabled = options.tray;
      // With the tray on, closing the window only hid it; that is an option of its own now.
      if (options.tray === true) setNew(ensurePluginEntry(config, "tray"), "closeToTray", true);
      // The API server listened on every interface by default (phone remotes); the rewrite's
      // default is this machine only. pear-desktop didn't store defaults, so set it for its users.
      const apiServer = config.plugins?.["api-server"];
      if (isRecord(apiServer)) setNew(apiServer, "hostname", "0.0.0.0");
      // On by default in pear-desktop (off in the rewrite): keep it for everyone who didn't turn it off.
      const performance = ensurePluginEntry(config, "performance-improvement");
      if (performance.enabled !== false) performance.enabled = true;
      if (typeof options.trayClickPlayPause === "boolean") ensurePluginEntry(config, "tray").clickPlayPause = options.trayClickPlayPause;
      migratePlugins(config, files);
      // pear-desktop saved every download to the download folder; the rewrite keeps them in the app
      // unless asked (exportFiles). Everyone upgrading keeps getting the files. After migratePlugins,
      // which would treat a new entry as one pear-desktop wrote.
      setNew(ensurePluginEntry(config, "downloader"), "exportFiles", true);
    },
  ],
];

/** Plugin options renamed or reshaped by the rewrite (see plugins.ts). */
function migratePlugins(config: StoredConfig, files: MigratedFiles) {
  const entries = config.plugins ?? {};
  for (const [id, migrate] of Object.entries(PLUGIN_MIGRATIONS)) {
    const entry = entries[id];
    if (isRecord(entry)) migrate(entry, config, files);
  }
}

/** Runs the migrations a stored config needs; a missing file starts fresh. */
export function migrate(
  stored: StoredConfig | undefined,
  appVersion: string,
): { config: StoredConfig; migrated: boolean; files: MigratedFiles } {
  const config: StoredConfig = structuredClone(stored ?? {});
  const files: MigratedFiles = {};
  const previous = stored ? (config.__internal__?.migrations?.version ?? "0.0.0") : appVersion;
  for (const [version, migration] of MIGRATIONS) {
    if (compareVersions(version, previous) > 0 && compareVersions(version, appVersion) <= 0) migration(config, files);
  }
  const migrated = !stored || previous !== appVersion;
  // Never record an older version than the one that wrote the file (a downgrade).
  if (compareVersions(appVersion, previous) >= 0) {
    config.__internal__ = { ...config.__internal__, migrations: { ...config.__internal__?.migrations, version: appVersion } };
  }
  return { config, migrated, files };
}
