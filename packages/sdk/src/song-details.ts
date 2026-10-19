// Extra track metadata that integrations report (views, alternative title,
// tags…) but that the shared `Track` doesn't carry. Page side only: read it in
// a `ctx.host.handle` handler and fetch it from the host with `ctx.request`.

import type { YTPlayerApi } from "./player.ts";

export interface SongDetails {
  videoId: string;
  views?: number;
  uploadDate?: string;
  /** A localized/romanized title YTM offers for some tracks. */
  alternativeTitle?: string;
  /** For many tracks the first tag is the canonical artist name. */
  tags: string[];
  artistUrl?: string;
  /** YTM's raw type, e.g. "MUSIC_VIDEO_TYPE_OMV" (finer than `Track.mediaType`). */
  musicVideoType?: string;
}

interface DetailedPlayerResponse {
  videoDetails?: { videoId?: string; viewCount?: string; musicVideoType?: string };
  microformat?: {
    microformatDataRenderer?: {
      uploadDate?: string;
      tags?: unknown;
      linkAlternates?: { title?: string }[];
      pageOwnerDetails?: { externalChannelId?: string };
    };
  };
}

export function readSongDetails(api: YTPlayerApi): SongDetails | null {
  const response = api.getPlayerResponse() as DetailedPlayerResponse | undefined;
  const videoId = response?.videoDetails?.videoId ?? api.getVideoData().video_id;
  if (!videoId) return null;
  const microformat = response?.microformat?.microformatDataRenderer;
  const details: SongDetails = {
    videoId,
    tags: Array.isArray(microformat?.tags) ? microformat.tags.filter((tag) => typeof tag === "string") : [],
  };
  const views = Number(response?.videoDetails?.viewCount);
  if (Number.isFinite(views)) details.views = views;
  if (microformat?.uploadDate) details.uploadDate = microformat.uploadDate;
  const alternativeTitle = microformat?.linkAlternates?.find((link) => link.title)?.title;
  if (alternativeTitle) details.alternativeTitle = alternativeTitle;
  const channel = microformat?.pageOwnerDetails?.externalChannelId;
  const musicVideoType = response?.videoDetails?.musicVideoType;
  if (musicVideoType) details.musicVideoType = musicVideoType;
  if (channel) details.artistUrl = `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/channel/${channel}`;
  return details;
}
