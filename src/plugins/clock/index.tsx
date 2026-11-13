import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { config } from '@/plugins/utils/common/config';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.clock.name'),
  description: () => t('plugins.clock.description'),
  restartNeeded: false,
  config: {
    displaySeconds: config.bool(false, {
      label: 'plugins.clock.menu.format.display-seconds',
    }),
    hour12: config.bool(false, {
      label: 'plugins.clock.menu.format.24-hour-format',
      invert: true,
    }),
  },
  stylesheets: [style],
  renderer: (ctx) => {
    const [time, setTime] = createSignal<string>();

    const updateTime = () => {
      const timeFormat: Intl.DateTimeFormatOptions = {
        hour12: ctx.config.hour12,
        hour: 'numeric',
        minute: 'numeric',
        second: ctx.config.displaySeconds ? 'numeric' : undefined,
      };
      setTime(new Date().toLocaleTimeString('en', timeFormat));
    };

    const clockContainer = document.createElement('div');
    const dispose = render(
      () => <h1 class="clock"> {time()} </h1>,
      clockContainer,
    );
    ctx.onCleanup(() => {
      dispose();
      clockContainer.remove();
    });
    document.querySelector('.center-content')?.append(clockContainer);

    ctx.setInterval(updateTime, 1000);
    ctx.onConfigChange(updateTime);
  },
});
