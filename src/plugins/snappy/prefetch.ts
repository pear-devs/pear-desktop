/**
 * Page switches in YouTube Music are almost entirely network wait: the app
 * sends a POST to /youtubei/v1/browse and doesn't change the page until the
 * answer comes back (~400ms). The mouse usually rests on a link for a good
 * part of that before the click lands, so start the exact same request on
 * hover, and hand its response to YouTube Music when it asks for that page.
 *
 * Requests are built from the last real browse request YouTube Music sent
 * (same URL, headers and client context), only swapping in the hovered
 * page's browseId/params, so the server sees an ordinary request.
 */

const BROWSE_PATH = '/youtubei/v1/browse';
// Anything that changes library/like/playlist state could make a prefetched
// page stale, so drop every prefetch as soon as one of these goes out.
const MUTATION_PATHS = [
  '/youtubei/v1/like/',
  '/youtubei/v1/feedback',
  '/youtubei/v1/browse/edit_playlist',
  '/youtubei/v1/playlist/',
  '/youtubei/v1/subscription/',
];
// How long the pointer has to rest on a link before prefetching, so sweeping
// the mouse across a grid of cards doesn't fire a request per card.
const HOVER_DELAY = 100;
const ENTRY_TTL = 15_000;
const MAX_ENTRIES = 8;
// Signed-in requests carry a timestamped auth header (SAPISIDHASH). Copying
// an old one could get back a signed-out page, so only prefetch while the
// captured request is recent; otherwise YouTube Music just loads as usual.
const TEMPLATE_MAX_AGE = 5 * 60_000;

type BrowseEndpoint = { browseId: string; params?: string };

type BrowseBody = {
  context?: unknown;
  browseId?: unknown;
  params?: unknown;
  continuation?: unknown;
};

type Template = {
  url: string;
  headers: Headers;
  context: unknown;
  gzip: boolean;
  credentials: RequestCredentials;
  mode: RequestMode;
  referrer: string;
  referrerPolicy: ReferrerPolicy;
  capturedAt: number;
};

type Entry = {
  response: Promise<Response>;
  createdAt: number;
  fingerprint: string;
};

// Only these keys are rebuilt by a prefetch. A real request carrying anything
// else (filters, form data, ...) asks for something different, so never
// answer it from a prefetch.
const PREFETCHABLE_KEYS = new Set(['context', 'browseId', 'params']);

// Headers that legitimately differ between two otherwise identical requests:
// the signed-in auth header embeds a timestamp.
const VOLATILE_HEADERS = new Set(['authorization']);

// Everything about a browse request that can change the response, apart
// from the page itself. A prefetch is only handed out when the real request
// matches the one it was made with - same account, language, client version,
// consistency tokens and so on. Tracking fields are dropped: they're
// analytics only and differ on every navigation (click tracking params,
// and ad signals that include the history length).
const fingerprintOf = (url: string, headers: Headers, context: unknown) => {
  const stable: Record<string, unknown> =
    context && typeof context === 'object'
      ? { ...(context as Record<string, unknown>) }
      : {};
  delete stable.clickTracking;
  delete stable.adSignalsInfo;
  const headerPairs = [...headers]
    .filter(([name]) => !VOLATILE_HEADERS.has(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([url, headerPairs, stable]);
};

const keyOf = (browseId: string, params?: string) =>
  `${browseId}|${params ?? ''}`;

const pathOf = (url: string) => {
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return '';
  }
};

const gunzip = async (data: ArrayBuffer) =>
  new Response(
    new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();

const gzip = async (text: string) =>
  new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();

const readBody = async (request: Request): Promise<BrowseBody | null> => {
  try {
    const raw = await request.clone().arrayBuffer();
    const bytes =
      request.headers.get('content-encoding') === 'gzip'
        ? await gunzip(raw)
        : raw;
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === 'object' ? (body as BrowseBody) : null;
  } catch {
    return null;
  }
};

const endpointFrom = (value: unknown): BrowseEndpoint | null => {
  if (!value || typeof value !== 'object') return null;
  const data = value as {
    navigationEndpoint?: { browseEndpoint?: Partial<BrowseEndpoint> };
    browseEndpoint?: Partial<BrowseEndpoint>;
  };
  const endpoint =
    data.navigationEndpoint?.browseEndpoint ?? data.browseEndpoint;
  if (typeof endpoint?.browseId !== 'string') return null;
  return {
    browseId: endpoint.browseId,
    params: typeof endpoint.params === 'string' ? endpoint.params : undefined,
  };
};

// Polymer elements keep their render data on `.data`; walk up from whatever
// is under the pointer to the nearest element that navigates to a page.
const findEndpoint = (event: Event): BrowseEndpoint | null => {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.tagName === 'YTMUSIC-APP') break;
    const endpoint = endpointFrom((node as { data?: unknown }).data);
    if (endpoint) return endpoint;
  }
  return null;
};

