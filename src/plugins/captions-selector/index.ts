import { createPlugin } from '@/utils';
import { APPLICATION_NAME, t } from '@/i18n';

import backend from './back';
import renderer, {
  type CaptionsSelectorConfig,
  type LanguageOptions,
} from './renderer';

import type { MusicPlayer } from '@/types/music-player';

export default createPlugin<
  unknown,
  unknown,
  {
    captionsSettingsButton?: HTMLElement;
    captionTrackList: LanguageOptions[] | null;
    api: MusicPlayer | null;
    config: CaptionsSelectorConfig | null;
    videoChangeListener: () => void;
  },
  CaptionsSelectorConfig
>({
  name: () => t('plugins.captions-selector.name'),
  description: () =>
    t('plugins.captions-selector.description', {
      applicationName: APPLICATION_NAME,
    }),
  config: {
    enabled: false,
    disableCaptions: false,
    autoload: false,
    lastCaptionsCode: '',
  },

  async menu({ getConfig, setConfig }) {
    const config = await getConfig();
    return [
      {
        label: t('plugins.captions-selector.menu.autoload'),
        type: 'checkbox',
        checked: config.autoload,
        click(item) {
          setConfig({ autoload: item.checked });
        },
      },
      {
        label: t('plugins.captions-selector.menu.disable-captions'),
        type: 'checkbox',
        checked: config.disableCaptions,
        click(item) {
          setConfig({ disableCaptions: item.checked });
        },
      },
    ];
  },

  backend,
  renderer,
});
