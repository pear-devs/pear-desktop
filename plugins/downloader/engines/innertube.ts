// The built-in engine: pear-desktop's downloader on InnerTube (host only). It
// looks songs up with the app's own signed-in session, streams them into a
// temporary file next to the result and converts that into place (convert.ts).
// Anything the site refuses it is a RecoverableError, which yt-dlp gets next.

import { existsSync } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errorMessage } from "@pear/sdk/util";
import { Innertube, Platform, type Types, UniversalCache, type YT, YTNodes, type YTMusic } from "\u0079\u006f\u0075\u0074\u0075\u0062\u0065i.js";
import { type BuiltInFormat, type Converter, type Cover, codecOf, outputFor, preferredContainer, type Tags } from "../convert.ts";
import type { Lyrics, LyricsQuery } from "../lyrics.ts";
import type { KeepOptions, OfflineList, OfflineSong, OfflineStore } from "../offline.ts";
import { Archive } from "../archive.ts";
import { playlistFolder, renderTemplate, type TemplateFields } from "../template.ts";
import { isAlbum } from "../ytdlp.ts";
import { type Engine, type EngineJob, type EngineResult, isPause, type Progress, RecoverableError, type SongUpdate } from "./types.ts";

/** The stream is fetched in parts of this size, as the site's player does; one request for all of it is refused. */
const CHUNK_BYTES = 10 * 1024 * 1024;
/** The share of a song's progress its download takes; converting is the rest. */
const DOWNLOAD_SHARE = 0.7;
const HTTP_FORBIDDEN = 403;
/** Songs of a playlist downloaded at the same time. */
const PLAYLIST_CONCURRENCY = 2;
/** The site's player responses remembered for offline playback, the latest songs'. */
const PLAYER_RESPONSES_KEPT = 50;

export interface BuiltInJobOptions {
  folder: string;
  format: BuiltInFormat;
  template: string;
  playlistFolders: boolean;
  /** 0 = whole playlist. */
  playlistLimit: number;
  skipExisting: boolean;
  /** Also skip songs the folder's archive lists, and add the downloaded ones to it. */
  archive: boolean;
  squareCover: boolean;
  /** Measure loudness and write ReplayGain tags. */
  replayGain: boolean;
  /** Lyrics in the tags, and synced ones in an .lrc file next to the song. */
  lyrics: boolean;
  lyricsFile: boolean;
  /** Keep each song's stream as downloaded for YTM's offline playback (`keep`). */
  offline: boolean;
  /** Save songs to `folder`; otherwise they are kept in the store until exported (`export`). */
  exportFiles: boolean;
}

// ---------------------------------------------------------------- session

/** What the page answers for a PO token (potoken.ts). */
export interface PoTokenAnswer {
  poToken: string;
  /** The page's visitor, which the token is minted for when signed out. */
  visitorData: string | undefined;
}

export interface SessionOptions {
  /** The window's session's fetch. */
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  /** The signed-in session's cookies, when downloads use the account. */
  cookie(): Promise<string | undefined>;
  /** A PO token from the page, which runs BotGuard in a real DOM; for a song when the site binds them to songs. */
  poToken(request: { signedIn: boolean; refresh: boolean; videoId?: string }): Promise<PoTokenAnswer>;
  log: { warn(...args: unknown[]): void };
}

/**
 * The InnerTube library (13 and later) leaves deciphering stream URLs to the app: run the
 * player's script it extracted, as pear-desktop did.
 */
function evaluate(data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) {
  const properties: string[] = [];
  if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function(`${data.output}\nreturn { ${properties.join(", ")} }`)() as Record<string, Types.VMPrimative>;
}

