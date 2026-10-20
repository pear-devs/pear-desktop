// Turns plays into Last.fm and ListenBrainz submissions.

import type { Track } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { credentials, netFetch, type Warn } from "./common.ts";
import type { Ctx } from "./schema.ts";
import { LASTFM_REAUTH_CODES, LastFmError, lastFm, type Listen, listenBrainzSubmit } from "./services.ts";
import type { Play } from "./tracker.ts";

/** Submissions wait for the details, so give the page less time than the default. */
const DETAILS_TIMEOUT_MS = 3000;
const SONG_TYPES = new Set(["MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OMV"]);

export function submitter(ctx: Ctx, warn: Warn) {
  // Details (alternative title, tags, exact video type) come from the page; the current track's are kept.
  const details = new Map<string, Promise<SongDetails | undefined>>();
  const detailsFor = (videoId: string) => {
    let pending = details.get(videoId);
    if (!pending) {
      pending = ctx.player
        .details({ timeout: DETAILS_TIMEOUT_MS })
        .then((result) => (result?.videoId === videoId ? result : undefined));
      details.clear();
      details.set(videoId, pending);
    }
    return pending;
  };

  const toListen = async (track: Track, startedAt: number): Promise<Listen | null> => {
    const extra = await detailsFor(track.videoId);
    if (!ctx.config.scrobbleOtherMedia && !isSong(track, extra)) return null;
    return {
      title: (ctx.config.alternativeTitles && extra?.alternativeTitle) || track.title,
      artist: (ctx.config.alternativeArtist && extra?.tags[0]) || track.artist,
      ...(track.album ? { album: track.album } : {}),
      durationSeconds: track.durationSeconds,
      url: track.url,
      startedAt,
    };
  };

  const toLastFm = (kind: "nowPlaying" | "scrobble", listen: Listen, sessionKey: string) => {
    const call = kind === "nowPlaying" ? lastFm.updateNowPlaying : lastFm.scrobble;
    call(netFetch, credentials(ctx), sessionKey, listen).catch((error: unknown) => {
      if (error instanceof LastFmError && LASTFM_REAUTH_CODES.has(error.code)) {
        ctx.log.warn("Last.fm session is no longer valid; authorize again");
        ctx.setConfig({ lastfmSessionKey: "" });
      } else warn("Last.fm", error);
    });
  };

  const submit = async (kind: "nowPlaying" | "scrobble", play: Play) => {
    const listen = await toListen(play.track, play.startedAt);
    if (!listen) return;
    const { lastfmEnabled, lastfmSessionKey, listenbrainzEnabled, listenbrainzToken, listenbrainzApiRoot } = ctx.config;
    if (lastfmEnabled && lastfmSessionKey) toLastFm(kind, listen, lastfmSessionKey);
    if (listenbrainzEnabled && listenbrainzToken) {
      const type = kind === "nowPlaying" ? "playing_now" : "single";
      listenBrainzSubmit(netFetch, listenbrainzApiRoot, listenbrainzToken, type, listen).catch((error: unknown) =>
        warn("ListenBrainz", error),
      );
    }
  };

  return { submit, prefetchDetails: (videoId: string) => void detailsFor(videoId) };
}

/** Songs and official music videos; without YTM's exact type, audio-only tracks. */
function isSong(track: Track, details: SongDetails | undefined) {
  const type = details?.musicVideoType;
  return type ? SONG_TYPES.has(type) : track.mediaType === "audio";
}
