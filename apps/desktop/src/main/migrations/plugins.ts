// pear-desktop 3.x plugin options -> the rewrite's (part of the 4.0.0
// migration). Each entry converts one plugin's stored entry in place. Old keys
// stay in the file (unknown keys are kept), so going back to 3.x still finds
// them. Plugins not listed kept every option under the same key and value
// format; do-not-track, tray, api-server and performance-improvement are
// handled by the migrations themselves (index.ts).

import { clamp } from "@pear/sdk/util";
import {
  clampNumber,
  copyTyped,
  ensurePluginEntry,
  flattenStrings,
  fractionToPercent,
  isBoolean,
  isNumber,
  isPair,
  isRecord,
  isString,
  type Json,
  type MigratedFiles,
  setNew,
  type StoredConfig,
} from "./helpers.ts";

export type PluginMigration = (entry: Json, config: StoredConfig, files: MigratedFiles) => void;

/** discord's "Play on <app>" button option: the app's name, kept escaped like pear-desktop does. */
const DISCORD_PLAY_BUTTON = "playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063";
/** discord-api-types' StatusDisplayType, which pear-desktop stored as a number. */
const DISCORD_STATUS_DISPLAY = ["name", "state", "details"] as const;
/** pear-desktop's only equalizer preset, as the filter it applied. */
const BASS_BOOSTER = { type: "lowshelf", frequency: 80, Q: 100, gain: 12 };
/** pear-desktop's vudio.lighting options and the visualizer's flat names for them. */
const VUDIO_OPTIONS: Record<string, string> = {
  maxHeight: "vudioMaxHeight",
  maxSize: "vudioMaxSize",
  lineWidth: "vudioLineWidth",
  color: "vudioColor",
  shadowBlur: "vudioShadowBlur",
  shadowColor: "vudioShadowColor",
  fadeSide: "vudioFadeSide",
  prettify: "vudioPrettify",
  dottify: "vudioDottify",
  horizontalAlign: "vudioHorizontalAlign",
  verticalAlign: "vudioVerticalAlign",
};
/** pear-desktop's notification toast styles, in the order of their numbers. */
const TOAST_STYLES = ["logo", "banner_centered_top", "hero", "banner_top_custom", "banner_centered_bottom", "banner_bottom", "legacy"];
const SPONSORBLOCK_CATEGORIES = ["sponsor", "intro", "outro", "interaction", "selfpromo", "music_offtopic", "preview", "filler"];
/** synced-lyrics' text for instrumental gaps -> the rewrite's choice. */
const GAP_TEXTS = new Map([
  ["♪", "note"],
  ["———", "dash"],
  [" ", "none"],
  ["", "none"],
]);
const CHINESE_CONVERSIONS: Record<string, string> = { simplifiedToTraditional: "s2t", traditionalToSimplified: "t2s", disabled: "off" };
const isDownloadMode = (value: unknown) => value === "seconds" || value === "percent";
/** downloader's download-on-finish options -> its flat ones. */
const DOWNLOAD_ON_FINISH: [from: string, to: string, valid: (value: unknown) => boolean][] = [
  ["enabled", "autoDownload", isBoolean],
  ["mode", "autoDownloadMode", isDownloadMode],
  ["seconds", "autoDownloadSeconds", isNumber],
  ["percent", "autoDownloadPercent", isNumber],
  ["folder", "autoDownloadFolder", isString],
];

