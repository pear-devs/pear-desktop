// The downloader's own store of songs (host only): each song's stream as it
// was downloaded, before converting, the player response YTM plays it with, and
// what exporting it into the download folder later needs (tags, the file name's
// fields, the cover art), in userData/offline/<videoId>/; and the albums and
// playlists they came from, in userData/offline/lists/<playlistId>.json. The
// page writes them into YTM's offline databases (page/offline.ts), so its
// Downloads page plays them without internet.

import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Cover, Tags } from "./convert.ts";
import type { TemplateFields } from "./template.ts";

const VIDEO_ID = /^[\w-]{11}$/;
const PLAYLIST_ID = /^[\w-]+$/;
const LISTS_FOLDER = "lists";
const TRACK_FILE = "track.json";
const PLAYER_FILE = "player.json";
const AUDIO_FILE = "audio";
const COVER_FILE = "cover.jpg";
/** Streams being downloaded into the store, before they are kept. */
const STAGING_FOLDER = ".staging";

/** A byte range of the stream, as the site's player response gives it. */
export interface ByteRange {
  start: string;
  end: string;
}

/** The kept stream, as YTM's player describes a format. */
export interface OfflineFormat {
  itag: number;
  mimeType: string;
  bitrate: number;
  /** The stream's version, in microseconds. */
  lastModified: string;
  contentLength: number;
  initRange: ByteRange;
  indexRange: ByteRange;
  approxDurationMs: number;
  audioSampleRate?: string;
  audioChannels?: number;
}

/** What exporting a kept song needs besides its stream: its tags and its file name's fields. */
export interface ExportInfo {
  tags: Tags;
  /** The file name's fields, but the extension, which the format at export time decides. */
  fields: Omit<TemplateFields, "ext">;
  /** Downloaded with an album or playlist, which may have a folder of its own. */
  inList: boolean;
  /** The cover art's size, when it is kept (cover.jpg). */
  cover?: { width: number; height: number };
}

/** What the page shows of a kept song. */
export interface OfflineTrack {
  videoId: string;
  title: string;
  artist?: string | undefined;
  album?: string | undefined;
  format: OfflineFormat;
  /** When it was kept, in milliseconds. */
  addedAt: number;
  export?: ExportInfo;
  /** The file it was exported to. */
  exported?: string;
}

/** A song to keep: its track and the player response, as JSON. */
export interface OfflineSong extends Omit<OfflineTrack, "addedAt" | "export"> {
  playerResponse: string;
}

/** What else a song is kept with. */
export interface KeepOptions {
  /** For exporting it later. */
  exportInfo?: Omit<ExportInfo, "cover">;
  cover?: Cover | undefined;
  /** Move the stream in (it was staged in the store) instead of copying it. */
  move?: boolean;
  /** The file it was saved to as well. */
  exported?: string;
}

/** A kept song, for exporting it: its stream's file and what else it was kept with. */
export interface KeptSong {
  track: OfflineTrack;
  audio: string;
  cover: Cover | undefined;
}

/** An album or playlist of kept songs. */
export interface OfflineList {
  playlistId: string;
  title: string;
  /** The cover art's URL. */
  cover?: string | undefined;
  /** Its kept songs, in its order. */
  videoIds: string[];
  /** When it was kept, in milliseconds. */
  addedAt: number;
}

/** Everything the page writes into YTM's databases for one song. */
export interface OfflineData {
  track: OfflineTrack;
  playerResponse: string;
  audio: Uint8Array;
}