/** One InnerTube client for the plugin's lifetime, created again when the account changes. */
export class InnertubeSession {
  #options: SessionOptions;
  #current: Promise<{ yt: Innertube; cookie: string | undefined }> | undefined;
  /** Playable player responses by video id, as the site sent them (JSON). */
  readonly #playerResponses = new Map<string, string>();

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  async get(): Promise<Innertube> {
    const cookie = await this.#options.cookie();
    const current = await this.#current?.catch(() => undefined);
    if (current && current.cookie === cookie) return current.yt;
    const created = this.#create(cookie);
    this.#current = created;
    created.catch(() => {
      if (this.#current === created) this.#current = undefined;
    });
    return (await created).yt;
  }

  /**
   * The site's player response for a song this session looked up, as it sent
   * it (JSON); undefined when it wasn't playable. YTM's offline player plays the
   * song with it; asking again without the song's PO token isn't answered.
   */
  playerResponse(videoId: string) {
    return this.#playerResponses.get(videoId);
  }

  /** Remembers a playable player response the library got. */
  async #remember(response: Response) {
    try {
      const json = await response.text();
      const parsed = JSON.parse(json) as { videoDetails?: { videoId?: string }; playabilityStatus?: { status?: string } };
      const videoId = parsed.videoDetails?.videoId;
      if (!videoId || parsed.playabilityStatus?.status !== "OK" || this.#playerResponses.has(videoId)) return;
      this.#playerResponses.set(videoId, json);
      if (this.#playerResponses.size > PLAYER_RESPONSES_KEPT) this.#playerResponses.delete(this.#playerResponses.keys().next().value!);
    } catch {}
  }

  /** A PO token for a song's streams; `refresh` after a stream refused the last one. Undefined when the page has none. */
  async poToken(yt: Innertube, videoId: string, refresh = false): Promise<string | undefined> {
    try {
      const answer = await this.#options.poToken({ signedIn: yt.session.logged_in, refresh, videoId });
      return answer.poToken;
    } catch (error) {
      this.#options.log.warn("no PO token from the page:", errorMessage(error));
      return undefined;
    }
  }

  async #create(cookie: string | undefined) {
    Platform.shim.eval = evaluate;
    const { fetch } = this.#options;
    const yt = await Innertube.create({
      // The cookies go in as the library's header (it signs requests with them), not again from the session's jar.
      fetch: async (input, init) => {
        const response = await fetch(input as string | Request, { ...init, credentials: "omit" });
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url).pathname.endsWith("/player")) void this.#remember(response.clone());
        return response;
      },
      generate_session_locally: true,
      cache: new UniversalCache(false),
      ...(cookie ? { cookie } : {}),
    });
    // Signed out, tokens are bound to the page's visitor; requests must come from the same one.
    const visitorData = await this.#options
      .poToken({ signedIn: yt.session.logged_in, refresh: false })
      .then((answer) => answer.visitorData)
      .catch(() => undefined);
    if (visitorData && !yt.session.logged_in) yt.session.context.client.visitorData = visitorData;
    return { yt, cookie };
  }
}

// ---------------------------------------------------------------- engine

export interface InnertubeEngineOptions {
  session: InnertubeSession;
  /** Called per job, so config changes apply to the next download. */
  jobOptions(jobId: number): BuiltInJobOptions;
  converter(): Converter;
  /** The cover art as a JPEG, square-cropped if asked; undefined when it can't be had. */
  cover(url: string, square: boolean, signal: AbortSignal): Promise<Cover | undefined>;
  /** The window's session's fetch, for the stream. */
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>;
  lyrics(query: LyricsQuery, signal: AbortSignal): Promise<Lyrics | undefined>;
  /** Keeps a song's downloaded stream (before it is converted) in the store, for YTM's offline playback and exporting. */
  keep?(song: OfflineSong, stream: string, options: KeepOptions): Promise<void>;
  /** The store's songs, which `keep` adds to. */
  store?: Pick<OfflineStore, "has" | "stagingFile" | "kept" | "exported">;
  /** Keeps an album or playlist (after its songs), for YTM's offline Downloads page. */
  keepList?(list: Omit<OfflineList, "addedAt">): Promise<void>;
  log: { warn(...args: unknown[]): void };
}

/** A song of a list: where it is and what the list says about it. */
interface Entry {
  videoId: string;
  title: string;
  /** 1-based position in the list. */
  index: number;
}

/** What a list gives its songs: its own folder and name, and for albums the album's tags. */
interface ListInfo {
  id: string;
  title: string;
  count: number;
  /** The cover art's URL: the album's, or the playlist's. */
  cover?: string | undefined;
  album?: AlbumInfo | undefined;
}

