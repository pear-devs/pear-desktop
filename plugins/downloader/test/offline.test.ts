import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type OfflineFormat, type OfflineSong, OfflineStore } from "../offline.ts";
import {
  AUDIO_ONLY,
  CHUNK_BYTES,
  chunkKey,
  entityKey,
  indexEntry,
  libraryKey,
  listEntities,
  policyRecord,
  songEntities,
  songKey,
} from "../page/offline-records.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pear-dl-offline-"));
  dirs.push(dir);
  return dir;
};

const FORMAT: OfflineFormat = {
  itag: 251,
  mimeType: 'audio/webm; codecs="opus"',
  bitrate: 140103,
  lastModified: "1790952183216241",
  contentLength: 6,
  initRange: { start: "0", end: "258" },
  indexRange: { start: "259", end: "629" },
  approxDurationMs: 214081,
  audioSampleRate: "48000",
  audioChannels: 2,
};
const PLAYER_RESPONSE = JSON.stringify({
  playabilityStatus: { status: "OK" },
  videoDetails: { title: "Song", author: "Artist", lengthSeconds: "214", musicVideoType: "MUSIC_VIDEO_TYPE_ATV", thumbnail: { thumbnails: [{ url: "https://example.com/a.jpg", width: 60, height: 60 }] } },
});
const song = (videoId = "n1oPCIdabo4"): OfflineSong => ({ videoId, title: "Song", artist: "Artist", album: "Album", format: FORMAT, playerResponse: PLAYER_RESPONSE });

describe("offline store", () => {
  test("keeps a song's stream and player response, and forgets it", async () => {
    const dir = tempDir();
    const stream = join(dir, "song.part");
    writeFileSync(stream, "opus!!");
    const store = new OfflineStore(join(dir, "offline"));
    expect(await store.list()).toEqual([]);

    await store.save(song(), stream);
    const [track] = await store.list();
    expect(track).toMatchObject({ videoId: "n1oPCIdabo4", title: "Song", album: "Album", format: FORMAT });
    const data = await store.read("n1oPCIdabo4");
    expect(Buffer.from(data!.audio).toString()).toBe("opus!!");
    expect(data!.playerResponse).toBe(PLAYER_RESPONSE);

    await store.remove("n1oPCIdabo4");
    expect(await store.list()).toEqual([]);
    expect(await store.read("n1oPCIdabo4")).toBeUndefined();
  });

  test("keeps albums with their kept songs, and forgets songs no other list has", async () => {
    const dir = tempDir();
    const stream = join(dir, "song.part");
    writeFileSync(stream, "opus!!");
    const store = new OfflineStore(join(dir, "offline"));
    await store.save(song("aaaaaaaaaaa"), stream);
    await store.save(song("bbbbbbbbbbb"), stream);
    // A song that wasn't kept (yt-dlp saved it) isn't on the list.
    const album = await store.saveList({ playlistId: "OLAK5uy_album", title: "Album", cover: "https://example.com/c.jpg", videoIds: ["aaaaaaaaaaa", "ccccccccccc", "bbbbbbbbbbb"] });
    expect(album?.videoIds).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(await store.saveList({ playlistId: "PLnothing", title: "Nothing kept", videoIds: ["ccccccccccc"] })).toBeUndefined();
    await store.saveList({ playlistId: "PLmix", title: "Mix", videoIds: ["bbbbbbbbbbb"] });

    // Removing a song takes it off its lists; a list left empty goes.
    await store.remove("aaaaaaaaaaa");
    expect((await store.lists()).map((list) => [list.playlistId, list.videoIds])).toEqual(
      expect.arrayContaining([
        ["OLAK5uy_album", ["bbbbbbbbbbb"]],
        ["PLmix", ["bbbbbbbbbbb"]],
      ]),
    );
    // Removing a list keeps its songs that another list has.
    expect(await store.removeList("OLAK5uy_album")).toEqual([]);
    expect(await store.has("bbbbbbbbbbb")).toBe(true);
    expect(await store.removeList("PLmix")).toEqual(["bbbbbbbbbbb"]);
    expect(await store.has("bbbbbbbbbbb")).toBe(false);
    expect(await store.lists()).toEqual([]);
  });

  test("keeps what exporting later needs, moves a staged stream in, and remembers the export", async () => {
    const dir = tempDir();
    const store = new OfflineStore(join(dir, "offline"));
    const staged = await store.stagingFile("n1oPCIdabo4", 251);
    writeFileSync(staged, "opus!!");
    const exportInfo = { tags: { title: "Song", artist: "Artist" }, fields: { id: "n1oPCIdabo4", title: "Song" }, inList: false };
    const cover = { data: Buffer.from("jpeg"), width: 544, height: 544 };
    await store.save(song(), staged, { move: true, exportInfo, cover });
    expect(existsSync(staged)).toBe(false);

    const kept = await store.kept("n1oPCIdabo4");
    expect(kept?.track.export).toEqual({ ...exportInfo, cover: { width: 544, height: 544 } });
    expect(Buffer.from(kept!.cover!.data).toString()).toBe("jpeg");
    expect(readFileSync(kept!.audio, "utf8")).toBe("opus!!");
    expect(kept?.track.exported).toBeUndefined();

    await store.exported("n1oPCIdabo4", "/music/Song.mp3");
    expect((await store.kept("n1oPCIdabo4"))?.track.exported).toBe("/music/Song.mp3");
  });

  test("only video ids name its folders", async () => {
    const store = new OfflineStore(tempDir());
    await expect(store.remove("../settings")).rejects.toThrow("not a video id");
  });
});

