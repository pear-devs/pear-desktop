export const isMusicOrVideoTrack = () => {
  for (const menuSelector of document.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        watchEndpoint: {
          videoId: string;
        };
        addToPlaylistEndpoint: {
          videoId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint')) {
    if (
      menuSelector?.data?.addToPlaylistEndpoint?.videoId ||
      menuSelector?.data?.watchEndpoint?.videoId
    ) {
      return true;
    }
  }
  return false;
};

export const isAlbumOrPlaylist = () => {
  for (const menuSelector of document.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        addToPlaylistEndpoint: {
          playlistId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint')) {
    if (menuSelector?.data?.addToPlaylistEndpoint?.playlistId) {
      return true;
    }
  }
  return false;
};

export const isPlayerMenu = (menu?: HTMLElement | null) => {
  return (
    menu?.parentElement as
      | (HTMLElement & {
          ytEventForwardingBehavior: {
            forwarder_: {
              eventSink: HTMLElement;
            };
          };
        })
      | null
  )?.ytEventForwardingBehavior?.forwarder_?.eventSink?.matches(
    'ytmusic-menu-renderer.ytmusic-player-bar',
  );
};
