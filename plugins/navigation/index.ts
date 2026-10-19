import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { LitElementWrapper } from '@/solit';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.navigation.name'),
  description: () => t('plugins.navigation.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    buttonContainer: document.createElement('div'),
    start() {
      if (!this.buttonContainer) {
        this.buttonContainer = document.createElement('div');
      }

      render(
        () => (
          <>
            <mdui-tooltip
              content={t('plugins.navigation.templates.back.title')}
            >
              <mdui-button-icon
                onClick={() => history.back()}
                style={{ width: '40px', height: '40px' }}
              >
                <LitElementWrapper
                  elementClass={IconChevronLeft}
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
            <mdui-tooltip
              content={t('plugins.navigation.templates.forward.title')}
            >
              <mdui-button-icon
                onClick={() => history.forward()}
                style={{ width: '40px', height: '40px' }}
              >
                <LitElementWrapper
                  elementClass={IconChevronRight}
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
          </>
        ),
        this.buttonContainer,
      );
      const menu = document.querySelector('#right-content');
      menu?.prepend(this.buttonContainer);
    },
    stop() {
      this.buttonContainer.remove();
    },
  },
});
