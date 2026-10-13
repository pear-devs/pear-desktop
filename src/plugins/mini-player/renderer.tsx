import { IconPictureInPictureAlt } from '@mdui/icons/picture-in-picture-alt.js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { LitElementWrapper } from '@/solit';
import { createRenderer } from '@/utils';

import type { MiniPlayerPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

export const renderer = createRenderer({
  buttonContainer: document.createElement('div'),

  start(ctx: RendererContext<MiniPlayerPluginConfig>) {
    if (!this.buttonContainer) {
      this.buttonContainer = document.createElement('div');
    }

    render(
      () => (
        <mdui-tooltip content={t('plugins.mini-player.templates.open.title')}>
          <mdui-button-icon
            onClick={() => ctx.setConfig({ visible: true })}
            style={{ width: '40px', height: '40px' }}
          >
            <LitElementWrapper
              elementClass={IconPictureInPictureAlt}
              props={{
                style: {
                  'padding': '5px',
                  'scale': '1.5',
                  'font-size': '24px',
                },
              }}
            />
          </mdui-button-icon>
        </mdui-tooltip>
      ),
      this.buttonContainer,
    );

    document.querySelector('#right-content')?.prepend(this.buttonContainer);
  },

  stop() {
    this.buttonContainer.remove();
  },
});