interface AlbumInfo {
  title: string | undefined;
  artist: string | undefined;
  year: number | undefined;
  cover: string | undefined;
}

/** Progress of one song: looked up, downloading (in bytes), converting, then saved or skipped. */
interface SongProgress {
  started(): void;
  download(bytes: number, total: number): void;
  convert(fraction: number): void;
  saved(file: string): void;
  /** Kept in the store, not saved to the folder. */
  kept(): void;
  /** Downloaded before. */
  skipped(): void;
  /** Its partial download stays for later. */
  keep(file: string): void;
}

export class InnertubeEngine implements Engine {
  readonly name = "built-in";
  #options: InnertubeEngineOptions;

  constructor(options: InnertubeEngineOptions) {
    this.#options = options;
  }

  async download(job: EngineJob, progress: Progress, signal: AbortSignal): Promise<EngineResult> {
    const options = this.#options.jobOptions(job.id);
    const yt = await recoverable(() => this.#options.session.get(), signal);
    const { playlistId } = job.target;
    if (playlistId) return this.#playlist(yt, playlistId, job.target.items, options, progress, signal);
    const entry = { videoId: job.target.videoId, title: job.label, index: 1 };
    const { file, kept } = await this.#song(yt, entry, undefined, options, songProgress(progress, entry, 0, 1), signal);
    return { files: file ? [file] : [], kept: kept ? [kept] : [] };
  }

  async #playlist(
    yt: Innertube,
    playlistId: string,
    only: number[] | undefined,
    options: BuiltInJobOptions,
    progress: Progress,
    signal: AbortSignal,
  ): Promise<EngineResult> {
    const { list, entries } = await recoverable(() => this.#list(yt, playlistId, options.playlistLimit), signal);
    const wanted = only ? entries.filter((entry) => only.includes(entry.index)) : entries;
    progress.songs(entries.map(({ index, videoId, title }) => ({ index, videoId, title })));
    const saved: SongOutcome[] = [];
    const retry: number[] = [];
    const errors: string[] = [];
    const songs = listProgress(progress, wanted);
    let next = 0;
    // A few songs at a time: most of a song's time is waiting for the site, not the disk.
    const worker = async () => {
      while (next < wanted.length) {
        signal.throwIfAborted();
        const position = next++;
        const entry = wanted[position]!;
        progress.item(position + 1, wanted.length, entry.title);
        try {
          saved[position] = await this.#song(yt, entry, list, options, songs.song(position), signal);
        } catch (error) {
          if (signal.aborted) throw error;
          this.#options.log.warn(`${entry.title} (${entry.videoId}):`, errorMessage(error));
          progress.song({ index: entry.index, status: "failed", error: errorMessage(error) });
          if (error instanceof RecoverableError) retry.push(entry.index);
          else errors.push(errorMessage(error));
        }
        songs.done(position);
      }
    };
    // All of them, even when one stops (cancelled, paused): the others clean up their files first.
    const workers = await Promise.allSettled(Array.from({ length: Math.min(PLAYLIST_CONCURRENCY, wanted.length) }, worker));
    const stopped = workers.find((settled) => settled.status === "rejected");
    if (stopped) throw stopped.reason;
    if (options.offline || !options.exportFiles) await this.#keepList(list, entries);
    const files = saved.flatMap((outcome) => (outcome?.file ? [outcome.file] : []));
    const kept = saved.flatMap((outcome) => (outcome?.kept ? [outcome.kept] : []));
    retry.sort((a, b) => a - b);
    if (retry.length > 0) throw new RecoverableError(`${retry.length} of ${wanted.length} songs failed`, { files, kept, items: retry });
    if (wanted.length === 0) return { files, kept, error: "the playlist is empty" };
    return errors.length > 0 ? { files, kept, error: errors.at(-1)! } : { files, kept };
  }

  /** The list's songs, following continuations up to the limit; for albums also the album's tags. */
  async #list(yt: Innertube, playlistId: string, limit: number): Promise<{ list: ListInfo; entries: Entry[] }> {
    let playlist = await yt.music.getPlaylist(playlistId);
    const songs: YTNodes.MusicResponsiveListItem[] = [];
    const full = () => limit > 0 && songs.length >= limit;
    for (;;) {
      songs.push(...playlist.items.filter((item) => item.is(YTNodes.MusicResponsiveListItem) && !!item.id).map((item) => item.as(YTNodes.MusicResponsiveListItem)));
      if (full() || !playlist.has_continuation) break;
      playlist = await playlist.getContinuation();
    }
    const kept = limit > 0 ? songs.slice(0, limit) : songs;
    const entries = kept.map((song, index) => ({ videoId: song.id!, title: song.title ?? song.id!, index: index + 1 }));
    const album = isAlbum(playlistId) ? await this.#album(yt, kept[0]) : undefined;
    const header = playlist.header;
    const headerTitle = header && "title" in header ? header.title?.text : undefined;
    const title = headerTitle || album?.title || playlistId;
    // Playlist headers are drawn like albums'.
    const cover = album?.cover ?? largest(headerThumbnails(header as YTMusic.Album["header"]));
    return { list: { id: playlistId, title, count: entries.length, album, cover }, entries };
  }

