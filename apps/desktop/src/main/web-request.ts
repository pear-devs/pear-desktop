// Electron allows a single listener per webRequest event and session, so two
// users (core CSP stripping, an ad blocker, a proxy plugin) would silently
// replace each other. The router installs one real listener per event and
// composes everyone else's: each owner gets a scoped `WebRequest` with
// Electron's exact API, so libraries that take a Session keep working.

import type { Session, WebRequest, WebRequestFilter } from "electron";

type Callback = (response: Record<string, unknown>) => void;
type BlockingListener = (details: any, callback: Callback) => void;
type ObserverListener = (details: any) => void;

const BLOCKING_EVENTS = ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"] as const;
const OBSERVER_EVENTS = ["onSendHeaders", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"] as const;
type BlockingEvent = (typeof BLOCKING_EVENTS)[number];
type ObserverEvent = (typeof OBSERVER_EVENTS)[number];
type EventName = BlockingEvent | ObserverEvent;

interface Registration {
  owner: string;
  filter: WebRequestFilter | undefined;
  listener: (...args: any[]) => void;
}

export class WebRequestRouter {
  #registrations = new Map<EventName, Registration[]>();
  #session: Session;
  #installed = new Set<EventName>();

  constructor(session: Session) {
    this.#session = session;
  }

  /** A WebRequest whose registrations belong to `owner` and compose with everyone else's. */
  scoped(owner: string): WebRequest {
    const scoped: Partial<Record<EventName, unknown>> = {};
    for (const event of [...BLOCKING_EVENTS, ...OBSERVER_EVENTS]) {
      scoped[event] = (filterOrListener?: unknown, maybeListener?: unknown) => {
        const hasFilter = maybeListener !== undefined || (filterOrListener !== null && typeof filterOrListener === "object");
        const filter = hasFilter ? (filterOrListener as WebRequestFilter | null) ?? undefined : undefined;
        const listener = (hasFilter ? maybeListener : filterOrListener) as Registration["listener"] | null | undefined;
        this.#set(event, owner, listener ? { owner, filter, listener } : undefined);
      };
    }
    return scoped as unknown as WebRequest;
  }

  /** A Session proxy whose `webRequest` is scoped to `owner`. */
  scopedSession(owner: string): Session {
    const webRequest = this.scoped(owner);
    return new Proxy(this.#session, {
      get(target, property, receiver) {
        if (property === "webRequest") return webRequest;
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  /** Removes everything `owner` registered. */
  release(owner: string) {
    for (const event of this.#registrations.keys()) this.#set(event, owner, undefined);
  }

  #set(event: EventName, owner: string, registration: Registration | undefined) {
    // Like Electron: one listener per owner and event; registering replaces it.
    const list = (this.#registrations.get(event) ?? []).filter((r) => r.owner !== owner);
    if (registration) list.push(registration);
    this.#registrations.set(event, list);
    if (list.length > 0) this.#install(event);
  }

  #install(event: EventName) {
    if (this.#installed.has(event)) return;
    this.#installed.add(event);
    const webRequest = this.#session.webRequest as unknown as Record<EventName, (listener: unknown) => void>;
    if ((BLOCKING_EVENTS as readonly string[]).includes(event)) {
      webRequest[event]((details: any, callback: Callback) => void this.#runBlocking(event as BlockingEvent, details, callback));
    } else {
      webRequest[event]((details: any) => {
        for (const r of this.#matching(event, details)) safely(() => (r.listener as ObserverListener)(details));
      });
    }
  }

  #matching(event: EventName, details: { url: string; resourceType?: string }) {
    return (this.#registrations.get(event) ?? []).filter((r) => matchesFilter(r.filter, details));
  }

  async #runBlocking(event: BlockingEvent, details: any, callback: Callback) {
    const result: Record<string, unknown> = {};
    let current = details;
    for (const r of this.#matching(event, details)) {
      const response = await new Promise<Record<string, unknown>>((resolve) => {
        try {
          (r.listener as BlockingListener)(current, (value) => resolve(value ?? {}));
        } catch (error) {
          console.error(`[pear] webRequest ${event} listener of ${r.owner} threw`, error);
          resolve({});
        }
      });
      if (response.cancel || response.redirectURL) {
        callback(response);
        return;
      }
      if (response.requestHeaders) {
        current = { ...current, requestHeaders: response.requestHeaders };
        result.requestHeaders = response.requestHeaders;
      }
      if (response.responseHeaders) {
        current = { ...current, responseHeaders: response.responseHeaders };
        result.responseHeaders = response.responseHeaders;
      }
      if (response.statusLine) result.statusLine = response.statusLine;
    }
    callback(result);
  }
}

function safely(fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.error("[pear] webRequest observer threw", error);
  }
}

export function matchesFilter(filter: WebRequestFilter | undefined, details: { url: string; resourceType?: string }) {
  if (!filter) return true;
  if (filter.urls.length > 0 && !filter.urls.some((p) => matchPattern(p, details.url))) return false;
  if (filter.excludeUrls?.some((p) => matchPattern(p, details.url))) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(details.resourceType as never)) return false;
  return true;
}

/** Chrome-style match patterns: `<all_urls>`, `scheme://host/path` with `*` wildcards. */
export function matchPattern(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return true;
  const match = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
  const target = URL.parse(url);
  if (!match || !target) return false;
  const [, scheme, host = "", path = "/*"] = match;
  const targetScheme = target.protocol.slice(0, -1);
  if (scheme === "*" ? !["http", "https", "ws", "wss"].includes(targetScheme) : scheme !== targetScheme) return false;
  if (host !== "*") {
    if (host.startsWith("*.")) {
      const base = host.slice(2);
      if (target.hostname !== base && !target.hostname.endsWith(`.${base}`)) return false;
    } else if (target.host !== host && target.hostname !== host) {
      return false;
    }
  }
  const pathRegex = new RegExp(`^${path.split("*").map(escapeRegExp).join(".*")}$`);
  return pathRegex.test(target.pathname + target.search);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
