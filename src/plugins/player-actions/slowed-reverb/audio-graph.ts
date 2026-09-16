export interface AudioCanPlayDetail {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
}

/**
 * The app announces its shared audio graph ("peard:audio-can-play") once the
 * player API is ready and again on every video load. A plugin only receives
 * those announcements while it is loaded, so enabling this plugin mid-song
 * would miss them and never wire reverb. Remember the latest announcement at
 * module scope so start() can adopt the graph immediately.
 *
 * Renderer-only module: index.ts references it exclusively from the renderer
 * context, which is stripped from main/preload builds, so this side effect is
 * tree-shaken there.
 */
let latestAudioDetail: AudioCanPlayDetail | null = null;

document.addEventListener(
  'peard:audio-can-play',
  (event) => {
    const detail = (event as CustomEvent<AudioCanPlayDetail>).detail;
    if (detail?.audioContext && detail?.audioSource) {
      latestAudioDetail = detail;
    }
  },
  { passive: true },
);

export function getLatestAudioDetail(): AudioCanPlayDetail | null {
  return latestAudioDetail;
}
