// Schemas of the core's own settings sections, rendered in the settings
// overlay next to the plugins with the same field builders.

import { config, type ConfigOf } from "./config.ts";

export const API_SERVER = {
  enabled: config.bool(false, {
    label: "Enable the API server",
    description: "Lets other apps control playback and read the current song over HTTP and WebSocket.",
  }),
  hostname: config.string("127.0.0.1", {
    label: "Hostname",
    description: "127.0.0.1 accepts connections only from this computer; 0.0.0.0 from your network too.",
  }),
  port: config.number(26538, { label: "Port", min: 1, max: 65535, step: 1 }),
  authStrategy: config.select(
    "AUTH_AT_FIRST",
    [
      { value: "AUTH_AT_FIRST", label: "Ask when a new client connects" },
      { value: "NONE", label: "None (anyone who can reach the port)" },
    ],
    { label: "Authorization" },
  ),
  authorizedClients: config.string("", {
    label: "Authorized clients",
    description: "Comma-separated client IDs that may use the API. Remove one to revoke it.",
  }),
  secret: config.string("", {
    label: "Token secret",
    secret: true,
    description: "Signs access tokens; changing it signs every client out. Generated when empty.",
  }),
  useHttps: config.bool(false, { label: "Use HTTPS" }),
  certPath: config.string("", { label: "Certificate file", placeholder: "/path/to/cert.pem" }),
  keyPath: config.string("", { label: "Private key file", placeholder: "/path/to/key.pem" }),
};

export type ApiServerConfig = ConfigOf<typeof API_SERVER>;

export const CORE_SECTIONS = { apiServer: API_SERVER } as const;

export type CoreSection = keyof typeof CORE_SECTIONS;

export function isCoreSection(name: string): name is CoreSection {
  return Object.hasOwn(CORE_SECTIONS, name);
}
