// The records the site's offline player and Downloads page read for one song
// (pure): entities for its entity store, the media store's index entry, and the
// keys they go under. page/offline.ts writes them; the layout follows what the
// site's player writes for its own downloads.

import type { OfflineData, OfflineFormat, OfflineList } from "../offline.ts";

/** Entity type numbers, as the site's entity keys carry them. */
export const ENTITY = {
  musicPlaylist: 24,
  musicTrack: 28,
  playbackData: 119,
  transfer: 120,
  offlineVideoPolicy: 130,
  downloadStatusEntity: 141,
  musicTrackDownloadMetadataEntity: 234,
  musicPlaylistDownloadMetadataEntity: 248,
  musicDownloadsLibraryEntity: 257,
  videoDownloadContextEntity: 461,
} as const;
export type EntityType = keyof typeof ENTITY;

/** The entities a song has, which removing it deletes. */
export const SONG_ENTITIES: readonly EntityType[] = [
  "musicTrack",
  "playbackData",
  "transfer",
  "offlineVideoPolicy",
  "downloadStatusEntity",
  "musicTrackDownloadMetadataEntity",
  "videoDownloadContextEntity",
];

/** The entities a list has. */
export const LIST_ENTITIES: readonly EntityType[] = ["musicPlaylist", "musicPlaylistDownloadMetadataEntity"];
/** The size the cover art is fetched in (the site's image server scales it). */
const COVER_SIZE = 1200;

/** The id of the one library entity, which lists the downloaded songs. */
export const LIBRARY_ID = "music_downloads_library_id";
/** The stream is kept in parts of this size, as the site's player does. */
export const CHUNK_BYTES = 1024 * 1024;
/** How long a kept song plays offline; every start renews it. */
const POLICY_SECONDS = 365 * 24 * 60 * 60;

/** A row of the entity store; version 0 is unencrypted, which the site reads as well. */
export interface EntityRecord {
  key: string;
  entityType: EntityType;
  data: Record<string, unknown>;
  version: 0;
}

export interface Association {
  parentEntityKey: string;
  childEntityKey: string;
}

/** The media store's entry for a stream. */
export interface IndexEntry {
  fmts: string;
  format: Record<string, unknown>;
}

const varint = (value: number) => {
  const bytes: number[] = [];
  for (; value > 0x7f; value >>>= 7) bytes.push((value & 0x7f) | 0x80);
  bytes.push(value);
  return bytes;
};

/** An entity key: the protobuf { 2: id, 4: type, 5: 1 (kept on disk) } in base64, URL-encoded as the site stores it. */
export function entityKey(id: string, type: EntityType): string {
  const idBytes = [...new TextEncoder().encode(id)];
  const bytes = [0x12, ...varint(idBytes.length), ...idBytes, 0x20, ...varint(ENTITY[type]), 0x28, 1];
  return encodeURIComponent(btoa(String.fromCharCode(...bytes)));
}

export const songKey = (videoId: string, type: EntityType) => entityKey(videoId, type);
export const libraryKey = () => entityKey(LIBRARY_ID, "musicDownloadsLibraryEntity");

/** The media store's keys: the stream's entry, the video slot's, and each part's. */
export const indexKey = (videoId: string, slot: "a" | "v") => `${videoId}|${slot}`;
export const chunkKey = (videoId: string, format: Pick<OfflineFormat, "itag" | "lastModified">, part: number) =>
  `${videoId}|${format.itag}|${format.lastModified}|${String(part).padStart(10, "0")}`;

/** The policy that lets the player play the song offline, until `now` (seconds) plus a year. */
export function policyRecord(videoId: string, now: number): EntityRecord {
  const key = songKey(videoId, "offlineVideoPolicy");
  const data = {
    key,
    action: "OFFLINE_VIDEO_POLICY_ACTION_OK",
    expirationTimestamp: String(now + POLICY_SECONDS),
    lastUpdatedTimestampSeconds: String(now),
  };
  return { key, entityType: "offlineVideoPolicy", data, version: 0 };
}

interface VideoDetails {
  title?: string;
  author?: string;
  lengthSeconds?: string;
  musicVideoType?: string;
  thumbnail?: { thumbnails?: { url: string; width?: number; height?: number }[] };
}

/**
 * A song's entities and their associations (`now` in seconds); `cotn` is the
 * offline playback's token, which the player reports instead of a server's.
 */