  /** An album's own page has its artist, year and square cover; its songs only link to it. */
  async #album(yt: Innertube, first: YTNodes.MusicResponsiveListItem | undefined): Promise<AlbumInfo | undefined> {
    const browseId = first?.album?.id;
    if (!browseId) return undefined;
    try {
      const album = await yt.music.getAlbum(browseId);
      const header = album.header;
      const subtitle = header?.subtitle?.text ?? "";
      const artist = header && "strapline_text_one" in header ? header.strapline_text_one?.text : undefined;
      return {
        title: header?.title?.text ?? first.album?.name,
        artist: artist || undefined,
        year: yearOf(subtitle),
        cover: largest(headerThumbnails(header)),
      };
    } catch (error) {
      this.#options.log.warn(`album ${browseId}:`, errorMessage(error));
      return { title: first.album?.name, artist: undefined, year: undefined, cover: undefined };
    }
  }

  /**
   * Downloads one song: into the store, where it stays until exported, or
   * converted into the folder. Resolves with its file or its video id (kept),
   * or neither when the archive says it was downloaded.
   */
  async #song(
    yt: Innertube,
    entry: Entry,
    list: ListInfo | undefined,
    options: BuiltInJobOptions,
    progress: SongProgress,
    signal: AbortSignal,
  ): Promise<SongOutcome> {
    const store = this.#options.store;
    const exporting = options.exportFiles || !store;
    const archive = exporting && options.skipExisting && options.archive ? new Archive(options.folder) : undefined;
    if (await archive?.has(entry.videoId)) {
      progress.skipped();
      return {};
    }
    if (!exporting && options.skipExisting && (await store.has(entry.videoId))) {
      progress.skipped();
      return { kept: entry.videoId };
    }
    progress.started();
    const session = this.#options.session;
    let poToken = await session.poToken(yt, entry.videoId);
    const { info, tags } = await recoverable(() => this.#lookup(yt, entry.videoId, poToken), signal);
    if (list?.album) Object.assign(tags, albumTags(list.album, entry.index, list.count));
    const format = await recoverable(async () => chooseAudio(info, options.format), signal);
    const { ext, codecArgs } = outputFor(options.format, { codec: codecOf(format.mime_type) });

    const fields = templateFields(entry, tags, ext, list, info.basic_info.duration);
    const relative = renderTemplate(options.template, fields);
    const folder = list && options.playlistFolders ? join(options.folder, playlistFolder(fields)) : options.folder;
    const file = join(folder, relative);
    if (exporting && options.skipExisting && existsSync(file)) {
      await archive?.add(entry.videoId);
      progress.skipped();
      return { file };
    }

    // Kept, the stream is downloaded into the store; named by the stream, so a paused download only continues from the same one.
    const keepOnly = !exporting && keepable(format);
    const partial = keepOnly ? await store.stagingFile(entry.videoId, format.itag) : `${file}.f${format.itag}.part`;
    if (!keepOnly) await mkdir(dirname(file), { recursive: true });
    const converted = join(dirname(file), `${relative.split("/").at(-1)!.replace(/\.[^.]+$/, "")}.temp.${ext}`);
    const { ext: _ext, ...exportFields } = fields;
    const exportInfo = { tags, fields: exportFields, inList: list !== undefined };
    try {
      const refresh = async () => (poToken = await session.poToken(yt, entry.videoId, true));
      await this.#stream({ yt, format, poToken: () => poToken, refresh }, partial, progress, signal);
      const cover = await this.#cover(list?.album?.cover ?? thumbnailOf(info), options.squareCover, signal);
      if (keepOnly && (await this.#keep(entry.videoId, format, tags, partial, { move: true, cover, exportInfo }))) {
        progress.kept();
        return { kept: entry.videoId };
      }
      // Saved to the folder (also when the store can't keep it).
      await mkdir(dirname(file), { recursive: true });
      const lyrics = options.lyrics || options.lyricsFile ? await this.#lyrics(tags, info.basic_info.duration ?? 0, signal) : undefined;
      if (options.lyrics && lyrics) tags.lyrics = lyrics.plain;
      await this.#options.converter().convert({
        input: partial,
        output: converted,
        ext,
        codecArgs,
        tags,
        cover,
        replayGain: options.replayGain,
        duration: info.basic_info.duration ?? 0,
        signal,
        onProgress: (fraction) => progress.convert(fraction),
      });
      await rename(converted, file);
      // Once saved: a song paused or cancelled while converting isn't kept.
      if (options.offline) await this.#keep(entry.videoId, format, tags, partial, { cover, exportInfo, exported: file });
      if (options.lyricsFile && lyrics?.synced) await writeFile(file.replace(/\.[^./\\]+$/, ".lrc"), lyrics.synced);
      await archive?.add(entry.videoId);
      progress.saved(file);
      return { file };
    } finally {
      // A paused song continues its download later.
      if (isPause(signal) && existsSync(partial)) progress.keep(partial);
      else await rm(partial, { force: true });
      await rm(converted, { force: true });
    }
  }

  /**
   * Saves a kept song into the folder, converted as `options` say now (format,
   * file name, tags, lyrics); resolves with its file.
   */
  async export(videoId: string, options: BuiltInJobOptions, signal: AbortSignal): Promise<string> {
    const kept = await this.#options.store?.kept(videoId);
    const info = kept?.track.export;
    if (!kept || !info) throw new Error(`${videoId} isn't in the downloads, or was kept before it could be exported`);
    const { ext, codecArgs } = outputFor(options.format, { codec: codecOf(kept.track.format.mimeType) });
    const fields: TemplateFields = { ...info.fields, ext };
    const relative = renderTemplate(options.template, fields);
    const folder = info.inList && options.playlistFolders ? join(options.folder, playlistFolder(fields)) : options.folder;
    const file = join(folder, relative);
    const archive = options.archive ? new Archive(options.folder) : undefined;
    if (!existsSync(file)) {
      await mkdir(dirname(file), { recursive: true });
      const converted = join(dirname(file), `${relative.split("/").at(-1)!.replace(/\.[^.]+$/, "")}.temp.${ext}`);
      const tags = { ...info.tags };
      const duration = fields.duration ?? 0;
      const lyrics = options.lyrics || options.lyricsFile ? await this.#lyrics(tags, duration, signal) : undefined;
      if (options.lyrics && lyrics) tags.lyrics = lyrics.plain;
      try {
        const input = { input: kept.audio, output: converted, ext, codecArgs, tags, cover: kept.cover, replayGain: options.replayGain, duration, signal };
        await this.#options.converter().convert({ ...input, onProgress: () => {} });
        await rename(converted, file);
      } finally {
        await rm(converted, { force: true });
      }
      if (options.lyricsFile && lyrics?.synced) await writeFile(file.replace(/\.[^./\\]+$/, ".lrc"), lyrics.synced);
    }
    await archive?.add(videoId);
    await this.#options.store?.exported(videoId, file);
    return file;
  }

  /** The song's streams and tags; songs that need signing in are tried with the TV client, as pear-desktop did. */
  async #lookup(yt: Innertube, videoId: string, poToken: string | undefined): Promise<{ info: YTMusic.TrackInfo | YT.VideoInfo; tags: Tags }> {
    const track = await yt.music.getInfo(videoId, poToken ? { po_token: poToken } : {});
    const tags = trackTags(track);
    let info: YTMusic.TrackInfo | YT.VideoInfo = track;
    if (info.playability_status?.status === "LOGIN_REQUIRED") {
      // The TV client's player answers for age-restricted songs; only its streams are needed.
      const tv = await yt.getBasicInfo(videoId, { client: "TV_EMBEDDED" });
      if (tv.playability_status?.status !== "LOGIN_REQUIRED") info = tv;
    }
    const status = info.playability_status;
    if (status && status.status !== "OK") throw new RecoverableError(`[${status.status}] ${status.reason ?? ""}`.trim());
    return { info, tags };
  }

  async #stream(stream: StreamSource, path: string, progress: SongProgress, signal: AbortSignal) {
    await downloadStream({
      url: () => recoverable(() => streamUrl(stream), signal),
      refresh: () => stream.refresh(),
      total: stream.format.content_length ?? 0,
      path,
      fetch: this.#options.fetch,
      onBytes: (received, total) => progress.download(received, total),
      signal,
    });
  }

  /** Keeps the stream in the store; whether it did (a song it can't keep is saved to the folder instead). */
  async #keep(videoId: string, format: FormatLike, tags: Tags, stream: string, options: KeepOptions) {
    const keep = this.#options.keep;
    if (!keep) return false;
    try {
      const song = offlineSong(this.#options.session.playerResponse(videoId), videoId, format, tags);
      if (song) {
        await keep(song, stream, options);
        return true;
      }
      this.#options.log.warn(`${tags.title} (${videoId}) not kept in the downloads: no audio-only stream, or no playable player response`);
    } catch (error) {
      this.#options.log.warn(`${tags.title} (${videoId}) not kept in the downloads:`, errorMessage(error));
    }
    return false;
  }

  /** Keeps the list with those of its songs that were kept; a list that can't be kept doesn't fail the download. */
  async #keepList(list: ListInfo, entries: readonly Entry[]) {
    const keepList = this.#options.keepList;
    if (!keepList) return;
    try {
      await keepList({ playlistId: list.id, title: list.title, cover: list.cover, videoIds: entries.map((entry) => entry.videoId) });
    } catch (error) {
      this.#options.log.warn(`${list.title} not kept for offline playback:`, errorMessage(error));
    }
  }

  async #lyrics(tags: Tags, durationSeconds: number, signal: AbortSignal) {
    if (!tags.artist) return undefined;
    try {
      return await this.#options.lyrics({ title: tags.title, artist: tags.artist, album: tags.album, durationSeconds }, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.#options.log.warn("no lyrics:", errorMessage(error));
      return undefined;
    }
  }

  async #cover(url: string | undefined, square: boolean, signal: AbortSignal) {
    if (!url) return undefined;
    try {
      return await this.#options.cover(url, square, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.#options.log.warn("no cover art:", errorMessage(error));
      return undefined;
    }
  }
}

