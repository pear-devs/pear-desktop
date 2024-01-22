import { BrowserWindow, ipcMain, nativeImage, net } from 'electron';

import { Mutex } from 'async-mutex';

import { cache } from './decorators';
import config from '@/config';

import type { GetPlayerResponse } from '@/types/get-player-response';

export interface SongInfo {
  title: string;
  artist: string;
  views: number;
  uploadDate?: string;
  imageSrc?: string | null;
  image?: Electron.NativeImage | null;
  isPaused?: boolean;
  songDuration: number;
  elapsedSeconds?: number;
  url?: string;
  album?: string | null;
  videoId: string;
  playlistId?: string;
}

// Grab the native image using the src
export const getImage = cache(
  async (src: string): Promise<Electron.NativeImage> => {
    const result = await net.fetch(src);
    const buffer = await result.arrayBuffer();
    const output = nativeImage.createFromBuffer(Buffer.from(buffer));
    if (output.isEmpty() && !src.endsWith('.jpg') && src.includes('.jpg')) {
      // Fix hidden webp files (https://github.com/th-ch/youtube-music/issues/315)
      return getImage(src.slice(0, src.lastIndexOf('.jpg') + 4));
    }

    return output;
  },
);

const handleData = async (
  data: GetPlayerResponse,
  win: Electron.BrowserWindow,
): Promise<SongInfo | null> => {
  if (!data) {
    return null;
  }

  // Fill songInfo with empty values
  const songInfo: SongInfo = {
    title: '',
    artist: '',
    views: 0,
    uploadDate: '',
    imageSrc: '',
    image: null,
    isPaused: undefined,
    songDuration: 0,
    elapsedSeconds: 0,
    url: '',
    album: undefined,
    videoId: '',
    playlistId: '',
  } satisfies SongInfo;

  const microformat = data.microformat?.microformatDataRenderer;
  if (microformat) {
    songInfo.uploadDate = microformat.uploadDate;
    songInfo.url = microformat.urlCanonical?.split('&')[0];
    songInfo.playlistId =
      new URL(microformat.urlCanonical).searchParams.get('list') ?? '';
    // Used for options.resumeOnStart
    config.set('url', microformat.urlCanonical);
  }

  const { videoDetails } = data;
  if (videoDetails) {
    songInfo.title = cleanupName(videoDetails.title);
    songInfo.artist = cleanupName(videoDetails.author);
    songInfo.views = Number(videoDetails.viewCount);
    songInfo.songDuration = Number(videoDetails.lengthSeconds);
    songInfo.elapsedSeconds = videoDetails.elapsedSeconds;
    songInfo.isPaused = videoDetails.isPaused;
    songInfo.videoId = videoDetails.videoId;
    songInfo.album = data?.videoDetails?.album; // Will be undefined if video exist

    const thumbnails = videoDetails.thumbnail?.thumbnails;
    songInfo.imageSrc = thumbnails.at(-1)?.url.split('?')[0];
    if (songInfo.imageSrc) songInfo.image = await getImage(songInfo.imageSrc);

    win.webContents.send('ytmd:update-song-info', songInfo);
  }

  return songInfo;
};

// This variable will be filled with the callbacks once they register
export type SongInfoCallback = (songInfo: SongInfo, event?: string) => void;
const callbacks: Set<SongInfoCallback> = new Set();

// This function will allow plugins to register callback that will be triggered when data changes
const registerCallback = (callback: SongInfoCallback) => {
  callbacks.add(callback);
};

const registerProvider = (win: BrowserWindow) => {
  const dataMutex = new Mutex();
  let songInfo: SongInfo | null = null;

  // This will be called when the song-info-front finds a new request with song data
  ipcMain.on('ytmd:video-src-changed', async (_, data: GetPlayerResponse) => {
    const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(async () => {
      songInfo = await handleData(data, win);
      return songInfo;
    });

    if (tempSongInfo) {
      for (const c of callbacks) {
        c(tempSongInfo, 'ytmd:video-src-changed');
      }
    }
  });
  ipcMain.on(
    'ytmd:play-or-paused',
    async (
      _,
      {
        isPaused,
        elapsedSeconds,
      }: { isPaused: boolean; elapsedSeconds: number },
    ) => {
      const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(() => {
        if (!songInfo) {
          return null;
        }

        songInfo.isPaused = isPaused;
        songInfo.elapsedSeconds = elapsedSeconds;

        return songInfo;
      });

      if (tempSongInfo) {
        for (const c of callbacks) {
          c(tempSongInfo, 'ytmd:play-or-paused');
        }
      }
    },
  );
};

const suffixesToRemove = [
  // Artist names
  /\s*(- topic)$/i,
  /\s*vevo$/i,

  // Video titles
  /\s*[(|\[]official(.*?)[)|\]]/i, // (Official Music Video), [Official Visualizer], etc...
  /\s*[(|\[]((lyrics?|visualizer|audio)\s*(video)?)[)|\]]/i,
  /\s*[(|\[](performance video)[)|\]]/i,
  /\s*[(|\[](clip official)[)|\]]/i,
  /\s*[(|\[](video version)[)|\]]/i,
  /\s*[(|\[](HD|HQ)\s*?(?:audio)?[)|\]]$/i,
  /\s*[(|\[](live)[)|\]]$/i,
  /\s*[(|\[]4K\s*?(?:upgrade)?[)|\]]$/i,
];

export function cleanupName(name: string): string {
  if (!name) {
    return name;
  }

  for (const suffix of suffixesToRemove) {
    name = name.replace(suffix, '');
  }

  return name;
}

export default registerCallback;
export const setupSongInfo = registerProvider;
