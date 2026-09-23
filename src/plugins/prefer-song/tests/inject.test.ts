import { test, expect } from '@playwright/test';

import { installPreferSong } from '../injectors/inject';

const RELEASE_PLAYLIST = 'OLAK5uy_album';
const RELEASE_BROWSE = 'MPREb_album';
const FIRST_SET = '000000000000000A';
const SECOND_SET = '000000000000000B';

const runs = (text: string) => ({ runs: [{ text }] });

const releaseRow = (rowId: string, songId: string, setId = FIRST_SET) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: rowId, playlistSetVideoId: setId },
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
  {
    autoplay = false,
    musicVideo = false,
    label = videoId,
    setId = FIRST_SET,
    namesRelease = true,
  } = {},
) => ({
  playlistPanelVideoRenderer: {
    videoId,
    ...(autoplay ? {} : { playlistSetVideoId: setId }),
    title: runs(`${label} title`),
    longBylineText: runs(`${label} byline`),
    shortBylineText: runs(`${label} artist`),
    lengthText: runs(`${label} length`),
    thumbnail: { thumbnails: [{ url: `${label}.jpg`, width: 1, height: 1 }] },
    navigationEndpoint: {
      ...(namesRelease ? { browseEndpoint: { browseId: RELEASE_BROWSE } } : {}),
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

const gzip = (text: string) =>
  new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();

const gunzip = (buffer: ArrayBuffer) =>
  new Response(
    new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();

const post = async (path: string, body: Record<string, unknown>) =>
  fetch(
    new Request('https://music.youtube.com' + path, {
      method: 'POST',
      body: await gzip(JSON.stringify(body)),
    }),
  );

const setupYouTubeMusic = (releaseRows: unknown[], queue: unknown[]) => {
  const playerRequests: Record<string, unknown>[] = [];

  const upstream = async (input: RequestInfo | URL, init?: RequestInit) => {
    const json = (data: unknown) => Response.json(data);
    const url = input instanceof Request ? input.url : String(input);
    const body = (
      input instanceof Request
        ? JSON.parse(await gunzip(await input.clone().arrayBuffer()))
        : JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
    ) as Record<string, unknown>;

    if (url.includes('/browse')) {
      return json(
        typeof body.browseId === 'string' && body.browseId.startsWith('VL')
          ? { contents: [{ browseEndpoint: { browseId: RELEASE_BROWSE } }] }
          : { contents: releaseRows },
      );
    }
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
  const response = await post('/youtubei/v1/next', {
    playlistId: RELEASE_PLAYLIST,
  });
  const { contents } = (await response.json()) as {
    contents: { playlistPanelVideoRenderer: Renderer }[];
  };
  return {
    tracks: contents.map((entry) => entry.playlistPanelVideoRenderer),
    playerRequests,
  };
};

const playFromRelease = (videoId: string, setId = FIRST_SET) =>
  post('/youtubei/v1/player', {
    videoId,
    playlistId: RELEASE_PLAYLIST,
    params: encodeURIComponent(btoa('\xf0\x05\x01' + setId)),
  });

const playOutsideRelease = (videoId: string, playlistId?: string) =>
  post(
    '/youtubei/v1/player',
    playlistId ? { videoId, playlistId } : { videoId },
  );

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

test('finds the song from the playlist when missing from the queue', async () => {
  const {
    tracks: [track],
  } = await playRelease(
    [releaseRow('video-1', 'song-1')],
    [queueItem('video-1', { musicVideo: true, namesRelease: false })],
  );

  expect(track.videoId).toBe('song-1');
});

test('plays each song on its own when one video contains more than one song', async () => {
  const { tracks } = await playRelease(
    [
      releaseRow('video-1', 'song-1', FIRST_SET),
      releaseRow('video-1', 'song-2', SECOND_SET),
    ],
    [
      queueItem('video-1', { musicVideo: true, setId: FIRST_SET }),
      queueItem('video-1', { musicVideo: true, setId: SECOND_SET }),
    ],
  );

  expect(tracks.map((track) => track.videoId)).toEqual(['song-1', 'song-2']);
});

test('plays the song when a music video is played from a release', async () => {
  const { playerRequests } = await playRelease(
    [releaseRow('video-1', 'song-1')],
    [queueItem('video-1', { musicVideo: true })],
  );

  await playFromRelease('video-1');

  expect(playerRequests.map((request) => request.videoId)).toEqual(['song-1']);
});

test('plays the song that was picked when one video contains more than one song', async () => {
  const { playerRequests } = await playRelease(
    [
      releaseRow('video-1', 'song-1', FIRST_SET),
      releaseRow('video-1', 'song-2', SECOND_SET),
    ],
    [queueItem('video-2', { musicVideo: true })],
  );

  await playFromRelease('video-1', FIRST_SET);

  expect(playerRequests.map((request) => request.videoId)).toEqual(['song-1']);
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
