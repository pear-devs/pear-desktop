// Proxy settings → what Chromium can use. Chromium handles HTTP(S) proxy
// credentials (through the app's "login" event) but not SOCKS credentials, so
// authenticated SOCKS proxies go through the local adapter instead.

export type ProxyScheme = "http" | "https" | "socks4" | "socks5";

export interface ProxyServer {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
}

const DEFAULT_PORTS: Record<ProxyScheme, number> = { http: 80, https: 443, socks4: 1080, socks5: 1080 };
const SCHEME_ALIASES: Record<string, ProxyScheme> = {
  http: "http",
  https: "https",
  socks: "socks5",
  socks4: "socks4",
  socks4a: "socks4",
  socks5: "socks5",
  socks5h: "socks5",
};

/** Parses `scheme://[user[:password]@]host[:port]`; explicit credentials win over the URL's. */
export function parseProxy(input: string, credentials: { username?: string; password?: string } = {}): ProxyServer {
  const text = input.trim();
  if (!text) throw new Error("Enter a proxy address in the plugin settings, e.g. socks5://127.0.0.1:1080");
  const url = URL.parse(text.includes("://") ? text : `http://${text}`);
  const scheme = url ? SCHEME_ALIASES[url.protocol.slice(0, -1).toLowerCase()] : undefined;
  if (!url || !url.hostname) throw new Error(`"${text}" is not a proxy address (expected e.g. socks5://host:1080)`);
  if (!scheme) throw new Error(`Unsupported proxy type "${url.protocol}"; use http, https, socks4 or socks5`);
  return {
    scheme,
    // URL keeps IPv6 brackets; Node's net APIs want them stripped.
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: url.port ? Number(url.port) : DEFAULT_PORTS[scheme],
    username: credentials.username || decodeURIComponent(url.username),
    password: credentials.password || decodeURIComponent(url.password),
  };
}

export const needsAdapter = (proxy: ProxyServer) =>
  proxy.username !== "" && (proxy.scheme === "socks4" || proxy.scheme === "socks5");

export function proxyRule(scheme: ProxyScheme, host: string, port: number) {
  return `${scheme}://${host.includes(":") ? `[${host}]` : host}:${port}`;
}
