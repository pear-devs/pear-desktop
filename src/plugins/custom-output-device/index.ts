import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import renderer from './renderer';
import { customOutputConfig } from './types';

export default createPlugin({
  name: () => t('plugins.custom-output-device.name'),
  description: () => t('plugins.custom-output-device.description'),
  restartNeeded: true,
  config: customOutputConfig,
  menu: (ctx) => [
    {
      label: t('plugins.custom-output-device.menu.device-selector'),
      async click() {
        const response = await prompt(
          {
            title: t(
              'plugins.custom-output-device.prompt.device-selector.title',
            ),
            label: t(
              'plugins.custom-output-device.prompt.device-selector.label',
            ),
            value: ctx.config.output || 'default',
            type: 'select',
            selectOptions: ctx.config.devices,
            width: 500,
            ...promptOptions(),
          },
          ctx.window,
        ).catch(console.error);

        if (!response) return;
        await ctx.setConfig({ output: response });
      },
    },
  ],
  renderer,
});
