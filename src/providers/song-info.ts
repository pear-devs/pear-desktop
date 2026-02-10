import { type BrowserWindow, ipcMain, nativeImage, net } from 'electron';

import { Mutex } from 'async-mutex';

import * as config from '@/config';

import type { GetPlayerResponse } from '@/types/get-player-response';

export enum MediaType {
  /**
   * Audio uploaded by the original artist
   */
  Audio = 'AUDIO',
  /**
   * Official music video uploaded by the original artist
   */
  OriginalMusicVideo = 'ORIGINAL_MUSIC_VIDEO',
  /**
   * Normal video uploaded by a user
   */
  UserGeneratedContent = 'USER_GENERATED_CONTENT',
  /**
   * Podcast episode
   */
  PodcastEpisode = 'PODCAST_EPISODE',
  OtherVideo = 'OTHER_VIDEO',
}

export interface SongInfo {
  title: string;
  alternativeTitle?: string;
  artist: string;
  artistUrl?: string;
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
  mediaType: MediaType;
  tags?: string[];
}

// Grab the native image using the src
export const getImage = async (src: string): Promise<Electron.NativeImage> => {
  const result = await net.fetch(src);
  const output = nativeImage.createFromBuffer(
    Buffer.from(await result.arrayBuffer()),
  );
  if (output.isEmpty() && !src.endsWith('.jpg') && src.includes('.jpg')) {
    // Fix hidden webp files (https://github.com/pear-devs/pear-desktop/issues/315)
    return getImage(src.slice(0, src.lastIndexOf('.jpg') + 4));
  }

  return output;
};

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
    alternativeTitle: '',
    artist: '',
    artistUrl: '',
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
    mediaType: MediaType.Audio,
    tags: [],
  } satisfies SongInfo;

  const microformat = data.microformat?.microformatDataRenderer;
  if (microformat) {
    songInfo.uploadDate = microformat.uploadDate;
    songInfo.url = microformat.urlCanonical?.split('&')[0];
    songInfo.playlistId =
      new URL(microformat.urlCanonical).searchParams.get('list') ?? '';
    if (microformat.pageOwnerDetails?.externalChannelId) {
      songInfo.artistUrl = `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/channel/${microformat.pageOwnerDetails.externalChannelId}`;
    }
    // Used for options.resumeOnStart
    config.set('url', microformat.urlCanonical);
    songInfo.alternativeTitle = microformat.linkAlternates.find(
      (link) => link.title,
    )?.title;
    songInfo.tags = Array.isArray(microformat.tags) ? microformat.tags : [];
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
    songInfo.album = videoDetails.album; // Will be undefined if video exist

    switch (videoDetails?.musicVideoType) {
      case 'MUSIC_VIDEO_TYPE_ATV':
        songInfo.mediaType = MediaType.Audio;
        break;
      case 'MUSIC_VIDEO_TYPE_OMV':
        songInfo.mediaType = MediaType.OriginalMusicVideo;
        break;
      case 'MUSIC_VIDEO_TYPE_UGC':
        songInfo.mediaType = MediaType.UserGeneratedContent;
        break;
      case 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE':
        songInfo.mediaType = MediaType.PodcastEpisode;
        // HACK: Podcast's participant is not the artist
        if (!config.get('options.usePodcastParticipantAsArtist')) {
          songInfo.artist = cleanupName(
            data.microformat.microformatDataRenderer.pageOwnerDetails.name,
          );
        }
        break;
      default:
        songInfo.mediaType = MediaType.OtherVideo;
        // HACK: This is a workaround for "podcast" types where "musicVideoType" doesn't exist. Google :facepalm:
        if (
          !config.get('options.usePodcastParticipantAsArtist') &&
          (data.responseContext.serviceTrackingParams
            ?.at(0)
            ?.params?.find((it) => it.key === 'ipcc')?.value ?? '1') != '0'
        ) {
          songInfo.artist = cleanupName(
            data.microformat.microformatDataRenderer.pageOwnerDetails.name,
          );
        }
        break;
    }

    const thumbnails = videoDetails.thumbnail?.thumbnails;
    songInfo.imageSrc = thumbnails?.at(-1)?.url?.split('?')?.at(0);

    if (
      songInfo.imageSrc &&
      !(await net.fetch(songInfo.imageSrc, { method: 'HEAD' })).ok
    ) {
      songInfo.imageSrc = thumbnails.at(-1)?.url;
    }

    if (songInfo.imageSrc) songInfo.image = await getImage(songInfo.imageSrc);

    win.webContents.send('peard:update-song-info', songInfo);
  }

  return songInfo;
};

export enum SongInfoEvent {
  VideoSrcChanged = 'peard:video-src-changed',
  PlayOrPaused = 'peard:play-or-paused',
  TimeChanged = 'peard:time-changed',
}

// This variable will be filled with the callbacks once they register
export type SongInfoCallback = (
  songInfo: SongInfo,
  event: SongInfoEvent,
) => void;
const callbacks: Set<SongInfoCallback> = new Set();

// This function will allow plugins to register callback that will be triggered when data changes
export const registerCallback = (callback: SongInfoCallback) => {
  callbacks.add(callback);
};

const registerProvider = (win: BrowserWindow) => {
  const dataMutex = new Mutex();
  let songInfo: SongInfo | null = null;

  // This will be called when the song-info-front finds a new request with song data
  ipcMain.on('peard:video-src-changed', async (_, data: GetPlayerResponse) => {
    const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(
      async () => {
        songInfo = await handleData(data, win);
        return songInfo;
      },
    );

    if (tempSongInfo) {
      for (const c of callbacks) {
        c(tempSongInfo, SongInfoEvent.VideoSrcChanged);
      }
    }
  });
  ipcMain.on(
    'peard:play-or-paused',
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
          c(tempSongInfo, SongInfoEvent.PlayOrPaused);
        }
      }
    },
  );

  ipcMain.on('peard:time-changed', async (_, seconds: number) => {
    const tempSongInfo = await dataMutex.runExclusive<SongInfo | null>(() => {
      if (!songInfo) {
        return null;
      }

      songInfo.elapsedSeconds = seconds;

      return songInfo;
    });

    if (tempSongInfo) {
      for (const c of callbacks) {
        c(tempSongInfo, SongInfoEvent.TimeChanged);
      }
    }
  });
};

const suffixesToRemove = [
  // Artist names
  /\s*(- topic)$/i,
  /\s*vevo$/i,

  // Video titles
  /\s*[(|[]official(.*?)[)|\]]/i, // (Official Music Video), [Official Visualizer], etc...
  /\s*[(|[]((lyrics?|visualizer|audio)\s*(video)?)[)|\]]/i,
  /\s*[(|[](performance video)[)|\]]/i,
  /\s*[(|[](clip official)[)|\]]/i,
  /\s*[(|[](video version)[)|\]]/i,
  /\s*[(|[](HD|HQ)\s*?(?:audio)?[)|\]]$/i,
  /\s*[(|[](live)[)|\]]$/i,
  /\s*[(|[]4K\s*?(?:upgrade)?[)|\]]$/i,
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

export const setupSongInfo = registerProvider;
