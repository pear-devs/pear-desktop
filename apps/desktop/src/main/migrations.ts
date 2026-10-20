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
    // pear-desktop's own: its ad blocker became do-not-track (for files from before 3.12).
    "3.12.0",
    (config) => {
      const blocker = config.plugins?.adblocker;
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
    if (isRecord(entries[id])) migrate(entries[id], config);
  }
}

// Each converts one plugin's stored entry in place. pear-desktop only stored
// what differed from its defaults (deep-merged on read), so any key may be
// missing; old values are type-checked, and keys the rewrite already has are
// never overwritten, so running one twice changes nothing. Old keys stay in the
// file (unknown keys are kept), like everything else this version doesn't read.
type PluginMigration = (entry: Json, config: StoredConfig) => void;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Sets a new key, unless the entry already has one. */
function setNew(entry: Json, key: string, value: unknown) {
  if (value !== undefined && !(key in entry)) entry[key] = value;
}

/** pear-desktop stored fractions (0.5) where the rewrite shows percentages (50). */
function fractionToPercent(entry: Json, key: string) {
  const value = entry[key];
  if (isNumber(value) && value >= 0 && value <= 1) entry[key] = Math.round(value * 100);
}

/** Keeps a number the rewrite would reject as out of range (and reset to its default) within the range. */
function clampNumber(entry: Json, key: string, min: number, max: number) {
  const value = entry[key];
  if (isNumber(value)) entry[key] = clamp(value, min, max);
}

/** Copies the string values of `from` onto the entry's top-level keys. */
function flattenStrings(entry: Json, from: unknown, keys: Readonly<Record<string, string>>) {
  if (!isRecord(from)) return;
  for (const [oldKey, newKey] of Object.entries(keys)) {
    if (typeof from[oldKey] === "string") setNew(entry, newKey, from[oldKey]);
  }
}

// ---- pear-desktop 3.x plugin options: all plugins but downloader, synced-lyrics,
// do-not-track, performance-improvement and tray (migrated by their own blocks).
// Plugins not listed kept every option under the same key and value format.

/** discord's "Play on <app>" button option: the app's name, kept escaped like pear-desktop does. */
const DISCORD_PLAY_BUTTON = "playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063";
/** discord-api-types' StatusDisplayType, which pear-desktop stored as a number. */
const DISCORD_STATUS_DISPLAY = ["name", "state", "details"] as const;
/** pear-desktop's only equalizer preset, as the filter it applied. */
const BASS_BOOSTER = { type: "lowshelf", frequency: 80, Q: 100, gain: 12 };
const SPONSORBLOCK_CATEGORIES = ["sponsor", "intro", "outro", "interaction", "selfpromo", "music_offtopic", "preview", "filler"];

const PEAR_DESKTOP_PLUGINS: Record<string, PluginMigration> = {
  "album-color-theme": (entry) => fractionToPercent(entry, "ratio"),
  "ambient-mode": (entry) => fractionToPercent(entry, "opacity"),
  "auth-proxy-adapter": (entry, config) => {
    // The adapter used to forward to the app's proxy option; the plugin has its own address now.
    const proxy = config.options?.proxy;
    if (typeof proxy === "string" && proxy && !entry.url) entry.url = proxy;
  },
  crossfade: (entry) => {
    // 'linear', 'logarithmic', or a number: logarithmic with that range in dB.
    const scaling = typeof entry.fadeScaling === "string" && entry.fadeScaling.trim() ? Number(entry.fadeScaling) : entry.fadeScaling;
    if (isNumber(scaling)) {
      entry.fadeScaling = scaling > 0 ? "logarithmic" : "linear";
      if (scaling > 0) setNew(entry, "dynamicRange", clamp(Math.round(scaling), 10, 120));
    }
    clampNumber(entry, "fadeInDuration", 0, 10_000);
    clampNumber(entry, "fadeOutDuration", 0, 20_000);
    clampNumber(entry, "secondsBeforeEnd", 0, 30);
  },
  "custom-output-device": (entry) => {
    // A device id, or "default"; the rewrite prefers the device's name (ids work too).
    const output = entry.output;
    if (output === "default") entry.output = "";
    else if (typeof output === "string" && isRecord(entry.devices) && typeof entry.devices[output] === "string" && entry.devices[output]) {
      entry.output = entry.devices[output];
    }
  },
  discord: (entry) => {
    if (typeof entry[DISCORD_PLAY_BUTTON] === "boolean") setNew(entry, "playButton", entry[DISCORD_PLAY_BUTTON]);
    const timeout = entry.activityTimeoutTime;
    if (isNumber(timeout)) {
      // Milliseconds; 0 cleared the activity as soon as playback paused.
      if (timeout > 0) setNew(entry, "activityTimeoutMinutes", clamp(Math.round(timeout / 60_000), 1, 240));
      else if (entry.activityTimeoutEnabled !== false) setNew(entry, "hideWhenPaused", true);
    }
    const status = entry.statusDisplayType;
    if (isNumber(status) && DISCORD_STATUS_DISPLAY[status]) entry.statusDisplayType = DISCORD_STATUS_DISPLAY[status];
  },
  equalizer: (entry) => {
    // A list of biquad filters (plus the bass booster preset) -> the extra filters, as JSON.
    if (typeof entry.filters === "string") return;
    const filters = Array.isArray(entry.filters) ? entry.filters.filter(isRecord) : [];
    if (isRecord(entry.presets) && entry.presets["bass-booster"] === true) filters.push(BASS_BOOSTER);
    entry.filters = filters.length > 0 ? JSON.stringify(filters) : "";
  },
  "in-app-menu": (entry) => {
    if (typeof entry.hideDOMWindowControls === "boolean") setNew(entry, "windowControls", !entry.hideDOMWindowControls);
  },
  "precise-volume": (entry) => {
    flattenStrings(entry, entry.globalShortcuts, { volumeUp: "volumeUp", volumeDown: "volumeDown" });
    clampNumber(entry, "steps", 1, 100);
  },
  scrobbler: (entry) => {
    const scrobblers = isRecord(entry.scrobblers) ? entry.scrobblers : {};
    const lastfm = scrobblers.lastfm;
    const listenbrainz = scrobblers.listenbrainz;
    if (isRecord(lastfm) && typeof lastfm.enabled === "boolean") setNew(entry, "lastfmEnabled", lastfm.enabled);
    flattenStrings(entry, lastfm, {
      sessionKey: "lastfmSessionKey",
      apiKey: "lastfmApiKey",
      secret: "lastfmSecret",
      apiRoot: "lastfmApiRoot",
    });
    if (isRecord(listenbrainz) && typeof listenbrainz.enabled === "boolean") setNew(entry, "listenbrainzEnabled", listenbrainz.enabled);
    flattenStrings(entry, listenbrainz, { token: "listenbrainzToken", apiRoot: "listenbrainzApiRoot" });
  },
  shortcuts: (entry, config) => {
    // Global shortcuts; the in-window ("local") ones and media key overrides have no equivalent.
    flattenStrings(entry, entry.global, { playPause: "playPause", next: "next", previous: "previous" });
    // The plugin also ran the Linux MPRIS player, which is the media-controls plugin now.
    if (entry.enabled === true) setNew(plugin(config, "media-controls"), "enabled", true);
  },
  sponsorblock: (entry) => {
    // A list of categories -> one switch per category.
    const categories = entry.categories;
    if (!Array.isArray(categories)) return;
    for (const category of SPONSORBLOCK_CATEGORIES) setNew(entry, category, categories.includes(category));
  },
  "transparent-player": (entry) => fractionToPercent(entry, "opacity"),
  visualizer: (entry) => {
    if (entry.type === "vudio") entry.type = "bars";
    const { butterchurn, vudio } = entry;
    if (isRecord(butterchurn)) {
      if (typeof butterchurn.preset === "string") setNew(entry, "preset", butterchurn.preset);
      if (isNumber(butterchurn.blendTimeInSeconds)) setNew(entry, "blendTimeInSeconds", clamp(butterchurn.blendTimeInSeconds, 0, 10));
    }
    if (isRecord(vudio)) {
      if (isNumber(vudio.accuracy)) setNew(entry, "bars", clamp(Math.round(vudio.accuracy), 16, 256));
      if (isRecord(vudio.lighting) && typeof vudio.lighting.color === "string") setNew(entry, "primary", vudio.lighting.color);
    }
  },
};
// ---- end of pear-desktop 3.x plugin options

