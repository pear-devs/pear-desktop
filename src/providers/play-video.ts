type YouTubeMusicApp = Pick<EventTarget, 'dispatchEvent'>;

type YouTubeNavigationDetail = {
  endpoint: {
    clickTrackingParams: string;
    commandMetadata: {
      webCommandMetadata: {
        rootVe: number;
        url: string;
        webPageType: string;
      };
    };
    watchEndpoint: {
      videoId: string;
    };
  };
};

export const playVideo = (app: YouTubeMusicApp | null, videoId: string) => {
  app?.dispatchEvent(
    new CustomEvent<YouTubeNavigationDetail>('yt-navigate', {
      bubbles: true,
      composed: true,
      detail: {
        endpoint: {
          clickTrackingParams: '',
          commandMetadata: {
            webCommandMetadata: {
              rootVe: 3832,
              url: `/watch?v=${encodeURIComponent(videoId)}`,
              webPageType: 'WEB_PAGE_TYPE_WATCH',
            },
          },
          watchEndpoint: { videoId },
        },
      },
    }),
  );
};