export const installPrefetch = () => {
  const originalFetch = window.fetch;
  const entries = new Map<string, Entry>();
  // Bumped on every mutation, so a browse already waiting on a prefetch
  // can tell its response predates the change.
  let invalidation = 0;
  let template: Template | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverKey: string | null = null;
  let active = true;

  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.createdAt > ENTRY_TTL) entries.delete(key);
    }
    while (entries.size > MAX_ENTRIES) {
      entries.delete(entries.keys().next().value!);
    }
  };

  const prefetch = (endpoint: BrowseEndpoint) => {
    if (!template || Date.now() - template.capturedAt > TEMPLATE_MAX_AGE) {
      return;
    }
    const key = keyOf(endpoint.browseId, endpoint.params);
    prune();
    if (entries.has(key)) return;

    const current = template;
    const json = JSON.stringify({
      context: current.context,
      browseId: endpoint.browseId,
      ...(endpoint.params ? { params: endpoint.params } : {}),
    });
    const response = (async () =>
      originalFetch.call(
        window,
        new Request(current.url, {
          method: 'POST',
          headers: current.headers,
          body: current.gzip ? await gzip(json) : json,
          credentials: current.credentials,
          mode: current.mode,
          referrer: current.referrer,
          referrerPolicy: current.referrerPolicy,
        }),
      ))();
    // Nobody may ever claim this; don't let a failure surface as unhandled.
    response.catch(() => {});
    entries.set(key, {
      response,
      createdAt: Date.now(),
      fingerprint: fingerprintOf(current.url, current.headers, current.context),
    });
  };

  // Resolves to null if the prefetch hasn't answered before the entry
  // expires, so a stalled prefetch never holds up navigation for long.
  const claim = async (entry: Entry) => {
    const remaining = entry.createdAt + ENTRY_TTL - Date.now();
    if (remaining <= 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        entry.response,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remaining);
        }),
      ]);
      return response?.ok ? response : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const handleBrowse = async (request: Request) => {
    const body = await readBody(request);
    if (
      body &&
      body.continuation === undefined &&
      typeof body.browseId === 'string'
    ) {
      template = {
        url: request.url,
        headers: new Headers(request.headers),
        context: body.context,
        gzip: request.headers.get('content-encoding') === 'gzip',
        credentials: request.credentials,
        mode: request.mode,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        capturedAt: Date.now(),
      };

      const key = keyOf(
        body.browseId,
        typeof body.params === 'string' ? body.params : undefined,
      );
      const entry = entries.get(key);
      // One use per prefetch: a later visit to the same page gets fresh data.
      entries.delete(key);
      const plain = Object.keys(body).every((k) => PREFETCHABLE_KEYS.has(k));
      if (
        entry &&
        plain &&
        entry.fingerprint ===
          fingerprintOf(request.url, request.headers, body.context)
      ) {
        const version = invalidation;
        const response = await claim(entry);
        if (response && version === invalidation) return response;
      }
    }
    return originalFetch.call(window, request);
  };

  const patchedFetch: typeof window.fetch = function (
    this: unknown,
    input,
    init,
  ) {
    if (active) {
      const path = pathOf(
        input instanceof Request ? input.url : input.toString(),
      );
      // Invalidate on every call form - fetch(url), fetch(url, init),
      // fetch(request), fetch(request, init).
      if (MUTATION_PATHS.some((prefix) => path.startsWith(prefix))) {
        entries.clear();
        invalidation++;
      } else if (
        path === BROWSE_PATH &&
        input instanceof Request &&
        init === undefined &&
        input.method === 'POST'
      ) {
        return handleBrowse(input);
      }
    }
    return originalFetch.call(this, input, init);
  };

  const onPointerOver = (event: PointerEvent) => {
    const endpoint = findEndpoint(event);
    const key = endpoint ? keyOf(endpoint.browseId, endpoint.params) : null;
    if (key === hoverKey) return;
    hoverKey = key;
    clearTimeout(hoverTimer);
    if (endpoint)
      hoverTimer = setTimeout(() => prefetch(endpoint), HOVER_DELAY);
  };

  // A quick click can land before the hover delay runs out - start right away.
  const onPointerDown = (event: PointerEvent) => {
    const endpoint = findEndpoint(event);
    if (endpoint) {
      clearTimeout(hoverTimer);
      prefetch(endpoint);
    }
  };

  window.fetch = patchedFetch;
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, {
    capture: true,
    passive: true,
  });

  return () => {
    active = false;
    clearTimeout(hoverTimer);
    document.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('pointerdown', onPointerDown, {
      capture: true,
    });
    // Only unpatch if nothing else has wrapped fetch on top of us since.
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
    entries.clear();
  };
};
