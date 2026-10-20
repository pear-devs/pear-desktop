// What can be downloaded from where the user is, and how it is called.

import type { Translate } from "@pear/sdk/i18n";
import type { DownloaderState } from "../host.ts";
import { type DownloadTarget, isAlbum, isDownloadablePlaylist } from "../ytdlp.ts";
import type { Ctx, MenuOption } from "./types.ts";

export type StartDownload = (target: DownloadTarget, label: string) => void;

/** The playlist or album on the page, else the one the track plays from (radios and mixes don't count). */
function currentPlaylist(ctx: Ctx) {
  const fromPage = new URL(location.href).searchParams.get("list") ?? undefined;
  const id = isDownloadablePlaylist(fromPage) ? fromPage : ctx.player.state.track?.playlistId;
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

export function menuOptions(ctx: Ctx, state: DownloaderState, start: StartDownload): MenuOption[] {
  const { t } = ctx;
  const track = ctx.player.state.track;
  const options: MenuOption[] = [];
  if (track) {
    options.push({ label: t("plugins.downloader.menu.download-song", "Download song"), run: () => start({ videoId: track.videoId }, track.title) });
  }
  const list = currentPlaylist(ctx);
  if (list) {
    const album = isAlbum(list);
    const label = album ? t("plugins.downloader.menu.download-album", "Download album") : t("plugins.downloader.menu.download-playlist", "Download playlist");
    const title = (album && track?.album) || listNoun(list, t);
    options.push({ label, run: () => start({ videoId: track?.videoId ?? "", playlistId: list }, title) });
  }
  if (state.active) {
    const label = state.queued > 0 ? t("plugins.downloader.menu.cancel-all", "Cancel downloads") : t("plugins.downloader.menu.cancel", "Cancel download");
    options.push({ label, run: () => void ctx.host.invoke("cancel") });
  }
  return options;
}
