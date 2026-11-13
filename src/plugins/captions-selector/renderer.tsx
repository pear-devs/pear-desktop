import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { createRenderer } from '@/utils';

import { CaptionsSettingButton } from './templates/captions-settings-template';

import type {
  CaptionsSelectorIpc,
  captionsSelectorConfig,
  LanguageOptions,
} from './types';
import type { AppElement } from '@/types/queue';

export default createRenderer<
  typeof captionsSelectorConfig,
  CaptionsSelectorIpc
>((ctx) => {
  const [hidden, setHidden] = createSignal(false);
  let captionTrackList: LanguageOptions[] = [];

  ctx.onPlayerApiReady((api) => {
    const toast = (message: string) =>
      document
        .querySelector<AppElement>('ytmusic-app')
        ?.toastService?.show(message);

    const onVideoChange = () => {
      if (ctx.config.disableCaptions) {
        ctx.setTimeout(() => api.unloadModule('captions'), 100);
        setHidden(true);
        return;
      }

      api.loadModule('captions');

      ctx.setTimeout(() => {
        captionTrackList =
          api.getOption<LanguageOptions[]>('captions', 'tracklist') ?? [];

        if (ctx.config.autoload && ctx.config.lastCaptionsCode) {
          api.setOption('captions', 'track', {
            languageCode: ctx.config.lastCaptionsCode,
          });
        }

        setHidden(!captionTrackList.length);
      }, 250);
    };

    const onClick = async () => {
      if (!captionTrackList.length) {
        toast(t('plugins.captions-selector.toast.no-captions'));
        return;
      }

      const currentTrack = api.getOption<LanguageOptions>('captions', 'track');
      const currentIndex = currentTrack
        ? captionTrackList.findIndex(
            (track) => track.languageCode === currentTrack.languageCode,
          )
        : -1;

      const captionLabels = Object.fromEntries(
        [...captionTrackList.map((track) => track.displayName), 'None'].map(
          (label, index) => [String(index), label],
        ),
      );

      const index = await ctx.ipc.invoke(
        'pickCaptions',
        captionLabels,
        String(currentIndex),
      );
      if (index === null) return;

      const newCaptions = captionTrackList[index];
      await ctx.setConfig({
        lastCaptionsCode: newCaptions?.languageCode ?? '',
      });
      if (newCaptions) {
        api.setOption('captions', 'track', {
          languageCode: newCaptions.languageCode,
        });
        toast(
          t('plugins.captions-selector.toast.caption-changed', {
            language: newCaptions.displayName,
          }),
        );
      } else {
        api.setOption('captions', 'track', {});
        toast(t('plugins.captions-selector.toast.caption-disabled'));
      }

      ctx.setTimeout(() => api.playVideo());
    };

    const container = document.createElement('div');
    container.style.display = 'contents';
    document.querySelector('.right-controls-buttons')?.append(container);
    const dispose = render(
      () => (
        <Show when={!hidden()}>
          <CaptionsSettingButton
            label={t('plugins.captions-selector.templates.title')}
            onClick={onClick}
          />
        </Show>
      ),
      container,
    );
    ctx.onCleanup(() => {
      dispose();
      container.remove();
      api.unloadModule('captions');
    });

    captionTrackList =
      api.getOption<LanguageOptions[]>('captions', 'tracklist') ?? [];

    const video = document.querySelector('video');
    if (video) ctx.listen(video, 'peard:src-changed', onVideoChange);
  });

  // Captions settings are read when the video changes; nothing to redo now.
  ctx.onConfigChange(() => {});
});
