import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';

import { createRenderer } from '@/utils';

import { CastButton } from './templates/cast-button';

import type { CastDevice, ChromecastPluginConfig } from './types';

const MOUNT_SELECTOR = '.right-controls-buttons';

export const renderer = createRenderer<
  {
    cleanup?: () => void;
    config?: ChromecastPluginConfig;
    applyMute?: () => void;
  },
  ChromecastPluginConfig
>({
  async onPlayerApiReady(api, context) {
    const { ipc } = context;
    this.config = await context.getConfig();

    const [devices, setDevices] = createSignal<CastDevice[]>([]);
    const [activeId, setActiveId] = createSignal<string | null>(null);
    const [open, setOpen] = createSignal(false);

    // Mute the local <video> while casting so audio only plays on the speaker.
    // Using the element's `muted` flag (not YTM's volume) keeps it from
    // persisting to YTM's stored volume. We capture the user's mute state when
    // casting begins and restore it when casting ends, so we never clobber a
    // pre-existing mute preference.
    let preCastMuted: boolean | null = null;
    const applyLocalMute = () => {
      const video = document.querySelector('video');
      if (!video) return;
      const shouldMute =
        !!activeId() && (this.config?.muteLocalWhenCasting ?? true);
      if (shouldMute) {
        if (preCastMuted === null) preCastMuted = video.muted;
        if (!video.muted) video.muted = true;
      } else if (preCastMuted !== null) {
        // Restore whatever the user had before we started muting.
        video.muted = preCastMuted;
        preCastMuted = null;
      }
    };
    this.applyMute = applyLocalMute;

    // Route the YTM volume slider to the cast device, and re-mute aggressively:
    // YTM fires `volumechange` whenever it (re)sets `muted`/`volume`, so this is
    // the reliable hook to (a) re-mute when YTM un-mutes us and (b) forward the
    // slider value to the speaker.
    const sendCastVolume = () => {
      const video = document.querySelector('video');
      if (video) ipc.invoke('chromecast:set-volume', video.volume);
    };
    const onVolumeChange = () => {
      if (!activeId()) return;
      applyLocalMute();
      sendCastVolume();
    };
    document.addEventListener('volumechange', onVolumeChange, true);

    const refreshState = async () => {
      setDevices((await ipc.invoke('chromecast:get-devices')) as CastDevice[]);
      setActiveId((await ipc.invoke('chromecast:get-active')) as string | null);
      applyLocalMute();
    };

    // Live pushes from the backend keep the list and button state current.
    ipc.on('chromecast:devices-changed', (list: CastDevice[]) =>
      setDevices(list),
    );
    ipc.on('chromecast:state-changed', (id: string | null) => {
      setActiveId(id);
      applyLocalMute();
      if (id) sendCastVolume(); // start the speaker at the slider's volume
    });

    // Backend asks us to align the local (muted) player to the speaker's clock.
    // Safe because local is silent while casting — keeps it from running ahead.
    ipc.on('chromecast:sync-local-time', (seconds: number) => {
      const video = document.querySelector('video');
      if (
        video &&
        activeId() &&
        (this.config?.muteLocalWhenCasting ?? true) &&
        Number.isFinite(seconds) &&
        Math.abs(video.currentTime - seconds) > 1
      ) {
        video.currentTime = seconds;
      }
    });

    // Reflect external play/pause (e.g. the Google Home phone app paused the
    // speaker) onto the local conductor so the two stay in lock-step.
    ipc.on('chromecast:remote-playback', (action: 'play' | 'pause') => {
      if (!activeId()) return;
      if (action === 'pause') api.pauseVideo();
      else api.playVideo();
    });

    // Re-apply mute whenever a track (re)starts — YTM resets the video element.
    const onPlay = () => applyLocalMute();
    document.addEventListener('play', onPlay, true);

    // Detect ads on the local player and tell the backend so it can suppress
    // mirroring (the speaker keeps the real song). The adblocker plugin should
    // normally prevent ads entirely; this is a safety net.
    let adShowing = false;
    const checkAdState = () => {
      const player = document.querySelector('#movie_player');
      const showing =
        !!player &&
        (player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting'));
      if (showing !== adShowing) {
        adShowing = showing;
        ipc.invoke('chromecast:ad-state', showing);
      }
    };
    const moviePlayer = document.querySelector('#movie_player');
    const adObserver = new MutationObserver(checkAdState);
    if (moviePlayer) {
      adObserver.observe(moviePlayer, {
        attributes: true,
        attributeFilter: ['class'],
      });
      checkAdState(); // sync initial state (an ad may already be showing)
    }

    const onToggle = () => {
      const next = !open();
      setOpen(next);
      if (next) {
        ipc.invoke('chromecast:refresh');
        refreshState().catch(console.error);
      }
    };

    const onPick = (id: string) => {
      const action =
        id === activeId() ? 'chromecast:disconnect' : 'chromecast:connect';
      Promise.resolve(ipc.invoke(action, id))
        .then(() => refreshState())
        .catch(console.error);
      setOpen(false);
    };

    const container = document.createElement('div');
    container.style.display = 'flex';

    // YTM re-renders its player-bar controls, which wipes a one-shot mount.
    // Re-attach the button whenever it goes missing.
    const ensureMounted = () => {
      const mount = document.querySelector(MOUNT_SELECTOR);
      if (mount && !mount.contains(container)) mount.prepend(container);
    };
    ensureMounted();

    const playerBar =
      document.querySelector('ytmusic-player-bar') ?? document.body;
    const observer = new MutationObserver(() => ensureMounted());
    observer.observe(playerBar, { childList: true, subtree: true });

    // Close the dropdown when clicking elsewhere.
    const onDocClick = (event: MouseEvent) => {
      if (open() && !container.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);

    const dispose = render(
      () => (
        <CastButton
          activeId={activeId()}
          casting={!!activeId()}
          devices={devices()}
          onPick={onPick}
          onToggle={onToggle}
          open={open()}
        />
      ),
      container,
    );

    // eslint-disable-next-line solid/reactivity -- teardown handler, not reactive
    this.cleanup = () => {
      observer.disconnect();
      adObserver.disconnect();
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('play', onPlay, true);
      document.removeEventListener('volumechange', onVolumeChange, true);
      ipc.removeAllListeners('chromecast:devices-changed');
      ipc.removeAllListeners('chromecast:state-changed');
      ipc.removeAllListeners('chromecast:sync-local-time');
      ipc.removeAllListeners('chromecast:remote-playback');
      const video = document.querySelector('video');
      // Restore the user's pre-cast mute state (only if we changed it).
      if (video && preCastMuted !== null) video.muted = preCastMuted;
      dispose();
      container.remove();
    };

    refreshState().catch(console.error);
  },

  onConfigChange(newConfig) {
    this.config = newConfig;
    this.applyMute?.();
  },

  stop() {
    this.cleanup?.();
    this.cleanup = undefined;
  },
});
