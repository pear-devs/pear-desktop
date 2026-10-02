import { createRenderer } from '@/utils';

function getCanonicalVideoId(queueItem: any): string | undefined {
    const menu = queueItem?.getMenuRenderer?.();

    for (const item of menu?.items ?? []) {
        const videoId =
            item?.toggleMenuServiceItemRenderer
                ?.defaultServiceEndpoint
                ?.likeEndpoint
                ?.target
                ?.videoId;

        if (videoId) {
            return videoId;
        }
    }

    return undefined;
}

export const renderer = createRenderer<{
    player?: any;
    lastVideoId?: string;
    stateChangeHandler?: () => void;
}>({
    start() {
        console.log('[Audio only mode] Renderer started');
    },

    onPlayerApiReady(api) {
        const player = api as any;
        this.player = player;

        const checkCurrentTrack = () => {
            const response = player.getPlayerResponse?.();
            const details = response?.videoDetails;

            if (!details?.videoId) return;

            const {
                videoId,
                title,
                author,
                musicVideoType,
            } = details;

            // Evita procesar varias veces el mismo video por los
            // múltiples onStateChange que dispara el reproductor.
            if (videoId === this.lastVideoId) return;
            this.lastVideoId = videoId;

            console.log('[Audio only mode] Track:', {
                videoId,
                title,
                author,
                musicVideoType,
            });
            /*
      
            // Ya estamos reproduciendo el audio del catálogo.
            if (musicVideoType === 'MUSIC_VIDEO_TYPE_ATV') {
              return;
            }
      
            // Por ahora sólo reemplazamos OMV confirmados.
            if (musicVideoType !== 'MUSIC_VIDEO_TYPE_OMV') {
              console.log(
                '[Audio only mode] Unknown musicVideoType:',
                musicVideoType,
              );
              return;
            }*/
            switch (musicVideoType) {
                case 'MUSIC_VIDEO_TYPE_ATV':
                    // Already playing catalog audio.
                    return;

                case 'MUSIC_VIDEO_TYPE_OMV':
                    // Try to replace with canonical audio.
                    break;

                case 'MUSIC_VIDEO_TYPE_UGC':
                    console.log(
                        '[Audio only mode] UGC track detected. Keeping original.',
                    );
                    return;

                default:
                    console.log(
                        '[Audio only mode] Unsupported musicVideoType. Keeping original:',
                        musicVideoType,
                    );
                    return;
            }
            const queueItem = document.querySelector(
                'ytmusic-player-queue-item[selected]',
            );

            if (!queueItem) {
                console.warn(
                    '[Audio only mode] Could not find selected queue item.',
                );
                return;
            }

            const canonicalVideoId = getCanonicalVideoId(queueItem);

            if (!canonicalVideoId) {
                console.warn(
                    '[Audio only mode] Could not find canonical audio videoId.',
                );
                return;
            }

            if (canonicalVideoId === videoId) {
                console.log(
                    '[Audio only mode] Canonical videoId is the current video.',
                );
                return;
            }

            const currentTime = player.getCurrentTime?.() ?? 0;

            console.log('[Audio only mode] Replacing music video:', {
                from: videoId,
                to: canonicalVideoId,
                startSeconds: currentTime,
            });

            player.loadVideoById({
                videoId: canonicalVideoId,
                startSeconds: currentTime,
            });
        };

        this.stateChangeHandler = checkCurrentTrack;

        player.addEventListener(
            'onStateChange',
            this.stateChangeHandler,
        );

        checkCurrentTrack();
    },

    stop() {
        if (this.player && this.stateChangeHandler) {
            this.player.removeEventListener(
                'onStateChange',
                this.stateChangeHandler,
            );
        }

        this.player = undefined;
        this.stateChangeHandler = undefined;
        this.lastVideoId = undefined;

        console.log('[Audio only mode] Renderer stopped');
    },
});