// ---------------------------------------------------------------- helpers

type FormatLike = ReturnType<YTMusic.TrackInfo["chooseFormat"]>;

/** A song's outcome: saved to the folder (`file`), or kept in the store (`kept`, its video id). */
interface SongOutcome {
  file?: string;
  kept?: string;
}

/** Streams YTM's offline player plays from its store: audio only, with their byte ranges. */
const keepable = (format: FormatLike) => format.mime_type.startsWith("audio/") && !!format.init_range && !!format.index_range && !!format.content_length;

/** A song's stream and the PO token its URL carries. */
interface StreamSource {
  yt: Innertube;
  format: FormatLike;
  poToken(): string | undefined;
  refresh(): Promise<unknown>;
}

/**
 * The song as YTM's offline player plays it: the stream's format and the site's
 * own player response for it (the one the download got). Undefined without a
 * playable response, and for streams it can't play from its offline store
 * (audio with video, no byte ranges).
 */
function offlineSong(playerResponse: string | undefined, videoId: string, format: FormatLike, tags: Tags): OfflineSong | undefined {
  const { init_range: initRange, index_range: indexRange, content_length: contentLength } = format;
  if (!playerResponse || !keepable(format) || !initRange || !indexRange || !contentLength) return undefined;
  const range = ({ start, end }: { start: number; end: number }) => ({ start: String(start), end: String(end) });
  return {
    videoId,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    format: {
      itag: format.itag,
      mimeType: format.mime_type,
      bitrate: format.bitrate,
      lastModified: format.last_modified_ms,
      contentLength,
      initRange: range(initRange),
      indexRange: range(indexRange),
      approxDurationMs: format.approx_duration_ms,
      ...(format.audio_sample_rate ? { audioSampleRate: String(format.audio_sample_rate) } : {}),
      ...(format.audio_channels ? { audioChannels: format.audio_channels } : {}),
    },
    playerResponse,
  };
}

