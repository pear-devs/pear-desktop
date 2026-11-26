import '@total-typescript/ts-reset';

import type * as config from './config';
import type { t } from '@/i18n';
import type { VideoDataChanged } from '@/types/video-data-changed';
import type { ipcRenderer as electronIpcRenderer } from 'electron';
import type is from 'electron-is';
import type { trustedTypes } from 'trusted-types';

declare global {
  interface Compressor {
    /** Shared audio bus: tap it to process what the player outputs. */
    audioSource: AudioNode;
    audioContext: AudioContext;
    /** Gain on the original <video> audio before the bus (1 = audible). */
    mixGate: GainNode;
  }

  interface DocumentEventMap {
    'peard:audio-can-play': CustomEvent<Compressor>;
    'videodatachange': CustomEvent<VideoDataChanged>;
  }

  interface Window {
    trustedTypes?: typeof trustedTypes;
    ipcRenderer: typeof electronIpcRenderer;
    mainConfig: typeof config;
    electronIs: typeof is;
    ELECTRON_RENDERER_URL: string | undefined;
    /**
     * Internal variable (Last interaction time)
     */
    _lact: number;
    navigation: Navigation;
    download: () => void;
    togglePictureInPicture: () => void;
    reload: () => void;
    i18n: {
      t: typeof t;
    };
  }
}

// import { Howl as _Howl } from 'howler';
declare module 'howler' {
  interface Howl {
    _sounds: {
      _paused: boolean;
      _ended: boolean;
      _id: string;
      _node: HTMLMediaElement;
    }[];
  }
}
