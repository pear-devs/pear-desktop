import { config } from "@pear/sdk";
import { DEFAULT_TEMPLATE } from "./ytdlp.ts";

// Option names follow pear-desktop 3.x's where they mean the same (see PLUGIN_MIGRATIONS for the rest).
export const downloaderConfig = {
  downloadFolder: config.string("", {
    label: "Download folder",
    placeholder: "Downloads",
    description: "Leave empty for your Downloads folder, like pear-desktop.",
  }),
  exportFiles: config.bool(false, {
    label: "Save songs to the download folder",
    description:
      "Off, downloaded songs stay in the app, where the Downloads page plays them offline, until you export them from the Downloads list. Songs only yt-dlp can get are always saved to the folder.",
  }),
  format: config.select(
    "mp3",
    [
      { value: "mp3", label: "MP3 (most compatible)" },
      { value: "m4a", label: "M4A / AAC" },
      { value: "opus", label: "Opus (best quality for size)" },
      { value: "source", label: "As streamed (no conversion)" },
      { value: "custom", label: "Custom" },
    ],
    { label: "Format" },
  ),
  // pear-desktop's Custom preset.
  customArgs: config.string("", {
    label: "ffmpeg arguments",
    placeholder: "-b:a 320k",
    description: "Passed to ffmpeg when converting, e.g. -b:a 320k.",
    group: "Custom format",
  }),
  customExtension: config.string("", {
    label: "Extension",
    placeholder: "mp3",
    description: "aac, alac, flac, m4a, mp3, opus, vorbis or wav; empty keeps the streamed format.",
    group: "Custom format",
  }),
  useSession: config.bool(true, {
    label: "Download with my account",
    description: "Lets downloads reach private playlists, liked songs and age-restricted songs, as pear-desktop did.",
  }),
  template: config.string(DEFAULT_TEMPLATE, {
    label: "File name",
    placeholder: DEFAULT_TEMPLATE,
    description: "A yt-dlp output template, e.g. %(album)s/%(title)s.%(ext)s",
  }),
  playlistFolders: config.bool(true, { label: "Put albums and playlists in their own folder" }),
  playlistMaxItems: config.number(0, { label: "Most songs per playlist", min: 0, max: 5000, description: "0 means no limit." }),
  skipExisting: config.bool(true, { label: "Skip songs that are already downloaded" }),
  archive: config.bool(true, {
    label: "…even when their files were renamed",
    description: "Remembers what was downloaded to a folder by song, in a list there (yt-dlp's download archive).",
  }),
  offline: config.bool(true, {
    label: "Play downloaded songs offline",
    description:
      "The Downloads page in your Library plays downloaded songs without internet (the songs the built-in downloader saves). The site's own Premium downloads stop working while this is on.",
  }),
  squareCover: config.bool(true, { label: "Crop cover art to a square" }),
  replayGain: config.bool(false, {
    label: "Add ReplayGain tags",
    description: "Measures each song's loudness so players can even it out; the audio stays as it is. MP3 and Opus, with the built-in downloader.",
  }),
  lyrics: config.bool(false, {
    label: "Add lyrics to the files",
    description: "Looked up on LRCLib, as synced-lyrics does. Only the built-in downloader adds them.",
    group: "Lyrics",
  }),
  lyricsFile: config.bool(false, { label: "Also save synced lyrics as an .lrc file next to the song", group: "Lyrics" }),
  notifyWhenHidden: config.bool(true, { label: "Notify me when a download finishes while the window is hidden" }),
  autoDownload: config.bool(false, {
    label: "Download everything I listen to",
    description: "Saves each song shortly before it ends.",
    group: "Automatic downloads",
  }),
  autoDownloadMode: config.select(
    "seconds",
    [
      { value: "seconds", label: "Near the end" },
      { value: "percent", label: "Once partly played" },
    ],
    { label: "When", group: "Automatic downloads" },
  ),
  autoDownloadSeconds: config.number(20, { label: "…this long before the end", min: 1, max: 600, unit: "s", group: "Automatic downloads" }),
  autoDownloadPercent: config.number(10, { label: "…once this much has played", min: 1, max: 100, unit: "%", group: "Automatic downloads" }),
  autoDownloadFolder: config.string("", {
    label: "Folder for these",
    placeholder: "The download folder",
    description: "Leave empty to use the download folder.",
    group: "Automatic downloads",
  }),
  engine: config.select(
    "auto",
    [
      { value: "auto", label: "Built in, then yt-dlp" },
      { value: "yt-dlp", label: "Only yt-dlp" },
    ],
    {
      label: "Download with",
      description: "The built-in downloader needs no other program; yt-dlp takes over for songs it can't get. The Custom format always uses yt-dlp.",
      group: "Programs",
    },
  ),
  ytDlpPath: config.string("", {
    label: "yt-dlp",
    placeholder: "Found automatically",
    description: "Path to the yt-dlp program.",
    group: "Programs",
  }),
  ffmpegPath: config.string("", {
    label: "ffmpeg",
    placeholder: "Found automatically",
    description: "Path to ffmpeg or its folder; yt-dlp needs it to convert audio.",
    group: "Programs",
  }),
};
