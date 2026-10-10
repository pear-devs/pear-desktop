export interface QueueDataLike {
  content?: {
    playlistPanelVideoRenderer?: {
      videoId?: string;
    };
  };
}

/**
 * Returns queueDatas starting at the item matching `videoId`.
 * If the video is not found or is already first, returns unchanged.
 */
export const sliceQueueDatasFromVideo = (
  queueDatas: QueueDataLike[],
  videoId: string,
): QueueDataLike[] => {
  const startIndex = queueDatas.findIndex(
    (it) => it.content?.playlistPanelVideoRenderer?.videoId === videoId,
  );

  return startIndex > 0 ? queueDatas.slice(startIndex) : queueDatas;
};