/** The format's URL, deciphered, with the song's PO token (the library would add the session's). */
async function streamUrl({ yt, format, poToken }: StreamSource) {
  const url = new URL(await format.decipher(yt.session.player));
  const token = poToken();
  if (token && url.searchParams.get("sabr") !== "1") url.searchParams.set("pot", token);
  return url.href;
}

export interface StreamDownload {
  /** The stream's URL; asked again after `refresh`. */
  url(): Promise<string>;
  /** Gets a new PO token, after the stream refused the last one. */
  refresh(): Promise<unknown>;
  /** The stream's size in bytes; 0 when unknown. */
  total: number;
  path: string;
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>;
  onBytes(received: number, total: number): void;
  signal: AbortSignal;
}

/**
 * Streams into `path` part by part, as the site's player does (with its `range`
 * parameter), continuing a part a paused download left; a refused stream gets
 * a new PO token once.
 */
export async function downloadStream({ url: urlOf, refresh, total, path, fetch, onBytes, signal }: StreamDownload) {
  const left = await partSize(path);
  const resumes = left > 0 && (!total || left <= total);
  const file = await open(path, resumes ? "a" : "w");
  let received = resumes ? left : 0;
  let refreshed = false;
  onBytes(received, total);
  try {
    if (total && received >= total) return;
    let url = await urlOf();
    for (;;) {
      const end = received + CHUNK_BYTES - 1;
      const response = await fetch(`${url}&range=${received}-${total ? Math.min(end, total - 1) : end}`, { signal });
      if (response.status === HTTP_FORBIDDEN && !refreshed) {
        refreshed = true;
        await refresh();
        url = await urlOf();
        continue;
      }
      if (!response.ok || !response.body) throw new RecoverableError(`the stream answered HTTP ${response.status}`);
      const before = received;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        await file.write(chunk);
        received += chunk.byteLength;
        onBytes(received, total);
      }
      const done = total ? received >= total : received - before < CHUNK_BYTES;
      if (done) break;
      if (received === before) throw new RecoverableError("the stream ended early");
    }
  } finally {
    await file.close();
  }
}

