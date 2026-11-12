// Electron allows a single listener per webRequest event and session, so two
// users (core CSP stripping, an ad blocker, a proxy plugin) would silently
// replace each other. The router installs one real listener per event and
// composes everyone else's: each owner gets a scoped `WebRequest` with
// Electron's exact API, so libraries that take a Session keep working.

import type { Session, WebRequest, WebRequestFilter } from "electron";

type Response = Record<string, unknown>;
type Callback = (response: Response) => void;
/** Electron's details object; its fields depend on the event. */
type Details = { url: string; resourceType?: string; [key: string]: unknown };
/** Blocking events' listeners get a callback, observers' don't. */
type Listener = (details: Details, callback?: Callback) => void;

const BLOCKING_EVENTS = ["onBeforeRequest", "onBeforeSendHeaders", "onHeadersReceived"] as const;
const OBSERVER_EVENTS = ["onSendHeaders", "onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"] as const;
/** Headers a blocking listener may replace; later listeners see the replaced ones. */
const HEADER_KEYS = ["requestHeaders", "responseHeaders"] as const;
type BlockingEvent = (typeof BLOCKING_EVENTS)[number];
type ObserverEvent = (typeof OBSERVER_EVENTS)[number];
type EventName = BlockingEvent | ObserverEvent;

interface Registration {
  owner: string;
  filter: WebRequestFilter | undefined;
  listener: Listener;
}

export class WebRequestRouter {
  #registrations = new Map<EventName, Registration[]>();
  #session: Session;
  #installed = new Set<EventName>();

  constructor(session: Session) {
    this.#session = session;
  }

  /**
   * A WebRequest whose registrations belong to `owner` and compose with everyone else's.
   * Calls are ignored once `active` is false: a stopped plugin's late registrations
   * would outlive it, or replace those of its restarted successor (same owner).
   */
  scoped(owner: string, active: () => boolean = () => true): WebRequest {
    const scoped: Partial<Record<EventName, unknown>> = {};
    for (const event of [...BLOCKING_EVENTS, ...OBSERVER_EVENTS]) {
      scoped[event] = (filterOrListener?: unknown, maybeListener?: unknown) => {
        if (!active()) return;
        const hasFilter = maybeListener !== undefined || (filterOrListener !== null && typeof filterOrListener === "object");
        const filter = hasFilter ? (filterOrListener as WebRequestFilter | null) ?? undefined : undefined;
        // Electron's own overloads type the arguments for callers; here they are what was passed.
        const listener = (hasFilter ? maybeListener : filterOrListener) as Listener | null | undefined;
        this.#set(event, owner, listener ? { owner, filter, listener } : undefined);
      };
    }
    // Every event method is set above; TypeScript can't follow the loop.
    return scoped as unknown as WebRequest;
  }

  /** A Session proxy whose `webRequest` is scoped to `owner`. */
  scopedSession(owner: string, active?: () => boolean): Session {
    const webRequest = this.scoped(owner, active);
    return new Proxy(this.#session, {
      get(target, property) {
        if (property === "webRequest") return webRequest;
        // The session itself as `this`: native getters (cookies, protocol…) refuse the proxy.
        const value = Reflect.get(target, property, target);
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
    // Each method's overloads differ; all take a listener alone, typed by the router's own types.
    const webRequest = this.#session.webRequest as unknown as Record<EventName, (listener: Listener) => void>;
    if (isBlocking(event)) {
      webRequest[event]((details, callback) => void this.#runBlocking(event, details, callback!));
    } else {
      webRequest[event]((details) => {
        for (const r of this.#matching(event, details)) safely(() => r.listener(details));
      });
    }
  }

  #matching(event: EventName, details: { url: string; resourceType?: string }) {
    return (this.#registrations.get(event) ?? []).filter((r) => matchesFilter(r.filter, details));
  }

  async #runBlocking(event: BlockingEvent, details: Details, callback: Callback) {
    const result: Response = {};
    let current = details;
    for (const r of this.#matching(event, details)) {
      const response = await new Promise<Response>((resolve) => {
        try {
          r.listener(current, (value) => resolve(value ?? {}));
        } catch (error) {
          console.error(`[pear] webRequest ${event} listener of ${r.owner} threw`, error);
          resolve({});
        }
      });
      if (response.cancel || response.redirectURL) {
        callback(response);
        return;
      }
      for (const key of HEADER_KEYS) {
        if (!response[key]) continue;
        current = { ...current, [key]: response[key] };
        result[key] = response[key];
      }
      if (response.statusLine) result.statusLine = response.statusLine;
    }
    callback(result);
  }
}

function isBlocking(event: EventName): event is BlockingEvent {
  return (BLOCKING_EVENTS as readonly string[]).includes(event);
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
  if (filter.types && filter.types.length > 0 && !filter.types.includes(details.resourceType as never)) return false;
  const target = URL.parse(details.url);
  const matches = (pattern: string) => !!target && compiledPattern(pattern)(target);
  if (filter.urls.length > 0 && !filter.urls.some(matches)) return false;
  if (filter.excludeUrls?.some(matches)) return false;
  return true;
}

/** Chrome-style match patterns: `<all_urls>`, `scheme://host/path` with `*` wildcards. */
export function matchPattern(pattern: string, url: string): boolean {
  const target = URL.parse(url);
  return !!target && compiledPattern(pattern)(target);
}

type CompiledPattern = (target: URL) => boolean;

/** Patterns are few and checked on every request, so each is parsed once. */
const compiled = new Map<string, CompiledPattern>();

function compiledPattern(pattern: string): CompiledPattern {
  let matcher = compiled.get(pattern);
  if (!matcher) {
    matcher = compilePattern(pattern);
    compiled.set(pattern, matcher);
  }
  return matcher;
}

const WILDCARD_SCHEMES = ["http", "https", "ws", "wss"];

function compilePattern(pattern: string): CompiledPattern {
  if (pattern === "<all_urls>") return () => true;
  const match = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
  if (!match) return () => false;
  const [, scheme, host = "", path = "/*"] = match;
  const pathRegex = new RegExp(`^${path.split("*").map(escapeRegExp).join(".*")}$`);
  return (target) => {
    const targetScheme = target.protocol.slice(0, -1);
    const schemeMatches = scheme === "*" ? WILDCARD_SCHEMES.includes(targetScheme) : scheme === targetScheme;
    return schemeMatches && hostMatches(host, target) && pathRegex.test(target.pathname + target.search);
  };
}

function hostMatches(host: string, target: URL) {
  if (host === "*") return true;
  if (!host.startsWith("*.")) return target.host === host || target.hostname === host;
  const base = host.slice(2);
  return target.hostname === base || target.hostname.endsWith(`.${base}`);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
