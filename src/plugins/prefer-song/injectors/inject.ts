interface TextRuns {
  runs: { text: string }[];
}

interface Thumbnails {
  thumbnails: { url: string; width: number; height: number }[];
}

interface QueueItem {
  videoId?: string;
  playlistSetVideoId?: string;
  title?: TextRuns;
  longBylineText?: TextRuns;
  shortBylineText?: TextRuns;
  lengthText?: TextRuns;
  thumbnail?: Thumbnails;
}

interface AlbumRow {
  playlistItemData?: { videoId?: string };
}

export function installPreferSong() {
  const originalFetch = window.fetch.bind(window);
  const studioIdByRowId = new Map<string, string>();
  const albumRequests = new Map<string, Promise<void>>();
  const playlistRequests = new Map<string, Promise<void>>();
  const studioItemRequests = new Map<string, Promise<QueueItem | undefined>>();

  const gunzip = (buffer: ArrayBuffer) =>
    new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();

  const gzip = (text: string) =>
    new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();

  const innertube = async (path: string, body: Record<string, string>) => {
    const config = (
      window as unknown as { ytcfg: { get(key: string): unknown } }
    ).ytcfg;
    const key = config.get('INNERTUBE_API_KEY') as string;
    const response = await originalFetch(
      '/youtubei/v1/' + path + '?key=' + key + '&prettyPrint=false',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: config.get('INNERTUBE_CONTEXT'),
          ...body,
        }),
      },
    );
    return await response.json();
  };

  const collect = <T>(data: unknown, key: string): T[] => {
    const found: T[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record[key]) found.push(record[key] as T);
      for (const child of Object.values(record)) walk(child);
    };
    walk(data);
    return found;
  };

  const creditsVideoId = (row: unknown) => {
    let credits: string | undefined;
    const walk = (node: unknown) => {
      if (credits || !node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (
          key === 'browseId' &&
          typeof value === 'string' &&
          value.startsWith('MPTC')
        ) {
          credits = value.slice(4);
          return;
        }
        walk(value);
      }
    };
    walk(row);
    return credits;
  };

  const albumPlaylistId = (value: unknown) =>
    typeof value === 'string' && value.startsWith('OLAK5uy_') ? value : null;

  const loadAlbum = (browseId: string) => {
    const pending = albumRequests.get(browseId);
    if (pending) return pending;

    const request = (async () => {
      const rows = collect<AlbumRow>(
        await innertube('browse', { browseId }),
        'musicResponsiveListItemRenderer',
      );
      for (const row of rows) {
        const rowId = row.playlistItemData?.videoId;
        const studioId = creditsVideoId(row);
        if (rowId && studioId) studioIdByRowId.set(rowId, studioId);
      }
    })();
    albumRequests.set(browseId, request);
    return request;
  };

  const loadAlbumOfPlaylist = (playlistId: string) => {
    const pending = playlistRequests.get(playlistId);
    if (pending) return pending;

    const request = (async () => {
      const queue = JSON.stringify(await innertube('next', { playlistId }));
      const browseId = /MPREb_[A-Za-z0-9_-]+/.exec(queue)?.[0];
      if (browseId) await loadAlbum(browseId);
    })();
    playlistRequests.set(playlistId, request);
    return request;
  };

  const studioQueueItem = (videoId: string) => {
    const pending = studioItemRequests.get(videoId);
    if (pending) return pending;

    const request = (async () => {
      const items = collect<QueueItem>(
        await innertube('next', { videoId }),
        'playlistPanelVideoRenderer',
      );
      return items.find((item) => item.videoId === videoId);
    })();
    studioItemRequests.set(videoId, request);
    return request;
  };

  const studioIdFor = (videoId: string) => {
    const studioId = studioIdByRowId.get(videoId);
    return studioId && studioId !== videoId ? studioId : null;
  };

  const swapQueueItem = async (item: QueueItem) => {
    const rowId = item.videoId;
    if (!rowId || !item.playlistSetVideoId) return;
    const studioId = studioIdFor(rowId);
    if (!studioId) return;
    const studio = await studioQueueItem(studioId);
    if (!studio) return;

    const swapped = JSON.parse(
      JSON.stringify(item)
        .split(rowId)
        .join(studioId)
        .split('MUSIC_VIDEO_TYPE_OMV')
        .join('MUSIC_VIDEO_TYPE_ATV'),
    ) as QueueItem;
    for (const key of Object.keys(item)) delete item[key as keyof QueueItem];
    Object.assign(item, swapped);

    item.title = studio.title;
    item.longBylineText = studio.longBylineText;
    item.shortBylineText = studio.shortBylineText;
    item.lengthText = studio.lengthText;
    item.thumbnail = studio.thumbnail;
  };

  const patchQueueResponse = async (
    response: Response,
    playlistId: string | null,
  ) => {
    if (!playlistId) return response;
    await loadAlbumOfPlaylist(playlistId);

    const queue: unknown = JSON.parse(await response.text());
    await Promise.all(
      collect<QueueItem>(queue, 'playlistPanelVideoRenderer').map(
        swapQueueItem,
      ),
    );
    return new Response(JSON.stringify(queue), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const requestBodyOf = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    if (typeof init?.body === 'string') {
      return { text: init.body, gzipped: false, inline: true };
    }
    if (!(input instanceof Request)) return null;

    const buffer = await input.clone().arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = gzipped
      ? await gunzip(buffer)
      : new TextDecoder().decode(buffer);
    return { text, gzipped, inline: false };
  };

  const patchPlayerRequest = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const source = await requestBodyOf(input, init);
    if (!source) return originalFetch(input, init);

    const body = JSON.parse(source.text) as Record<string, unknown>;
    const requestedId = body.videoId;
    if (typeof requestedId !== 'string') return originalFetch(input, init);

    if (!studioIdByRowId.has(requestedId)) {
      const playlistId =
        albumPlaylistId(body.playlistId) ??
        albumPlaylistId(new URLSearchParams(location.search).get('list'));
      if (playlistId) await loadAlbumOfPlaylist(playlistId);
    }

    const studioId = studioIdFor(requestedId);
    if (!studioId) return originalFetch(input, init);

    body.videoId = studioId;
    const patched = source.gzipped
      ? await gzip(JSON.stringify(body))
      : JSON.stringify(body);
    return source.inline
      ? originalFetch(input, { ...init, body: patched })
      : originalFetch(new Request(input as Request, { body: patched }));
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    try {
      if (url.includes('/youtubei/v1/next')) {
        const source = await requestBodyOf(input, init);
        const body = source
          ? (JSON.parse(source.text) as Record<string, unknown>)
          : null;
        return await patchQueueResponse(
          await originalFetch(input, init),
          albumPlaylistId(body?.playlistId),
        );
      }
      if (url.includes('/youtubei/v1/player')) {
        return await patchPlayerRequest(input, init);
      }
    } catch {
      return originalFetch(input, init);
    }
    return originalFetch(input, init);
  };
}
