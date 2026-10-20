// Schemas of the core's own settings sections, rendered in the settings
// overlay next to the plugins with the same field builders.

import { config, type ConfigOf } from "./config.ts";

/** Where YTM opens, as a path on YTM. */
export const STARTING_PAGES = [
  { value: "/", label: "Home" },
  { value: "/explore", label: "Explore" },
  { value: "/library", label: "Library" },
  { value: "/playlist?list=LM", label: "Liked music" },
  { value: "/history", label: "History" },
  { value: "/charts", label: "Charts" },
  { value: "/new_releases", label: "New releases" },
] as const;

export const GENERAL = {
  restoreLastPage: config.bool(true, {
    label: "Reopen the last page",
    description: "Start where you left off (never straight into playback).",
    group: "Startup",
  }),
  startingPage: config.select("/", STARTING_PAGES, {
    label: "Starting page",
    description: "Used when the last page isn't reopened.",
    group: "Startup",
  }),
};

export const WINDOW = {
  alwaysOnTop: config.bool(false, { label: "Always on top", group: "Window" }),
  startAtLogin: config.bool(false, {
    label: "Start at login",
    group: "System",
    platforms: ["win32", "darwin"],
  }),
  startHidden: config.bool(false, {
    label: "Start hidden in the tray",
    description: "Needs the Tray icon plugin; otherwise the window shows as usual.",
    group: "System",
  }),
};

export const ADVANCED = {
  hardwareAcceleration: config.bool(true, {
    label: "Hardware acceleration",
    description: "Turn off if video or animations flicker or the window stays black.",
    group: "Performance",
    restart: true,
  }),
};

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
  port: config.number(26538, { label: "Port", group: "Network", min: 1, max: 65535, step: 1, variant: "stepper" }),
  authStrategy: config.select(
    "AUTH_AT_FIRST",
    [
      { value: "AUTH_AT_FIRST", label: "Ask when a new client connects" },
      { value: "NONE", label: "None (anyone who can reach the port)" },
    ],
    { label: "Authorization", group: "Access" },
  ),
  authorizedClients: config.string("", {
    label: "Authorized clients",
    group: "Access",
    description: "Comma-separated client IDs that may use the API. Remove one to revoke it.",
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

export const CORE_SECTIONS = { general: GENERAL, window: WINDOW, advanced: ADVANCED, apiServer: API_SERVER } as const;

export type CoreSection = keyof typeof CORE_SECTIONS;

export function isCoreSection(name: string): name is CoreSection {
  return Object.hasOwn(CORE_SECTIONS, name);
}
