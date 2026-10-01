type PearDesktopApp = Pick<EventTarget, 'dispatchEvent'>;

type PearDesktopWatchTarget = {
  videoId?: string;
  playlistId?: string;
};

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
    watchEndpoint: PearDesktopWatchTarget;
  };
};

const navigateToWatchTarget = (
  app: PearDesktopApp | null,
  watchEndpoint: PearDesktopWatchTarget,
) => {
  const params = new URLSearchParams();
  if (watchEndpoint.videoId) params.set('v', watchEndpoint.videoId);
  if (watchEndpoint.playlistId) params.set('list', watchEndpoint.playlistId);

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
              url: `/watch?${params}`,
              webPageType: 'WEB_PAGE_TYPE_WATCH',
            },
          },
          watchEndpoint,
        },
      },
    }),
  );
};

export const playVideo = (app: PearDesktopApp | null, videoId: string) =>
  navigateToWatchTarget(app, { videoId });

export const playPlaylist = (app: PearDesktopApp | null, playlistId: string) =>
  navigateToWatchTarget(app, { playlistId });
