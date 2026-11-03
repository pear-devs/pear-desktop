/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-argument */
// Minimal authenticated InnerTube client, running in the YouTube Music page.
// Responses are deeply nested untyped JSON, hence the relaxed lint rules above.

export interface PlaylistRef {
  id: string;
  title: string;
}

type Json = any; // oxlint-disable-line no-explicit-any

interface YtCfg {
  get(key: string): unknown;
}

const getCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const sha1 = async (text: string) => {
  const buf = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const authHeader = async () => {
  const sapisid = getCookie('SAPISID') ?? getCookie('__Secure-3PAPISID');
  if (!sapisid) return undefined;
  const origin = location.origin;
  const ts = Math.floor(Date.now() / 1000);
  return `SAPISIDHASH ${ts}_${await sha1(`${ts} ${sapisid} ${origin}`)}`;
};

const post = async (
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Json> => {
  const ytcfg = (window as unknown as { ytcfg?: YtCfg }).ytcfg;
  const key = ytcfg?.get('INNERTUBE_API_KEY');
  const context = ytcfg?.get('INNERTUBE_CONTEXT');
  if (typeof key !== 'string' || !context) throw new Error('ytcfg not ready');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-AuthUser': '0',
    'X-Origin': location.origin,
  };
  const auth = await authHeader();
  if (auth) headers.Authorization = auth;

  const res = await fetch(
    `/youtubei/v1/${endpoint}?prettyPrint=false&key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context, ...body }),
    },
  );
  if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
  return res.json();
};

const browse = (body: Record<string, unknown>) => post('browse', body);

/** Adds or removes a song from a playlist the user owns. Throws if YouTube refuses. */
export const setPlaylistMembership = async (
  playlistId: string,
  videoId: string,
  member: boolean,
): Promise<void> => {
  const action = member
    ? { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }
    : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId };
  const data = await post('browse/edit_playlist', {
    playlistId,
    actions: [action],
  });
  if (data?.status !== 'STATUS_SUCCEEDED') {
    throw new Error(`edit_playlist: ${data?.status ?? 'unknown status'}`);
  }
};

const walk = (node: Json, visit: (key: string, value: Json) => void) => {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      visit(key, value);
      walk(value, visit);
    }
  }
};

const findContinuation = (data: Json): string | undefined => {
  let token: string | undefined;
  walk(data, (key, value) => {
    if (token) return;
    if (key === 'nextContinuationData' && value?.continuation) {
      token = value.continuation;
    } else if (key === 'continuationCommand' && value?.token) {
      token = value.token;
    }
  });
  return token;
};

/** Runs a browse request and follows continuations, calling `collect` on each page. */
const browseAll = async (
  browseId: string,
  collect: (page: Json) => void,
  maxPages = 100,
) => {
  let page = await browse({ browseId });
  collect(page);
  for (let i = 0; i < maxPages; i++) {
    const token = findContinuation(page);
    if (!token) break;
    page = await browse({ continuation: token });
    collect(page);
  }
};

export const fetchLibraryPlaylists = async (): Promise<PlaylistRef[]> => {
  const found = new Map<string, PlaylistRef>();
  await browseAll('FEmusic_liked_playlists', (page) =>
    walk(page, (key, value) => {
      if (key === 'musicTwoRowItemRenderer') {
        const id: string | undefined =
          value?.navigationEndpoint?.browseEndpoint?.browseId;
        const title: string | undefined = value?.title?.runs?.[0]?.text;
        if (id?.startsWith('VL') && title) {
          found.set(id.slice(2), { id: id.slice(2), title });
        }
      }
    }),
  );
  return [...found.values()];
};

export const fetchPlaylistVideoIds = async (
  playlistId: string,
): Promise<Set<string>> => {
  const ids = new Set<string>();
  await browseAll(`VL${playlistId}`, (page) =>
    walk(page, (key, value) => {
      if (key === 'musicResponsiveListItemRenderer') {
        const id: string | undefined = value?.playlistItemData?.videoId;
        if (id) ids.add(id);
      }
    }),
  );
  return ids;
};
