import { test, expect } from '@playwright/test';

import { installPreferSong } from '../injectors/inject';

const ALBUM_PLAYLIST = 'OLAK5uy_album';

const runs = (text: string) => ({ runs: [{ text }] });

const albumRow = (rowId: string, songId: string) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: rowId },
    menu: {
      menuRenderer: {
        items: [
          {
            menuNavigationItemRenderer: {
              navigationEndpoint: {
                browseEndpoint: { browseId: `MPTC${songId}` },
              },
            },
          },
        ],
      },
    },
  },
});

const queueItem = (
  videoId: string,
  { autoplay = false, musicVideo = false, label = videoId } = {},
) => ({
  playlistPanelVideoRenderer: {
    videoId,
    ...(autoplay ? {} : { playlistSetVideoId: `set-${videoId}` }),
    title: runs(`${label} title`),
    longBylineText: runs(`${label} byline`),
    shortBylineText: runs(`${label} artist`),
    lengthText: runs(`${label} length`),
    thumbnail: { thumbnails: [{ url: `${label}.jpg`, width: 1, height: 1 }] },
    navigationEndpoint: {
      browseEndpoint: { browseId: 'MPREb_album' },
      watchEndpoint: {
        videoId,
        watchEndpointMusicSupportedConfigs: {
          watchEndpointMusicConfig: {
            musicVideoType: musicVideo
              ? 'MUSIC_VIDEO_TYPE_OMV'
              : 'MUSIC_VIDEO_TYPE_ATV',
          },
        },
      },
    },
  },
});

interface Renderer {
  videoId: string;
  title: { runs: { text: string }[] };
  longBylineText: { runs: { text: string }[] };
  lengthText: { runs: { text: string }[] };
  thumbnail: { thumbnails: { url: string }[] };
}

const playAlbum = async (albumRows: unknown[], queue: unknown[]) => {
  const upstream = (input: RequestInfo | URL, init?: RequestInit) => {
    const json = (data: unknown) => Promise.resolve(Response.json(data));
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as Record<string, unknown>;

    if (url.includes('/browse')) return json({ contents: albumRows });
    if (typeof body.videoId === 'string' && !body.playlistId) {
      return json({
        contents: [queueItem(body.videoId, { label: 'from-song-row' })],
      });
    }
    return json({ contents: queue });
  };

  const scope = globalThis as unknown as {
    window: unknown;
    location: { search: string };
    ytcfg: { get(key: string): unknown };
    fetch: typeof fetch;
  };
  scope.window = globalThis;
  scope.location = { search: '' };
  scope.ytcfg = { get: () => 'stub' };
  scope.fetch = upstream as typeof fetch;
  installPreferSong();

  const response = await fetch('/youtubei/v1/next', {
    method: 'POST',
    body: JSON.stringify({ playlistId: ALBUM_PLAYLIST }),
  });
  const { contents } = (await response.json()) as {
    contents: { playlistPanelVideoRenderer: Renderer }[];
  };
  return contents.map((entry) => entry.playlistPanelVideoRenderer);
};

test('replaces a music video with the song version', async () => {
  const [track] = await playAlbum(
    [albumRow('video-1', 'song-1')],
    [queueItem('video-1', { musicVideo: true })],
  );

  expect(track.videoId).toBe('song-1');
  expect(track.title).toEqual(runs('from-song-row title'));
  expect(track.longBylineText).toEqual(runs('from-song-row byline'));
  expect(track.lengthText).toEqual(runs('from-song-row length'));
  expect(track.thumbnail.thumbnails[0].url).toBe('from-song-row.jpg');
  expect(JSON.stringify(track)).not.toContain('MUSIC_VIDEO_TYPE_OMV');
});

test('keeps the music video when there is no song version', async () => {
  const queue = [queueItem('video-1', { musicVideo: true })];

  const [track] = await playAlbum([albumRow('video-1', 'video-1')], queue);

  expect(track).toEqual(queue[0].playlistPanelVideoRenderer);
});

test('ignores autoplay tracks', async () => {
  const queue = [queueItem('video-1', { autoplay: true, musicVideo: true })];

  const [track] = await playAlbum([albumRow('video-1', 'song-1')], queue);

  expect(track).toEqual(queue[0].playlistPanelVideoRenderer);
});