export function songEntities({ track, playerResponse }: Pick<OfflineData, "track" | "playerResponse">, now: number, cotn: string) {
  const { videoId } = track;
  const key = (type: EntityType) => songKey(videoId, type);
  const details = (JSON.parse(playerResponse) as { videoDetails?: VideoDetails }).videoDetails ?? {};
  const status = { key: key("downloadStatusEntity"), downloadState: "DOWNLOAD_STATE_COMPLETE" };
  const record = (entityType: EntityType, data: Record<string, unknown>): EntityRecord => ({ key: key(entityType), entityType, data, version: 0 });
  const entities = [
    record("musicTrack", {
      id: key("musicTrack"),
      videoId,
      title: track.title || details.title || videoId,
      artistNames: track.artist ?? details.author ?? "",
      ...(track.album ? { albumTitle: track.album } : {}),
      lengthMs: String(Number(details.lengthSeconds ?? 0) * 1000 || track.format.approxDurationMs),
      thumbnailDetails: { thumbnails: details.thumbnail?.thumbnails ?? [] },
      musicVideoType: details.musicVideoType ?? "MUSIC_VIDEO_TYPE_ATV",
      downloadMetadata: key("musicTrackDownloadMetadataEntity"),
    }),
    record("musicTrackDownloadMetadataEntity", {
      id: key("musicTrackDownloadMetadataEntity"),
      playbackData: key("playbackData"),
      addedTimestampMillis: String(track.addedAt),
      downloadStatusEntity: status,
    }),
    record("downloadStatusEntity", status),
    record("playbackData", {
      key: key("playbackData"),
      playerResponseJson: playerResponse,
      playerResponseTimestamp: String(now),
      offlineVideoPolicy: key("offlineVideoPolicy"),
      transfer: key("transfer"),
      playerResponsePlayabilityCanPlayStatus: "OK",
    }),
    record("transfer", { key: key("transfer"), transferState: "TRANSFER_STATE_COMPLETE", cotn }),
    policyRecord(videoId, now),
  ];
  const associations: Association[] = [
    { parentEntityKey: key("musicTrack"), childEntityKey: key("musicTrackDownloadMetadataEntity") },
    { parentEntityKey: key("musicTrackDownloadMetadataEntity"), childEntityKey: key("playbackData") },
    { parentEntityKey: key("playbackData"), childEntityKey: key("offlineVideoPolicy") },
    { parentEntityKey: key("playbackData"), childEntityKey: key("transfer") },
    { parentEntityKey: libraryKey(), childEntityKey: key("musicTrack") },
  ];
  return { entities, associations };
}

/**
 * An album's or playlist's entities: the site's Downloads page lists it under
 * Albums when its id is an album's ("OL…"), under Playlists otherwise, and
 * plays its songs offline from `tracks`.
 */
export function listEntities(list: OfflineList) {
  const key = (type: EntityType) => entityKey(list.playlistId, type);
  const record = (entityType: EntityType, data: Record<string, unknown>): EntityRecord => ({ key: key(entityType), entityType, data, version: 0 });
  const tracks = list.videoIds.map((videoId) => songKey(videoId, "musicTrack"));
  const entities = [
    record("musicPlaylist", {
      id: key("musicPlaylist"),
      playlistId: list.playlistId,
      title: list.title,
      thumbnailDetails: { thumbnails: list.cover ? [{ url: list.cover, width: COVER_SIZE, height: COVER_SIZE }] : [] },
      tracks,
      downloadMetadata: key("musicPlaylistDownloadMetadataEntity"),
    }),
    record("musicPlaylistDownloadMetadataEntity", { id: key("musicPlaylistDownloadMetadataEntity"), addedTimestampMillis: String(list.addedAt) }),
  ];
  const associations: Association[] = [
    { parentEntityKey: libraryKey(), childEntityKey: key("musicPlaylist") },
    { parentEntityKey: key("musicPlaylist"), childEntityKey: key("musicPlaylistDownloadMetadataEntity") },
    ...tracks.map((track) => ({ parentEntityKey: key("musicPlaylist"), childEntityKey: track })),
  ];
  return { entities, associations };
}

/**
 * The media store's entry for the kept stream: its format, with a local URL
 * the player reads the parts through, and how much of it is there (all of it).
 */
export function indexEntry(videoId: string, format: OfflineFormat): IndexEntry {
  const url = new URLSearchParams({
    lmt: format.lastModified,
    docid: videoId,
    fmtid: String(format.itag),
    type: format.mimeType.split(";")[0]!,
    csz: String(CHUNK_BYTES),
    clen: String(format.contentLength),
  });
  const seconds = format.approxDurationMs / 1000;
  const fmts = new URLSearchParams({
    dlt: "-1",
    mket: String(Math.round(seconds)),
    avbr: String(Math.round(format.contentLength / Math.max(1, seconds))),
  });
  const entry: Record<string, unknown> = {
    itag: format.itag,
    mimeType: format.mimeType,
    bitrate: format.bitrate,
    lastModified: format.lastModified,
    initRange: format.initRange,
    indexRange: format.indexRange,
    url: `local://localhost/videoplayback?${url}`,
  };
  if (format.audioSampleRate) entry.audioSampleRate = format.audioSampleRate;
  if (format.audioChannels) entry.audioChannels = format.audioChannels;
  return { fmts: fmts.toString(), format: entry };
}

/** An audio-only song has no video stream; the player expects this in the video slot. */
export const AUDIO_ONLY: IndexEntry = { fmts: "music", format: {} };