describe("the site's offline records", () => {
  test("entity keys are the site's", () => {
    // Keys the site wrote for its own (refused) download of this song.
    expect(songKey("n1oPCIdabo4", "musicTrack")).toBe("EgtuMW9QQ0lkYWJvNCAcKAE%3D");
    expect(songKey("n1oPCIdabo4", "downloadStatusEntity")).toBe("EgtuMW9QQ0lkYWJvNCCNASgB");
    expect(songKey("n1oPCIdabo4", "musicTrackDownloadMetadataEntity")).toBe("EgtuMW9QQ0lkYWJvNCDqASgB");
    expect(libraryKey()).toBe("EhptdXNpY19kb3dubG9hZHNfbGlicmFyeV9pZCCBAigB");
    expect(entityKey("n1oPCIdabo4", "playbackData")).toBe("EgtuMW9QQ0lkYWJvNCB3KAE%3D");
  });

  test("a song plays from the media store through a local URL", () => {
    const entry = indexEntry("n1oPCIdabo4", FORMAT);
    expect(entry.fmts).toBe("dlt=-1&mket=214&avbr=0");
    const url = new URL(String(entry.format.url));
    expect(url.protocol).toBe("local:");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lmt: FORMAT.lastModified,
      docid: "n1oPCIdabo4",
      fmtid: "251",
      type: "audio/webm",
      csz: String(CHUNK_BYTES),
      clen: "6",
    });
    expect(entry.format).toMatchObject({ itag: 251, initRange: FORMAT.initRange, indexRange: FORMAT.indexRange, audioChannels: 2 });
    expect(AUDIO_ONLY).toEqual({ fmts: "music", format: {} });
    expect(chunkKey("n1oPCIdabo4", FORMAT, 3)).toBe("n1oPCIdabo4|251|1790952183216241|0000000003");
  });

  test("the entities make a complete, playable download", () => {
    const now = 1_800_000_000;
    const { entities, associations } = songEntities({ track: { ...song(), addedAt: 5 }, playerResponse: PLAYER_RESPONSE }, now, "token");
    const byType = Object.fromEntries(entities.map((record) => [record.entityType, record.data]));
    expect(entities.every((record) => record.version === 0 && record.key === songKey("n1oPCIdabo4", record.entityType))).toBe(true);
    expect(byType.transfer).toMatchObject({ transferState: "TRANSFER_STATE_COMPLETE", cotn: "token" });
    expect(byType.downloadStatusEntity).toMatchObject({ downloadState: "DOWNLOAD_STATE_COMPLETE" });
    expect(byType.playbackData).toMatchObject({ playerResponseJson: PLAYER_RESPONSE, transfer: songKey("n1oPCIdabo4", "transfer") });
    expect(byType.musicTrack).toMatchObject({ title: "Song", artistNames: "Artist", albumTitle: "Album", lengthMs: "214000" });
    expect(byType.offlineVideoPolicy).toEqual(policyRecord("n1oPCIdabo4", now).data);
    expect(Number((byType.offlineVideoPolicy as { expirationTimestamp: string }).expirationTimestamp)).toBeGreaterThan(now);
    expect(associations).toContainEqual({ parentEntityKey: libraryKey(), childEntityKey: songKey("n1oPCIdabo4", "musicTrack") });
  });

  test("an album lists its songs by their keys", () => {
    const { entities } = listEntities({ playlistId: "OLAK5uy_album", title: "Album", cover: "https://example.com/c.jpg", videoIds: ["n1oPCIdabo4"], addedAt: 7 });
    const playlist = entities.find((record) => record.entityType === "musicPlaylist")!;
    expect(playlist.key).toBe(entityKey("OLAK5uy_album", "musicPlaylist"));
    expect(playlist.data).toMatchObject({ playlistId: "OLAK5uy_album", title: "Album", tracks: [songKey("n1oPCIdabo4", "musicTrack")] });
    expect(entities.find((record) => record.entityType === "musicPlaylistDownloadMetadataEntity")?.data).toMatchObject({ addedTimestampMillis: "7" });
  });
});
