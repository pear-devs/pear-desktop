import { test, expect } from '@playwright/test';

import { sliceQueueDatasFromVideo, type QueueDataLike } from './queue-playlist';

// trimmed from a real `/music/get_queue` response for playlist
// PLTVVimTiUJwUbIqmTHncJvWRidgjjn1Ps (videoIds removed, order preserved)
const queueDatas = [
  'xneiaE_SCg8',
  '-JizDAzmXhA',
  'uweorwa3q34',
  'YObzba1gCfw',
  'eGOH9SdtnXk',
  'oa8jIN_fbCw',
].map(
  (videoId) =>
    ({
      content: { playlistPanelVideoRenderer: { videoId } },
    }) satisfies QueueDataLike,
);

const firstVideoId = (datas: QueueDataLike[]) =>
  datas[0]?.content?.playlistPanelVideoRenderer?.videoId;

test('starts the queue at a track from the middle of the playlist', () => {
  const sliced = sliceQueueDatasFromVideo(queueDatas, 'eGOH9SdtnXk');
  expect(sliced).toHaveLength(2);
  expect(firstVideoId(sliced)).toBe('eGOH9SdtnXk');
});

test('keeps the full playlist when the video is already first', () => {
  expect(sliceQueueDatasFromVideo(queueDatas, 'xneiaE_SCg8')).toHaveLength(6);
});

test('keeps the full playlist when the video is not in it', () => {
  expect(sliceQueueDatasFromVideo(queueDatas, 'does_not_exist')).toHaveLength(
    6,
  );
});
