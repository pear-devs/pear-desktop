type PearDesktopApp = Pick<EventTarget, 'dispatchEvent'>;

type PearDesktopNavigationDetail = {
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

export const playVideo = (app: PearDesktopApp | null, videoId: string) => {
  app?.dispatchEvent(
    new CustomEvent<PearDesktopNavigationDetail>('yt-navigate', {
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
