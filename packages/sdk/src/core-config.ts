// Schemas of the core's own settings sections, rendered in the settings
// overlay next to the plugins with the same field builders.

import { config, type ConfigOf } from "./config.ts";
import { languages } from "./macros.ts" with { type: "macro" };

/**
 * Where YTM opens: pear-desktop's page names (stored as is) and the
 * page each one opens. "" is YTM's own default.
 */
export const STARTING_PAGES = {
  "": "/",
  Home: "/browse/FEmusic_home",
  Explore: "/browse/FEmusic_explore",
  "New Releases": "/browse/FEmusic_new_releases",
  Charts: "/browse/FEmusic_charts",
  "Moods & Genres": "/browse/FEmusic_moods_and_genres",
  Library: "/browse/FEmusic_library_landing",
  Playlists: "/browse/FEmusic_liked_playlists",
  Songs: "/browse/FEmusic_liked_videos",
  Albums: "/browse/FEmusic_liked_albums",
  Artists: "/browse/FEmusic_library_corpus_track_artists",
  "Subscribed Artists": "/browse/FEmusic_library_corpus_artists",
  Uploads: "/browse/FEmusic_library_privately_owned_landing",
  "Uploaded Playlists": "/browse/FEmusic_liked_playlists",
  "Uploaded Songs": "/browse/FEmusic_library_privately_owned_tracks",
  "Uploaded Albums": "/browse/FEmusic_library_privately_owned_releases",
  "Uploaded Artists": "/browse/FEmusic_library_privately_owned_artists",
  "Mixed for you": "/browse/FEmusic_mixed_for_you",
} as const;

export type StartingPage = keyof typeof STARTING_PAGES;

const startingPageOptions = Object.keys(STARTING_PAGES).map((value) => ({
  value: value as StartingPage,
  label: value || "Default",
}));

// The core sections below are views over config.json's `options` (pear-desktop's
// app options, same names and values); keys are unique across them.

export const GENERAL = {
  resumeOnStart: config.bool(true, {
    label: "Reopen the last page",
    description: "Start where you left off (never straight into playback).",
    group: "Startup",
  }),
  startingPage: config.select("", startingPageOptions, {
    label: "Starting page",
    description: "Used when the last page isn't reopened.",
    group: "Startup",
    variant: "dropdown",
  }),
  language: config.select("", [{ value: "", label: "System default" }, ...languages()], {
    label: "Language",
    group: "Language",
    variant: "dropdown",
    restart: true,
  }),
  autoUpdates: config.bool(true, {
    label: "Check for updates",
    description: "Tells you when a new version is out.",
    group: "Updates",
  }),
};

export const WINDOW = {
  alwaysOnTop: config.bool(false, { label: "Always on top", group: "Window" }),
  hideMenu: config.bool(false, {
    label: "Hide the menu bar",
    description: "Press Alt to show it.",
    group: "Window",
    platforms: ["linux", "win32"],
  }),
  startAtLogin: config.bool(false, {
    label: "Start at login",
    group: "System",
    platforms: ["win32", "darwin"],
  }),
  appVisible: config.bool(true, {
    label: "Show the window at startup",
    description: "Off: start hidden in the tray (needs the Tray icon plugin; otherwise the window shows as usual).",
    group: "System",
  }),
};

export const APPEARANCE = {
  removeUpgradeButton: config.bool(false, { label: "Remove the Upgrade button", group: "Interface" }),
  likeButtons: config.select(
    "",
    [
      { value: "", label: "Default" },
      { value: "force", label: "Always show" },
      { value: "hide", label: "Hide" },
    ],
    { label: "Like buttons", group: "Interface" },
  ),
  swapLikeButtonsOrder: config.bool(false, { label: "Swap the like and dislike buttons", group: "Interface" }),
  usePodcastParticipantAsArtist: config.bool(false, {
    label: "Show the listed participant as a podcast's artist",
    description: "Off: the channel that publishes it, usually the host. Used in notifications and integrations.",
    group: "Interface",
  }),
  customWindowTitle: config.string("", {
    label: "Window title",
    placeholder: "The page's title",
    group: "Window",
  }),
  themes: config.list([], {
    label: "Themes",
    description: "CSS files applied on top of \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music.",
    placeholder: "/path/to/theme.css",
    group: "Themes",
  }),
};

export const ADVANCED = {
  disableHardwareAcceleration: config.bool(false, {
    label: "Disable hardware acceleration",
    description: "Try this if video or animations flicker or the window stays black.",
    group: "Performance",
    restart: true,
  }),
  autoResetAppCache: config.bool(false, {
    label: "Clear the cache at startup",
    group: "Performance",
  }),
  proxy: config.string("", {
    label: "Proxy",
    description: "For proxies that need a username and password, use the Proxy plugin.",
    placeholder: "socks5://127.0.0.1:9999",
    group: "Network",
    restart: true,
  }),
};