export class OfflineStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /**
   * Keeps `song` with its downloaded `stream`: moved in, or a copy (a cheap
   * clone where the file system has them).
   */
  async save(song: OfflineSong, stream: string, options: KeepOptions = {}) {
    const folder = this.#folder(song.videoId);
    const temp = `${folder}.temp`;
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      if (options.move) await rename(stream, join(temp, AUDIO_FILE));
      else await copyFile(stream, join(temp, AUDIO_FILE), constants.COPYFILE_FICLONE);
      const { playerResponse, ...rest } = song;
      const track: OfflineTrack = { ...rest, addedAt: Date.now() };
      if (options.exported) track.exported = options.exported;
      if (options.exportInfo) {
        track.export = { ...options.exportInfo };
        if (options.cover) {
          await writeFile(join(temp, COVER_FILE), options.cover.data);
          track.export.cover = { width: options.cover.width, height: options.cover.height };
        }
      }
      await writeFile(join(temp, PLAYER_FILE), playerResponse);
      await writeFile(join(temp, TRACK_FILE), JSON.stringify(track));
      await rm(folder, { recursive: true, force: true });
      await rename(temp, folder);
    } catch (error) {
      await rm(temp, { recursive: true, force: true });
      throw error;
    }
  }

  /** The kept songs, newest first. */
  async list(): Promise<OfflineTrack[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return [];
    }
    const tracks = await Promise.all(names.filter((name) => VIDEO_ID.test(name)).map((name) => this.#track(name)));
    return tracks.filter((track) => track !== undefined).sort((a, b) => b.addedAt - a.addedAt);
  }

  async read(videoId: string): Promise<OfflineData | undefined> {
    const track = await this.#track(videoId);
    if (!track) return undefined;
    const folder = this.#folder(videoId);
    const [playerResponse, audio] = await Promise.all([readFile(join(folder, PLAYER_FILE), "utf8"), readFile(join(folder, AUDIO_FILE))]);
    return { track, playerResponse, audio };
  }

  /** Forgets a song, and takes it off the lists it was on; a list left empty goes too. */
  async remove(videoId: string) {
    await rm(this.#folder(videoId), { recursive: true, force: true });
    for (const list of await this.lists()) {
      if (!list.videoIds.includes(videoId)) continue;
      const videoIds = list.videoIds.filter((id) => id !== videoId);
      if (videoIds.length > 0) await this.#writeList({ ...list, videoIds });
      else await this.removeList(list.playlistId);
    }
  }

  async has(videoId: string) {
    return (await this.#track(videoId)) !== undefined;
  }

  /** Where a stream is downloaded to before it is kept; continued from there when a paused download resumes. */
  async stagingFile(videoId: string, itag: number) {
    this.#folder(videoId);
    await mkdir(join(this.#dir, STAGING_FOLDER), { recursive: true });
    return join(this.#dir, STAGING_FOLDER, `${videoId}.f${itag}.part`);
  }

  /** A kept song's stream file and what else it was kept with; undefined when it isn't kept. */
  async kept(videoId: string): Promise<KeptSong | undefined> {
    const track = await this.#track(videoId);
    if (!track) return undefined;
    const folder = this.#folder(videoId);
    const size = track.export?.cover;
    const cover = size ? { data: await readFile(join(folder, COVER_FILE)), ...size } : undefined;
    return { track, audio: join(folder, AUDIO_FILE), cover };
  }

  /** Remembers that a kept song was exported to `file`. */
  async exported(videoId: string, file: string) {
    const track = await this.#track(videoId);
    if (track) await writeFile(join(this.#folder(videoId), TRACK_FILE), JSON.stringify({ ...track, exported: file }));
  }

  /** Keeps an album or playlist with those of its songs that are kept; none kept, nothing to keep. */
  async saveList(list: Omit<OfflineList, "addedAt">): Promise<OfflineList | undefined> {
    const kept = await Promise.all(list.videoIds.map((videoId) => this.has(videoId)));
    const videoIds = list.videoIds.filter((_, index) => kept[index]);
    if (videoIds.length === 0) return undefined;
    const saved = { ...list, videoIds, addedAt: Date.now() };
    await this.#writeList(saved);
    return saved;
  }

  /** The kept albums and playlists, newest first. */
  async lists(): Promise<OfflineList[]> {
    let names: string[];
    try {
      names = await readdir(join(this.#dir, LISTS_FOLDER));
    } catch {
      return [];
    }
    const lists = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return JSON.parse(await readFile(join(this.#dir, LISTS_FOLDER, name), "utf8")) as OfflineList;
          } catch {
            return undefined;
          }
        }),
    );
    return lists.filter((list) => list !== undefined).sort((a, b) => b.addedAt - a.addedAt);
  }

  /**
   * Forgets an album or playlist and its songs that no other list has; resolves
   * with the songs it forgot.
   */
  async removeList(playlistId: string): Promise<string[]> {
    const lists = await this.lists();
    const list = lists.find((other) => other.playlistId === playlistId);
    await rm(this.#listFile(playlistId), { force: true });
    if (!list) return [];
    const elsewhere = new Set(lists.filter((other) => other !== list).flatMap((other) => other.videoIds));
    const songs = list.videoIds.filter((videoId) => !elsewhere.has(videoId));
    await Promise.all(songs.map((videoId) => rm(this.#folder(videoId), { recursive: true, force: true })));
    return songs;
  }

  async #writeList(list: OfflineList) {
    await mkdir(join(this.#dir, LISTS_FOLDER), { recursive: true });
    await writeFile(this.#listFile(list.playlistId), JSON.stringify(list));
  }

  #listFile(playlistId: string) {
    if (!PLAYLIST_ID.test(playlistId)) throw new Error(`not a playlist id: ${playlistId}`);
    return join(this.#dir, LISTS_FOLDER, `${playlistId}.json`);
  }

  async #track(videoId: string): Promise<OfflineTrack | undefined> {
    try {
      return JSON.parse(await readFile(join(this.#folder(videoId), TRACK_FILE), "utf8")) as OfflineTrack;
    } catch {
      return undefined;
    }
  }

  #folder(videoId: string) {
    if (!VIDEO_ID.test(videoId)) throw new Error(`not a video id: ${videoId}`);
    return join(this.#dir, videoId);
  }
}
