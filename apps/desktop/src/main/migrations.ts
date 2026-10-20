// config.json migrations, with electron-store's semantics (pear-desktop's
// store): each runs once, when the file was last written by a version older
// than the migration's, and the file then records the running version in
// `__internal__.migrations.version`.
//
// Add a migration for every change to what config.json means; never edit a
// released one.

type Json = Record<string, unknown>;

export interface StoredConfig {
  plugins?: Record<string, Json>;
  options?: Json;
  url?: unknown;
  "window-size"?: unknown;
  "window-position"?: unknown;
  "window-maximized"?: unknown;
  __internal__?: { migrations?: { version?: string } };
  [key: string]: unknown;
}

type Migration = (config: StoredConfig) => void;

const plugin = (config: StoredConfig, id: string): Json => {
  config.plugins ??= {};
  return (config.plugins[id] ??= {});
};

const MIGRATIONS: [version: string, migration: Migration][] = [
  [
    // pear-desktop 3.x -> the rewrite. Most of the file already means the same:
    // plugin ids, options and their values were kept on purpose. What moved:
    "4.0.0",
    (config) => {
      const options = config.options ?? {};
      // The tray was an app option; it is a plugin now.
      if (typeof options.tray === "boolean") plugin(config, "tray").enabled = options.tray;
      if (typeof options.trayClickPlayPause === "boolean") plugin(config, "tray").clickPlayPause = options.trayClickPlayPause;
      migratePlugins(config);
    },
  ],
];

/** Plugin options renamed or reshaped by the rewrite (pear-desktop 3.x -> 4.0.0). */
function migratePlugins(config: StoredConfig) {
  const entries = config.plugins ?? {};
  for (const [id, migrate] of Object.entries(PLUGIN_MIGRATIONS)) {
    if (entries[id]) migrate(entries[id]);
  }
}

const PLUGIN_MIGRATIONS: Record<string, (entry: Json) => void> = {};

export function compareVersions(a: string, b: string) {
  const parse = (version: string) => version.split("-")[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** Runs the migrations a stored config needs; a missing file starts fresh. */
export function migrate(stored: StoredConfig | undefined, appVersion: string): { config: StoredConfig; migrated: boolean } {
  const config: StoredConfig = structuredClone(stored ?? {});
  const previous = stored ? (config.__internal__?.migrations?.version ?? "0.0.0") : appVersion;
  for (const [version, migration] of MIGRATIONS) {
    if (compareVersions(version, previous) > 0 && compareVersions(version, appVersion) <= 0) migration(config);
  }
  const migrated = !stored || previous !== appVersion;
  // Never record an older version than the one that wrote the file (a downgrade).
  if (compareVersions(appVersion, previous) >= 0) {
    config.__internal__ = { ...config.__internal__, migrations: { ...config.__internal__?.migrations, version: appVersion } };
  }
  return { config, migrated };
}

export { PLUGIN_MIGRATIONS };