// ---- synced-lyrics (preferredProvider, lineEffect, showTimeCodes, romanization,
// showLyricsEvenIfInexact keep their names and values)
const SYNCED_LYRICS: Record<string, PluginMigration> = {
  "synced-lyrics": (entry) => {
    // defaultTextString: what fills instrumental gaps.
    const gap = entry.defaultTextString;
    if (gap === "♪") setNew(entry, "gapText", "note");
    else if (gap === "———") setNew(entry, "gapText", "dash");
    else if (gap === " " || gap === "") setNew(entry, "gapText", "none");
    else if (Array.isArray(gap)) setNew(entry, "gapText", "dots");
    const convert = { simplifiedToTraditional: "s2t", traditionalToSimplified: "t2s", disabled: "off" } as const;
    const chinese = entry.convertChineseCharacter;
    if (typeof chinese === "string" && Object.hasOwn(convert, chinese)) {
      setNew(entry, "convertChinese", convert[chinese as keyof typeof convert]);
    }
  },
};

// ---- downloader
const DOWNLOADER: Record<string, PluginMigration> = {
  // Same names: downloadFolder, skipExisting, playlistMaxItems. The old keys stay
  // (unknown keys are kept), so going back to 3.x still finds them.
  downloader(entry) {
    // FFmpeg presets became yt-dlp audio formats.
    if (entry.format === undefined && typeof entry.selectedPreset === "string") {
      const custom = (entry.customPresetSetting ?? {}) as { extension?: unknown };
      const extension = typeof custom.extension === "string" ? custom.extension.toLowerCase() : custom.extension;
      const format =
        entry.selectedPreset === "Source"
          ? "source"
          : entry.selectedPreset === "Custom"
            ? extension === "mp3" || extension === "m4a" || extension === "opus"
              ? extension
              : // No extension meant "keep the source's container".
                extension == null
                ? "source"
                : undefined
            : "mp3";
      if (format) entry.format = format;
    }
    // { enabled, mode, seconds, percent, folder } -> flat options.
    const onFinish = entry.downloadOnFinish;
    if (entry.autoDownload === undefined && typeof onFinish === "object" && onFinish !== null) {
      const { enabled, mode, seconds, percent, folder } = onFinish as Json;
      if (typeof enabled === "boolean") entry.autoDownload = enabled;
      if (mode === "seconds" || mode === "percent") entry.autoDownloadMode = mode;
      if (typeof seconds === "number") entry.autoDownloadSeconds = seconds;
      if (typeof percent === "number") entry.autoDownloadPercent = percent;
      if (typeof folder === "string") entry.autoDownloadFolder = folder;
    }
  },
};

const PLUGIN_MIGRATIONS: Record<string, PluginMigration> = {
  ...PEAR_DESKTOP_PLUGINS,
  ...SYNCED_LYRICS,
  ...DOWNLOADER,
};

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
