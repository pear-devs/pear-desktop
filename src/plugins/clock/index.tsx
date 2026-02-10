import { render } from 'solid-js/web';
import { createSignal, onMount } from 'solid-js';

import style from './style.css?inline';

import { createPlugin } from '@/utils';
import { type MenuTemplate } from '@/menu';
import { t } from '@/i18n';
import { type ClockPluginConfig } from './types';

const defaultConfig: ClockPluginConfig = {
  enabled: false,
  displaySeconds: false,
  hour12: false,
};

export default createPlugin({
  name: () => t('plugins.clock.name'),
  description: () => t('plugins.clock.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [style],
  menu: async ({ getConfig, setConfig }): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.clock.menu.format.label'),
        submenu: [
          {
            label: t('plugins.clock.menu.format.display-seconds'),
            type: 'checkbox',
            checked: config.displaySeconds,
            click(item) {
              setConfig({ displaySeconds: item.checked });
            },
          },
          {
            label: t('plugins.clock.menu.format.24-hour-format'),
            type: 'checkbox',
            checked: !config.hour12,
            click(item) {
              setConfig({ hour12: !item.checked });
            },
          },
        ],
      },
    ];
  },
  renderer: {
    displaySeconds: defaultConfig.displaySeconds,
    hour12: defaultConfig.hour12,

    interval: null as NodeJS.Timeout | null,
    clockContainer: document.createElement('div'),
    updateTime: null as unknown as () => void,

    async start({ getConfig }) {
      const config = await getConfig();
      this.displaySeconds = config.displaySeconds;
      this.hour12 = config.hour12;

      if (!this.clockContainer) {
        this.clockContainer = document.createElement('div');
      }

      const [time, setTime] = createSignal<string>();

      const updateTime = () => {
        const timeFormat: Intl.DateTimeFormatOptions = {
          hour12: this.hour12,
          hour: 'numeric',
          minute: 'numeric',
          second: this.displaySeconds ? 'numeric' : undefined,
        };
        const now = new Date();
        setTime(now.toLocaleTimeString('en', timeFormat));
      };
      this.updateTime = updateTime;

      onMount(() => {
        this.interval = setInterval(updateTime, 1000);
      });

      render(
        () => (
          <>
            <h1 class="clock"> {time()} </h1>
          </>
        ),
        this.clockContainer,
      );
      const menu = document.querySelector('.center-content');
      menu?.append(this.clockContainer);
    },
    onConfigChange(newConfig) {
      this.displaySeconds = newConfig.displaySeconds;
      this.hour12 = newConfig.hour12;
      this.updateTime();
    },
    stop() {
      this.clockContainer.remove();
      this.clockContainer.replaceChildren();
      if (this.interval) {
        clearInterval(this.interval);
      }
    },
  },
});
