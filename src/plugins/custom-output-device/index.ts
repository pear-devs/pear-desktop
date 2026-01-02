import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';
import { renderer } from './renderer';

export interface CustomOutputPluginConfig {
  enabled: boolean;
  output: string;
  devices: Record<string, string>;
}

export default createPlugin({
  name: () => t('plugins.custom-output-device.name'),
  description: () => t('plugins.custom-output-device.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    output: 'default',
    devices: {},
  } as CustomOutputPluginConfig,
  menu: ({ setConfig, getConfig, window }) => {
    const promptDeviceSelector = async () => {
      const options = await getConfig();

      const response = await prompt(
        {
          title: t('plugins.custom-output-device.prompt.device-selector.title'),
          label: t('plugins.custom-output-device.prompt.device-selector.label'),
          value: options.output || 'default',
          type: 'select',
          selectOptions: options.devices,
          width: 500,
          ...promptOptions(),
        },
        window,
      ).catch(console.error);

      if (!response) return;
      options.output = response;
      setConfig(options);
    };

    return [
      {
        label: t('plugins.custom-output-device.menu.device-selector'),
        click: promptDeviceSelector,
      },
    ];
  },

  renderer,
});