/**
 * Runs a step that talks to the site; its failures are the site's (changed or
 * refusing), which yt-dlp may get past. Cancelling stays a cancellation.
 */
async function recoverable<T>(step: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (signal.aborted || error instanceof RecoverableError) throw error;
    throw new RecoverableError(errorMessage(error), { cause: error });
  }
}

/** The best audio-only stream, in the codec the format keeps if there is one; else audio with video, as pear-desktop fell back to. */
function chooseAudio(info: YTMusic.TrackInfo | YT.VideoInfo, format: BuiltInFormat): FormatLike {
  const attempts: Types.FormatOptions[] = [
    { type: "audio", quality: "best", format: preferredContainer(format) },
    { type: "audio", quality: "best", format: "any" },
    { type: "video+audio", quality: "best", format: "any" },
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return info.chooseFormat(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Song channels are named "<artist> - Topic". */
const cleanArtist = (name: string | undefined) => name?.replace(/ - Topic$/, "");

function trackTags(info: YTMusic.TrackInfo): Tags {
  const album = info.player_overlays?.browser_media_session?.as(YTNodes.BrowserMediaSession).album?.text;
  return {
    title: info.basic_info.title ?? info.basic_info.id ?? "",
    artist: cleanArtist(info.basic_info.author),
    album: album && album !== "N/A" ? album : undefined,
  };
}

function albumTags(album: AlbumInfo, track: number, count: number): Partial<Tags> {
  const tags: Partial<Tags> = { track, trackCount: count };
  if (album.title) tags.album = album.title;
  if (album.artist) tags.albumArtist = album.artist;
  if (album.year) tags.year = album.year;
  return tags;
}

function templateFields(entry: Entry, tags: Tags, ext: string, list: ListInfo | undefined, duration: number | undefined): TemplateFields {
  return {
    id: entry.videoId,
    title: tags.title,
    ext,
    artist: tags.artist,
    album: tags.album,
    album_artist: tags.albumArtist,
    release_year: tags.year,
    track_number: tags.track,
    playlist_index: list && entry.index,
    playlist_title: list?.title,
    playlist_id: list?.id,
    n_entries: list?.count,
    duration,
  };
}

const yearOf = (text: string) => {
  const year = /\b(1[89]\d\d|2\d\d\d)\b/.exec(text)?.[1];
  return year ? Number(year) : undefined;
};

/** Album art on the site's image server can be asked for in any size. */
const ART_SIZE = /=w\d+-h\d+/;
const LARGE_ART = "=w1200-h1200";

function largest(thumbnails: readonly { url: string; width?: number }[]) {
  const usable = thumbnails.filter((thumbnail) => !thumbnail.url.endsWith(".webp"));
  const best = [...(usable.length ? usable : thumbnails)].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return best && best.url.replace(ART_SIZE, LARGE_ART);
}

function headerThumbnails(header: YTMusic.Album["header"]) {
  if (!header) return [];
  return "thumbnails" in header ? header.thumbnails : (header.thumbnail?.contents ?? []);
}

const thumbnailOf = (info: YTMusic.TrackInfo | YT.VideoInfo) => largest(info.basic_info.thumbnail ?? []);

/** A song's own progress, which the queue shows per song. */
function songUpdates(progress: Progress, entry: Entry) {
  const update = (fields: Omit<SongUpdate, "index">) => progress.song({ index: entry.index, ...fields });
  return {
    started: () => update({ status: "active", videoId: entry.videoId, title: entry.title }),
    bytes: (bytes: number, total: number) => update(total ? { bytes, total } : { bytes }),
    saved: (file: string) => update({ status: "done", file }),
    kept: () => update({ status: "done" }),
    skipped: () => update({ status: "skipped" }),
    keep: (file: string) => progress.partial(file),
  };
}

/** How a song's progress counts towards its job's. */
function songProgress(progress: Progress, entry: Entry, position: number, count: number): SongProgress {
  const overall = (fraction: number) => (position + fraction) / Math.max(1, count);
  const song = songUpdates(progress, entry);
  return {
    ...song,
    download: (bytes, total) => {
      song.bytes(bytes, total);
      if (total) progress.download(overall((bytes / total) * DOWNLOAD_SHARE));
    },
    convert: (fraction) => progress.converting(overall(DOWNLOAD_SHARE + fraction * (1 - DOWNLOAD_SHARE))),
  };
}

/** A playlist's progress: the sum of its songs', which download side by side. */
function listProgress(progress: Progress, wanted: readonly Entry[]) {
  const songs = new Array<number>(wanted.length).fill(0);
  const overall = () => songs.reduce((sum, fraction) => sum + fraction, 0) / Math.max(1, wanted.length);
  return {
    song: (position: number): SongProgress => {
      const song = songUpdates(progress, wanted[position]!);
      return {
        ...song,
        download: (bytes, total) => {
          song.bytes(bytes, total);
          if (!total) return;
          songs[position] = (bytes / total) * DOWNLOAD_SHARE;
          progress.download(overall());
        },
        convert: (fraction) => {
          songs[position] = DOWNLOAD_SHARE + fraction * (1 - DOWNLOAD_SHARE);
          progress.converting(overall());
        },
      };
    },
    done: (position: number) => {
      songs[position] = 1;
    },
  };
}

/** The size of a partial download a paused job left, or 0. */
async function partSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
