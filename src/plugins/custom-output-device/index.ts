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
    // The saved device list only ever grows (config writes merge), so it holds
    // every ID a device has had, several per name. Picking a stale one did
    // nothing, so list the devices the page sees right now instead.
    const getCurrentDevices = async () => {
      try {
        const devices = (await window.webContents.executeJavaScript(
          `navigator.mediaDevices.enumerateDevices().then((devices) =>
            devices
              .filter((device) => device.kind === 'audiooutput')
              .map((device) => [device.deviceId, device.label]))`,
        )) as [string, string][];
        if (devices.length > 0 && devices.every(([, label]) => label)) {
          return Object.fromEntries(devices);
        }
      } catch (error) {
        console.error(error);
      }
      return undefined;
    };

    const promptDeviceSelector = async () => {
      const options = await getConfig();
      const devices = (await getCurrentDevices()) ?? options.devices;

      // Show the saved device as selected even if its ID changed since.
      let value = options.output || 'default';
      if (!(value in devices)) {
        const savedLabel = options.devices[value];
        value =
          Object.entries(devices).find(
            ([id, label]) =>
              label === savedLabel &&
              id !== 'default' &&
              id !== 'communications',
          )?.[0] ?? 'default';
      }

      const response = await prompt(
        {
          title: t('plugins.custom-output-device.prompt.device-selector.title'),
          label: t('plugins.custom-output-device.prompt.device-selector.label'),
          value,
          type: 'select',
          selectOptions: devices,
          width: 500,
          ...promptOptions(),
        },
        window,
      ).catch(console.error);

      if (!response) return;
      // Save the label with the ID so the renderer can find the device by
      // name if Windows gives it a new ID later.
      await setConfig({ output: response, devices });
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
