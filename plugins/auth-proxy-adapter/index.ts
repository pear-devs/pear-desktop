import { config, definePlugin } from "@pear/sdk";
import { type Adapter, startAdapter } from "./adapter.ts";
import { needsAdapter, parseProxy, proxyRule } from "./proxy.ts";

export default definePlugin({
  id: "auth-proxy-adapter",
  name: "Proxy",
  description: "Sends all traffic through an HTTP or SOCKS proxy, including ones that need a username and password.",
  config: {
    url: config.string("", {
      label: "Proxy address",
      placeholder: "socks5://127.0.0.1:1080",
      description: "http://, https://, socks4:// or socks5://. Credentials may also be part of the address.",
    }),
    username: config.string("", { label: "Username" }),
    password: config.string("", { label: "Password", secret: true }),
    bypass: config.string("<local>", {
      label: "Bypass list",
      placeholder: "<local>, *.example.com",
      description: "Comma-separated hosts that connect directly. <local> means plain hostnames such as localhost.",
    }),
    hostname: config.string("127.0.0.1", {
      label: "Adapter address",
      description: "Chromium can't log in to SOCKS proxies, so Pear Desktop runs a local adapter that does it. This is where it listens.",
    }),
    port: config.number(4545, { label: "Adapter port", min: 0, max: 65535, description: "0 picks a free port." }),
  },
  host: {
    async start(ctx) {
      const { config, session } = ctx;
      const proxy = parseProxy(config.url, { username: config.username, password: config.password });

      // Hold requests (incl. the page that is already loading at launch) until the proxy applies.
      let release!: () => void;
      const applied = new Promise<void>((resolve) => (release = resolve));
      ctx.webRequest.onBeforeRequest((_, callback) => void applied.then(() => callback({})));
      ctx.onCleanup(release);

      try {
        let rules = proxyRule(proxy.scheme, proxy.host, proxy.port);
        if (needsAdapter(proxy)) {
          const adapter: Adapter = await startAdapter(
            { ...proxy, type: proxy.scheme === "socks4" ? 4 : 5 },
            { host: config.hostname || "127.0.0.1", port: config.port },
            ctx.log,
          );
          ctx.onCleanup(() => adapter.close());
          rules = proxyRule("socks5", adapter.host, adapter.port);
          ctx.log.info(`SOCKS adapter on ${rules} → ${proxy.host}:${proxy.port}`);
        } else if (proxy.username) {
          const onLogin = (
            event: Electron.Event,
            _contents: unknown,
            _details: unknown,
            auth: Electron.AuthInfo,
            callback: (username?: string, password?: string) => void,
          ) => {
            if (!auth.isProxy || auth.host !== proxy.host || auth.port !== proxy.port) return;
            event.preventDefault();
            callback(proxy.username, proxy.password);
          };
          ctx.listen(ctx.app, "login", onLogin);
        }

        await session.setProxy({ mode: "fixed_servers", proxyRules: rules, proxyBypassRules: config.bypass });
        // Connections opened before keep their old route otherwise.
        await session.closeAllConnections();
        // Turned off, the core then re-applies its own proxy option, if one is set.
        ctx.onCleanup(() => {
          void session.setProxy({ mode: "system" }).then(() => session.closeAllConnections());
        });
        ctx.log.info(`using proxy ${proxyRule(proxy.scheme, proxy.host, proxy.port)}`);
      } finally {
        release();
        ctx.webRequest.onBeforeRequest(null);
      }
    },
  },
});
