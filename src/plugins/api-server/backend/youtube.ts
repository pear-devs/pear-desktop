import { net } from 'electron';

// Helpers for working with YouTube / YouTube Music internal API (innertube) responses

type InnertubeRequest = <T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
) => Promise<T>;

type UnknownObject = Record<string, unknown>;

const isObject = (value: unknown): value is UnknownObject =>
  typeof value === 'object' && value !== null;

const get = (value: unknown, ...path: (string | number)[]): unknown => {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
};

const getString = (value: unknown, ...path: (string | number)[]) => {
  const result = get(value, ...path);
  return typeof result === 'string' ? result : undefined;
};

// Converts `{ simpleText }` / `{ runs: [{ text }] }` / `{ content }` into a plain string
const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return undefined;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => getString(run, 'text') ?? '').join('');
  }
  return undefined;
};

// Depth-first search through a response, returning the first non-undefined match
const findFirst = <T>(
  value: unknown,
  matcher: (obj: UnknownObject) => T | undefined,
): T | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirst(item, matcher);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;

  const matched = matcher(value);
  if (matched !== undefined) return matched;

  for (const child of Object.values(value)) {
    const found = findFirst(child, matcher);
    if (found !== undefined) return found;
  }
  return undefined;
};

const findAll = (
  value: unknown,
  key: string,
  results: unknown[] = [],
): unknown[] => {
  if (Array.isArray(value)) {
    for (const item of value) findAll(item, key, results);
  } else if (isObject(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey === key) results.push(child);
      else findAll(child, key, results);
    }
  }
  return results;
};

const continuationTokenOf = (obj: UnknownObject) =>
  getString(obj, 'continuationCommand', 'token') ??
  getString(obj, 'nextContinuationData', 'continuation') ??
  getString(obj, 'reloadContinuationData', 'continuation');

/* ------------------------------ Watch next ------------------------------ */

export const getWatchNext = (request: InnertubeRequest, videoId: string) =>
  request('/next', { videoId, isAudioOnly: true });

export type WatchNextTab = {
  title?: string;
  browseId?: string;
  pageType?: string;
};

export const getWatchNextTabs = (watchNext: unknown): WatchNextTab[] => {
  const tabs = get(
    watchNext,
    'contents',
    'singleColumnMusicWatchNextResultsRenderer',
    'tabbedRenderer',
    'watchNextTabbedResultsRenderer',
    'tabs',
  );
  if (!Array.isArray(tabs)) return [];

  return tabs.map((tab) => {
    const renderer = get(tab, 'tabRenderer');
    return {
      title: getString(renderer, 'title'),
      browseId: getString(renderer, 'endpoint', 'browseEndpoint', 'browseId'),
      pageType: getString(
        renderer,
        'endpoint',
        'browseEndpoint',
        'browseEndpointContextSupportedConfigs',
        'browseEndpointContextMusicConfig',
        'pageType',
      ),
    };
  });
};

const findTab = (tabs: WatchNextTab[], pageType: string, fallback: number) =>
  tabs.find((tab) => tab.pageType === pageType) ??
  (tabs[fallback]?.browseId?.startsWith(
    pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' ? 'MPLY' : 'MPTR',
  )
    ? tabs[fallback]
    : undefined);

export const getLyricsBrowseId = (watchNext: unknown) =>
  findTab(getWatchNextTabs(watchNext), 'MUSIC_PAGE_TYPE_TRACK_LYRICS', 1)
    ?.browseId;

export const getRelatedBrowseId = (watchNext: unknown) =>
  findTab(getWatchNextTabs(watchNext), 'MUSIC_PAGE_TYPE_TRACK_RELATED', 2)
    ?.browseId;

export const parseLyrics = (lyricsPage: unknown) =>
  findFirst(lyricsPage, (obj) => {
    const shelf = obj.musicDescriptionShelfRenderer;
    if (!isObject(shelf)) return undefined;
    return {
      lyrics: textOf(shelf.description) ?? null,
      source: textOf(shelf.footer) ?? null,
    };
  }) ?? null;

/* ------------------------------- Comments ------------------------------- */

export type Comment = {
  commentId: string;
  author: string | null;
  authorChannelId: string | null;
  authorThumbnail: string | null;
  isVerified: boolean;
  isCreator: boolean;
  text: string;
  publishedTime: string | null;
  likeCount: string | null;
  replyCount: string | null;
  isPinned: boolean;
};