/**
 * YTM's feature flags, set as the page loads (see packages/page/src/site-flags.ts).
 * YTM tries new designs on some users first, chosen per visitor.
 */
export const SITE = {
  playerBar: config.select(
    "",
    [
      { value: "", label: "Site's choice" },
      { value: "classic", label: "Classic" },
      { value: "new", label: "New" },
    ],
    {
      label: "Player bar",
      description: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music is trying a new player bar on some users. The one it didn't choose for you works, but without like buttons: it only sends them for its choice.",
      group: "Site features",
      restart: true,
    },
  ),
  siteFlags: config.list([], {
    label: "Feature flag overrides",
    description: "One flag per entry, as name=value (true, false, a number or text). Unknown names do nothing.",
    placeholder: "flag_name=false",
    group: "Site features",
    restart: true,
  }),
};

export type FlagValue = boolean | number | string;
export type Flags = Record<string, FlagValue>;

const FLAG_NAME = /^[\w.-]+$/;

/** A `siteFlags` entry, "name=value", as [name, value] with true/false and numbers typed like YTM's. */
export function parseFlagOverride(entry: string): [string, FlagValue] | undefined {
  const separator = entry.indexOf("=");
  const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();
  if (!FLAG_NAME.test(name)) return undefined;
  // A bare name turns the flag on.
  if (separator === -1) return [name, true];
  const raw = entry.slice(separator + 1).trim();
  if (raw === "true" || raw === "false") return [name, raw === "true"];
  if (raw !== "" && Number.isFinite(Number(raw))) return [name, Number(raw)];
  return [name, raw];
}

/** The overrides a `siteFlags` list asks for; later entries win. */
export function flagOverrides(entries: readonly string[]): Flags {
  const flags: Flags = {};
  for (const entry of entries) {
    const parsed = parseFlagOverride(entry);
    if (parsed) flags[parsed[0]] = parsed[1];
  }
  return flags;
}

/** `siteFlags` with `name` set to `value`, or without it when `value` is undefined. */
export function withFlagOverride(entries: readonly string[], name: string, value: FlagValue | undefined): string[] {
  const others = entries.filter((entry) => parseFlagOverride(entry)?.[0] !== name);
  return value === undefined ? others : [...others, `${name}=${value}`];
}

/** pear-desktop's API server port, which companion apps expect by default. */
export const DEFAULT_API_PORT = 26538;
const MAX_PORT = 65535;

export const API_SERVER = {
  enabled: config.bool(false, {
    label: "Enable the API server",
    description: "Lets other apps control playback and read the current song over HTTP and WebSocket.",
  }),
  hostname: config.string("127.0.0.1", {
    label: "Hostname",
    group: "Network",
    description: "127.0.0.1 accepts connections only from this computer; 0.0.0.0 from your network too.",
  }),
  port: config.number(DEFAULT_API_PORT, { label: "Port", group: "Network", min: 1, max: MAX_PORT, step: 1, variant: "stepper" }),
  authStrategy: config.select(
    "AUTH_AT_FIRST",
    [
      { value: "AUTH_AT_FIRST", label: "Ask when a new client connects" },
      { value: "NONE", label: "None (anyone who can reach the port)" },
    ],
    { label: "Authorization", group: "Access" },
  ),
  authorizedClients: config.list([], {
    label: "Authorized clients",
    group: "Access",
    description: "Client IDs that may use the API. Remove one to revoke it.",
  }),
  secret: config.string("", {
    label: "Token secret",
    group: "Access",
    secret: true,
    description: "Signs access tokens; changing it signs every client out. Generated when empty.",
  }),
  useHttps: config.bool(false, { label: "Use HTTPS", group: "HTTPS" }),
  certPath: config.string("", { label: "Certificate file", group: "HTTPS", placeholder: "/path/to/cert.pem" }),
  keyPath: config.string("", { label: "Private key file", group: "HTTPS", placeholder: "/path/to/key.pem" }),
};

export type ApiServerConfig = ConfigOf<typeof API_SERVER>;

export const CORE_SECTIONS = {
  general: GENERAL,
  window: WINDOW,
  appearance: APPEARANCE,
  advanced: ADVANCED,
  site: SITE,
  apiServer: API_SERVER,
} as const;

export type CoreSection = keyof typeof CORE_SECTIONS;

export function isCoreSection(name: string): name is CoreSection {
  return Object.hasOwn(CORE_SECTIONS, name);
}