export const PLUGIN_MIGRATIONS: Record<string, PluginMigration> = {
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
    if (output === "default") {
      entry.output = "";
      return;
    }
    const name = typeof output === "string" && isRecord(entry.devices) ? entry.devices[output] : undefined;
    if (typeof name === "string" && name) entry.output = name;
  },
  discord: (entry) => {
    if (isBoolean(entry[DISCORD_PLAY_BUTTON])) setNew(entry, "playButton", entry[DISCORD_PLAY_BUTTON]);
    const timeout = entry.activityTimeoutTime;
    if (isNumber(timeout)) {
      // Milliseconds; pear-desktop only armed the timeout for values above 0, so 0 never cleared it.
      if (timeout > 0) setNew(entry, "activityTimeoutSeconds", clamp(Math.round(timeout / 1000), 1, 14_400));
      else entry.activityTimeoutEnabled = false;
    }
    const status = entry.statusDisplayType;
    if (isNumber(status) && DISCORD_STATUS_DISPLAY[status]) entry.statusDisplayType = DISCORD_STATUS_DISPLAY[status];
  },
  downloader: (entry) => {
    // Same names: downloadFolder, skipExisting, playlistMaxItems.
    // Off by default in pear-desktop (on in the rewrite, for new profiles).
    setNew(entry, "skipExisting", false);
    if (entry.format === undefined && typeof entry.selectedPreset === "string") presetToFormat(entry, entry.selectedPreset);
    // { enabled, mode, seconds, percent, folder } -> flat options.
    const onFinish = entry.downloadOnFinish;
    if (entry.autoDownload === undefined && isRecord(onFinish)) {
      // Set outright, not with setNew: autoDownload being unset says these are all pear-desktop's.
      for (const [from, to, valid] of DOWNLOAD_ON_FINISH) {
        if (valid(onFinish[from])) entry[to] = onFinish[from];
      }
    }
  },
  equalizer: (entry) => {
    // A list of biquad filters (plus the bass booster preset) -> the extra filters, as JSON.
    if (typeof entry.filters === "string") return;
    const filters = Array.isArray(entry.filters) ? entry.filters.filter(isRecord) : [];
    if (isRecord(entry.presets) && entry.presets["bass-booster"] === true) filters.push(BASS_BOOSTER);
    entry.filters = filters.length > 0 ? JSON.stringify(filters) : "";
  },
  "in-app-menu": (entry) => {
    if (isBoolean(entry.hideDOMWindowControls)) setNew(entry, "windowControls", !entry.hideDOMWindowControls);
  },
  notifications: (entry) => {
    // The Windows toast style was a number (1-based).
    if (isNumber(entry.toastStyle) && TOAST_STYLES[entry.toastStyle - 1]) entry.toastStyle = TOAST_STYLES[entry.toastStyle - 1];
  },
  "picture-in-picture": (entry, _config, files) => {
    // The small window's last position and size; the rewrite keeps them in a file of their own.
    const position = entry["pip-position"];
    const size = entry["pip-size"];
    const hasSize = isPair(size) && size[0] > 0 && size[1] > 0;
    const bounds = {
      ...(isPair(position) ? { x: Math.round(position[0]), y: Math.round(position[1]) } : {}),
      ...(hasSize ? { width: Math.round(size[0]), height: Math.round(size[1]) } : {}),
    };
    if (Object.keys(bounds).length > 0) files["picture-in-picture.json"] ??= bounds;
  },
  "precise-volume": (entry) => {
    flattenStrings(entry, entry.globalShortcuts, { volumeUp: "volumeUp", volumeDown: "volumeDown" });
    clampNumber(entry, "steps", 1, 100);
  },
  scrobbler: (entry) => {
    const scrobblers: Json = isRecord(entry.scrobblers) ? entry.scrobblers : {};
    const { lastfm, listenbrainz } = scrobblers;
    copyTyped(entry, lastfm, { enabled: "lastfmEnabled" }, isBoolean);
    flattenStrings(entry, lastfm, {
      sessionKey: "lastfmSessionKey",
      apiKey: "lastfmApiKey",
      secret: "lastfmSecret",
      apiRoot: "lastfmApiRoot",
    });
    copyTyped(entry, listenbrainz, { enabled: "listenbrainzEnabled" }, isBoolean);
    flattenStrings(entry, listenbrainz, { token: "listenbrainzToken", apiRoot: "listenbrainzApiRoot" });
  },
  shortcuts: (entry, config) => {
    // Global and in-window ("local") shortcuts; overrideMediaKeys keeps its name.
    flattenStrings(entry, entry.global, { playPause: "playPause", next: "next", previous: "previous" });
    flattenStrings(entry, entry.local, { playPause: "localPlayPause", next: "localNext", previous: "localPrevious" });
    // The plugin also ran the Linux MPRIS player, which is the media-controls plugin now.
    if (entry.enabled === true) setNew(ensurePluginEntry(config, "media-controls"), "enabled", true);
  },
  sponsorblock: (entry) => {
    // A list of categories -> one switch per category.
    const categories = entry.categories;
    if (!Array.isArray(categories)) return;
    for (const category of SPONSORBLOCK_CATEGORIES) setNew(entry, category, categories.includes(category));
  },
  // preferredProvider, lineEffect, showTimeCodes, romanization and
  // showLyricsEvenIfInexact keep their names and values.
  "synced-lyrics": (entry) => {
    // defaultTextString: what fills instrumental gaps; ♪ by default in pear-desktop
    // (which didn't store defaults), animated dots in the rewrite.
    setNew(entry, "gapText", gapText(entry.defaultTextString));
    const chinese = entry.convertChineseCharacter;
    if (typeof chinese === "string" && Object.hasOwn(CHINESE_CONVERSIONS, chinese)) {
      setNew(entry, "convertChinese", CHINESE_CONVERSIONS[chinese]);
    }
  },
  "transparent-player": (entry) => fractionToPercent(entry, "opacity"),
  visualizer: (entry) => {
    // Per-visualizer objects -> flat options; Wave's animations -> JSON.
    const { butterchurn, vudio, wave } = entry;
    if (isRecord(butterchurn)) {
      copyTyped(entry, butterchurn, { preset: "preset" }, isString);
      if (isNumber(butterchurn.blendTimeInSeconds)) setNew(entry, "blendTimeInSeconds", clamp(butterchurn.blendTimeInSeconds, 0, 10));
    }
    if (isRecord(vudio)) {
      copyTyped(entry, vudio, { effect: "vudioEffect" }, isString);
      if (isNumber(vudio.accuracy)) setNew(entry, "vudioAccuracy", String(vudio.accuracy));
      copyTyped(entry, vudio.lighting, VUDIO_OPTIONS, (value) => value !== undefined);
    }
    if (isRecord(wave) && Array.isArray(wave.animations)) setNew(entry, "waveAnimations", JSON.stringify(wave.animations));
  },
};

/** FFmpeg presets became yt-dlp audio formats; the Custom preset keeps its arguments and extension. */
function presetToFormat(entry: Json, preset: string) {
  if (preset !== "Custom") {
    entry.format = preset === "Source" ? "source" : "mp3";
    return;
  }
  const custom = isRecord(entry.customPresetSetting) ? entry.customPresetSetting : {};
  entry.format = "custom";
  if (Array.isArray(custom.ffmpegArgs)) {
    const quote = (arg: string) => (/[\s"']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    setNew(entry, "customArgs", custom.ffmpegArgs.filter(isString).map(quote).join(" "));
  }
  copyTyped(entry, custom, { extension: "customExtension" }, isString);
}

function gapText(gap: unknown) {
  if (gap === undefined) return "note";
  if (typeof gap === "string") return GAP_TEXTS.get(gap);
  if (!Array.isArray(gap)) return undefined;
  return gap.some((frame) => typeof frame === "string" && frame.includes("•")) ? "bullets" : "dots";
}