export type CommentsPage = {
  videoId: string;
  commentsAvailable: boolean;
  commentCount: string | null;
  comments: Comment[];
  continuation: string | null;
};

export type CommentsSort = 'top' | 'newest';

const COMMENTS_IDENTIFIER_KEYS = ['sectionIdentifier', 'panelIdentifier'];

// Finds the continuation token which loads the comment section of a `/next` response
export const findCommentsToken = (watchNext: unknown) =>
  findFirst(watchNext, (obj) => {
    const isCommentsSection = COMMENTS_IDENTIFIER_KEYS.some((key) => {
      const identifier = obj[key];
      return typeof identifier === 'string' && /comment/i.test(identifier);
    });
    if (!isCommentsSection) return undefined;
    return findFirst(obj, continuationTokenOf);
  });

// "Top comments" / "Newest first" tokens from the comments header
const findSortTokens = (page: unknown) =>
  findFirst(page, (obj) => {
    const items = get(obj, 'sortFilterSubMenuRenderer', 'subMenuItems');
    if (!Array.isArray(items)) return undefined;
    return items
      .map((item) => findFirst(item, continuationTokenOf))
      .filter((token): token is string => !!token);
  }) ?? [];

// Top-level items of a continuation response (comment threads + "load more" item)
const getContinuationItems = (page: unknown): unknown[] => {
  const items: unknown[] = [];
  const endpoints = get(page, 'onResponseReceivedEndpoints');
  if (Array.isArray(endpoints)) {
    for (const endpoint of endpoints) {
      const continuationItems =
        get(endpoint, 'reloadContinuationItemsCommand', 'continuationItems') ??
        get(endpoint, 'appendContinuationItemsAction', 'continuationItems');
      if (Array.isArray(continuationItems)) items.push(...continuationItems);
    }
  }
  return items;
};

const parseLegacyComment = (renderer: UnknownObject): Comment | null => {
  const commentId = getString(renderer, 'commentId');
  if (!commentId) return null;

  const thumbnails = get(renderer, 'authorThumbnail', 'thumbnails');
  return {
    commentId,
    author: textOf(renderer.authorText) ?? null,
    authorChannelId:
      getString(renderer, 'authorEndpoint', 'browseEndpoint', 'browseId') ??
      null,
    authorThumbnail: Array.isArray(thumbnails)
      ? (getString(thumbnails.at(-1), 'url') ?? null)
      : null,
    isVerified: !!renderer.authorCommentBadge,
    isCreator: !!renderer.authorIsChannelOwner,
    text: textOf(renderer.contentText) ?? '',
    publishedTime: textOf(renderer.publishedTimeText) ?? null,
    likeCount: textOf(renderer.voteCount) ?? null,
    replyCount:
      typeof renderer.replyCount === 'number'
        ? String(renderer.replyCount)
        : null,
    isPinned: !!renderer.pinnedCommentBadge,
  };
};

const parseCommentEntity = (
  payload: UnknownObject,
  pinnedIds: Set<string>,
): Comment | null => {
  const properties = get(payload, 'properties');
  const author = get(payload, 'author');
  const toolbar = get(payload, 'toolbar');
  const commentId = getString(properties, 'commentId');
  if (!commentId) return null;

  return {
    commentId,
    author: getString(author, 'displayName') ?? null,
    authorChannelId: getString(author, 'channelId') ?? null,
    authorThumbnail: getString(author, 'avatarThumbnailUrl') ?? null,
    isVerified: !!get(author, 'isVerified'),
    isCreator: !!get(author, 'isCreator'),
    text: textOf(get(properties, 'content')) ?? '',
    publishedTime: getString(properties, 'publishedTime') ?? null,
    likeCount: getString(toolbar, 'likeCountNotliked')?.trim() || null,
    replyCount: getString(toolbar, 'replyCount')?.trim() || null,
    isPinned: pinnedIds.has(commentId),
  };
};

