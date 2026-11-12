// Extra track metadata that integrations report (views, alternative title,
// tags…) but that the shared `Track` doesn't carry. Read in the page by the
// runtime; host parts get it with `ctx.player.details()`.

import type { YTPlayerApi } from "./player.ts";
import { ytmUrl } from "./util.ts";

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
  const video = response?.videoDetails;
  const videoId = video?.videoId ?? api.getVideoData().video_id;
  if (!videoId) return null;

  const microformat = response?.microformat?.microformatDataRenderer;
  const tags = Array.isArray(microformat?.tags) ? microformat.tags.filter((tag) => typeof tag === "string") : [];
  const details: SongDetails = { videoId, tags };

  const views = Number(video?.viewCount);
  if (Number.isFinite(views)) details.views = views;
  if (microformat?.uploadDate) details.uploadDate = microformat.uploadDate;
  const alternativeTitle = microformat?.linkAlternates?.find((link) => link.title)?.title;
  if (alternativeTitle) details.alternativeTitle = alternativeTitle;
  if (video?.musicVideoType) details.musicVideoType = video.musicVideoType;
  const channel = microformat?.pageOwnerDetails?.externalChannelId;
  if (channel) details.artistUrl = ytmUrl(`/channel/${channel}`);
  return details;
}
