// What a download is called, and the album or playlist the page shows.

import type { Translate } from "@pear/sdk/i18n";
import { type DownloadTarget, isAlbum, isDownloadablePlaylist } from "../ytdlp.ts";
import type { Ctx } from "./types.ts";

export type StartDownload = (target: DownloadTarget, label: string) => void;

/** The album or playlist the page shows (radios and mixes don't count). */
export function pagePlaylist() {
  const id = new URL(location.href).searchParams.get("list") ?? undefined;
  return isDownloadablePlaylist(id) ? id : undefined;
}

/** "album" or "playlist", the label of a download of a whole list. */
export function listNoun(playlistId: string, t: Translate) {
  return isAlbum(playlistId) ? t("plugins.downloader.labels.album", "album") : t("plugins.downloader.labels.playlist", "playlist");
}

/** A download's label: the list's kind, or the track's title when it is the one playing. */
export function targetLabel(ctx: Ctx, target: DownloadTarget) {
  if (target.playlistId) return listNoun(target.playlistId, ctx.t);
  const track = ctx.player.state.track;
  return target.videoId === track?.videoId ? track.title : target.videoId;
}