export const parseCommentsPage = (page: unknown) => {
  const items = getContinuationItems(page);

  // Newer responses keep comment data in `frameworkUpdates` entities,
  // referenced from `commentViewModel`s in the items
  const entities = new Map<string, UnknownObject>();
  for (const mutation of findAll(
    get(page, 'frameworkUpdates'),
    'commentEntityPayload',
  )) {
    if (!isObject(mutation)) continue;
    const key = getString(mutation, 'key');
    if (key) entities.set(key, mutation);
  }

  const comments: Comment[] = [];
  const seen = new Set<string>();
  const push = (comment: Comment | null) => {
    if (!comment || seen.has(comment.commentId)) return;
    seen.add(comment.commentId);
    comments.push(comment);
  };

  for (const item of items) {
    const thread = get(item, 'commentThreadRenderer');
    if (!isObject(thread)) continue;

    const viewModel = get(thread, 'commentViewModel', 'commentViewModel');
    const legacy = get(thread, 'comment', 'commentRenderer');
    if (isObject(viewModel)) {
      const entity = entities.get(getString(viewModel, 'commentKey') ?? '');
      const pinned = new Set<string>();
      const commentId = getString(viewModel, 'commentId');
      if (commentId && viewModel.pinnedText) pinned.add(commentId);
      if (entity) push(parseCommentEntity(entity, pinned));
    } else if (isObject(legacy)) {
      push(parseLegacyComment(legacy));
    }
  }

  // Fallback for unknown layouts: take every comment we can find
  if (comments.length === 0) {
    for (const entity of entities.values()) {
      push(parseCommentEntity(entity, new Set()));
    }
    for (const renderer of findAll(page, 'commentRenderer')) {
      if (isObject(renderer)) push(parseLegacyComment(renderer));
    }
  }

  const lastItem = items.at(-1);
  const continuationRenderer = get(lastItem, 'continuationItemRenderer');
  const continuation = isObject(continuationRenderer)
    ? (findFirst(continuationRenderer, continuationTokenOf) ?? null)
    : null;

  const commentCount =
    findFirst(page, (obj) => {
      const header = obj.commentsHeaderRenderer;
      if (!isObject(header)) return undefined;
      return textOf(header.countText) ?? textOf(header.commentsCount);
    }) ?? null;

  return {
    comments,
    continuation,
    commentCount,
    sortTokens: findSortTokens(page),
  };
};

// Fallback when YouTube Music does not expose comments for a video:
// use the regular YouTube web client, which is where the comments live
const WEB_CLIENT_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20250925.01.00',
    hl: 'en',
  },
};

const youtubeWebRequest: InnertubeRequest = async <T>(
  endpoint: string,
  body: Record<string, unknown>,
) => {
  const response = await net.fetch(
    `https://www.youtube.com/youtubei/v1${endpoint}?prettyPrint=false`,
    {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: WEB_CLIENT_CONTEXT, ...body }),
    },
  );
  if (!response.ok) {
    throw new Error(`YouTube responded with ${response.status}`);
  }
  return (await response.json()) as T;
};

export const getComments = async (
  musicRequest: InnertubeRequest,
  videoId: string,
  { continuation, sort }: { continuation?: string; sort?: CommentsSort },
): Promise<CommentsPage> => {
  const result = (
    page: ReturnType<typeof parseCommentsPage> | null,
  ): CommentsPage => ({
    videoId,
    commentsAvailable: !!page,
    commentCount: page?.commentCount ?? null,
    comments: page?.comments ?? [],
    continuation: page?.continuation ?? null,
  });

  // Continuation tokens are prefixed with the client which issued them,
  // so the same client keeps being used for the next pages
  if (continuation) {
    const [client, token] = continuation.includes(':')
      ? [continuation.slice(0, 3), continuation.slice(4)]
      : ['web', continuation];
    const request = client === 'ytm' ? musicRequest : youtubeWebRequest;
    const page = parseCommentsPage(
      await request('/next', { continuation: token }),
    );
    return result({
      ...page,
      continuation: page.continuation ? `${client}:${page.continuation}` : null,
    });
  }

  const sources: [string, InnertubeRequest][] = [
    ['ytm', musicRequest],
    ['web', youtubeWebRequest],
  ];
  for (const [client, request] of sources) {
    try {
      const token = findCommentsToken(await request('/next', { videoId }));
      if (!token) continue;

      let page = parseCommentsPage(
        await request('/next', { continuation: token }),
      );
      if (sort === 'newest' && page.sortTokens[1]) {
        page = parseCommentsPage(
          await request('/next', { continuation: page.sortTokens[1] }),
        );
      }
      if (page.comments.length === 0 && !page.continuation) continue;

      return result({
        ...page,
        continuation: page.continuation
          ? `${client}:${page.continuation}`
          : null,
      });
    } catch (error) {
      console.error(`[api-server] failed to load comments (${client})`, error);
    }
  }

  return result(null);
};
