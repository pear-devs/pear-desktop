import { test, expect } from '@playwright/test';

import { installPreferSong } from '../injectors/inject';

const RELEASE_PLAYLIST = 'OLAK5uy_album';

const runs = (text: string) => ({ runs: [{ text }] });

const releaseRow = (rowId: string, songId: string) => ({
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

const setupYouTubeMusic = (releaseRows: unknown[], queue: unknown[]) => {
  const playerRequests: Record<string, unknown>[] = [];

  const upstream = (input: RequestInfo | URL, init?: RequestInit) => {
    const json = (data: unknown) => Promise.resolve(Response.json(data));
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as Record<string, unknown>;

    if (url.includes('/browse')) return json({ contents: releaseRows });
    if (url.includes('/player')) {
      playerRequests.push(body);
      return json({});
    }
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
  return { playerRequests };
};

const playRelease = async (releaseRows: unknown[], queue: unknown[]) => {
  const { playerRequests } = setupYouTubeMusic(releaseRows, queue);
  const response = await fetch('/youtubei/v1/next', {
    method: 'POST',
    body: JSON.stringify({ playlistId: RELEASE_PLAYLIST }),
  });
  const { contents } = (await response.json()) as {
    contents: { playlistPanelVideoRenderer: Renderer }[];
  };
  return {
    tracks: contents.map((entry) => entry.playlistPanelVideoRenderer),
    playerRequests,
  };
};

const playOutsideRelease = (videoId: string, playlistId?: string) =>
  fetch('/youtubei/v1/player', {
    method: 'POST',
    body: JSON.stringify(playlistId ? { videoId, playlistId } : { videoId }),
  });

test('replaces a music video with the song version', async () => {
  const {
    tracks: [track],
  } = await playRelease(
    [releaseRow('video-1', 'song-1')],
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

  const {
    tracks: [track],
  } = await playRelease([releaseRow('video-1', 'video-1')], queue);

  expect(track).toEqual(queue[0].playlistPanelVideoRenderer);
});

test('ignores autoplay tracks', async () => {
  const queue = [queueItem('video-1', { autoplay: true, musicVideo: true })];

  const {
    tracks: [track],
  } = await playRelease([releaseRow('video-1', 'song-1')], queue);

  expect(track).toEqual(queue[0].playlistPanelVideoRenderer);
});

test('ignores a music video played on its own', async () => {
  const { playerRequests } = await playRelease(
    [releaseRow('video-1', 'song-1')],
    [queueItem('video-1', { musicVideo: true })],
  );

  await playOutsideRelease('video-1');

  expect(playerRequests).toEqual([{ videoId: 'video-1' }]);
});

test('ignores a music video played from a mix', async () => {
  const { playerRequests } = await playRelease(
    [releaseRow('video-1', 'song-1')],
    [queueItem('video-1', { musicVideo: true })],
  );
  (globalThis as unknown as { location: { search: string } }).location = {
    search: `?list=${RELEASE_PLAYLIST}`,
  };

  await playOutsideRelease('video-1', 'RDAMPLmix');

  expect(playerRequests).toEqual([
    { videoId: 'video-1', playlistId: 'RDAMPLmix' },
  ]);
});
