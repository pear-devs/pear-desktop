import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';

import { getPlayerApi, listenToPlayerVideo } from '@/providers/player';
import { createRenderer } from '@/utils';
import { t } from '@/i18n';

import { CaptionsSettingButton } from './templates/captions-settings-template';

import type { MusicPlayer } from '@/types/music-player';
import type { AppElement } from '@/types/queue';

export interface LanguageOptions {
  displayName: string;
  id: string | null;
  is_default: boolean;
  is_servable: boolean;
  is_translateable: boolean;
  kind: string;
  languageCode: string; // 2 length
  languageName: string;
  name: string | null;
  vss_id: string;
}

export interface CaptionsSelectorConfig {
  enabled: boolean;
  disableCaptions: boolean;
  autoload: boolean;
  lastCaptionsCode: string;
}

const [hidden, setHidden] = createSignal(false);

export default createRenderer<
  {
    captionsSettingsButton?: HTMLElement;
    captionTrackList: LanguageOptions[] | null;
    removeSourceListener?: () => void;
    config: CaptionsSelectorConfig | null;
    videoChangeListener: () => void;
  },
  CaptionsSelectorConfig
>({
  captionTrackList: null,
  config: null,
  videoChangeListener() {
    const api = getPlayerApi();
    if (!api) return;
    if (this.config?.disableCaptions) {
      setTimeout(() => {
        if (api === getPlayerApi()) api.unloadModule('captions');
      }, 100);
      setHidden(true);
      return;
    }

    api.loadModule('captions');

    setTimeout(() => {
      if (api !== getPlayerApi()) return;
      this.captionTrackList = api.getOption('captions', 'tracklist') ?? [];

      if (this.config?.autoload && this.config.lastCaptionsCode) {
        api.setOption('captions', 'track', {
          languageCode: this.config.lastCaptionsCode,
        });
      }

      setHidden(!this.captionTrackList?.length);
    }, 250);
  },
  async start({ getConfig }) {
    this.config = await getConfig();
  },
  stop() {
    getPlayerApi()?.unloadModule('captions');
    this.removeSourceListener?.();
    this.removeSourceListener = undefined;
    if (this.captionsSettingsButton) {
      document
        .querySelector('.right-controls-buttons')
        ?.removeChild(this.captionsSettingsButton);
    }
  },
  onPlayerApiReady(_playerApi: MusicPlayer, { ipc, setConfig }) {
    render(
      () => (
        <Show when={!hidden()}>
          <CaptionsSettingButton
            label={t('plugins.captions-selector.templates.title')}
            onClick={async () => {
              const appApi = document.querySelector<AppElement>('ytmusic-app');

              if (this.captionTrackList?.length) {
                const api = getPlayerApi();
                if (!api) return;
                const currentCaptionTrack = api.getOption<LanguageOptions>(
                  'captions',
                  'track',
                );

                let currentIndex = currentCaptionTrack
                  ? this.captionTrackList.indexOf(
                      this.captionTrackList.find(
                        (track) =>
                          track.languageCode ===
                          currentCaptionTrack.languageCode,
                      )!,
                    )
                  : null;

                const captionLabels = [
                  ...this.captionTrackList.map((track) => track.displayName),
                  'None',
                ];

                currentIndex = (await ipc.invoke(
                  'peard:captions-selector',
                  captionLabels,
                  currentIndex,
                )) as number;
                if (currentIndex === null || api !== getPlayerApi()) {
                  return;
                }

                const newCaptions = this.captionTrackList[currentIndex];
                setConfig({ lastCaptionsCode: newCaptions?.languageCode });
                if (newCaptions) {
                  api.setOption('captions', 'track', {
                    languageCode: newCaptions.languageCode,
                  });
                  appApi?.toastService?.show(
                    t('plugins.captions-selector.toast.caption-changed', {
                      language: newCaptions.displayName,
                    }),
                  );
                } else {
                  api.setOption('captions', 'track', {});
                  appApi?.toastService?.show(
                    t('plugins.captions-selector.toast.caption-disabled'),
                  );
                }

                setTimeout(() => {
                  if (api === getPlayerApi()) api.playVideo();
                });
              } else {
                appApi?.toastService?.show(
                  t('plugins.captions-selector.toast.no-captions'),
                );
              }
            }}
            ref={this.captionsSettingsButton}
          />
        </Show>
      ),
      document.querySelector('.right-controls-buttons')!,
    );

    this.captionTrackList =
      getPlayerApi()?.getOption<LanguageOptions[]>('captions', 'tracklist') ??
      [];

    this.removeSourceListener = listenToPlayerVideo('peard:src-changed', () => {
      this.videoChangeListener();
    });
  },
  onConfigChange(newConfig) {
    this.config = newConfig;
  },
});
