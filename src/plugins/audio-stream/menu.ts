import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import {
  type AudioStreamConfig,
  defaultAudioStreamConfig,
} from './config';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

// Quality and latency presets
const SAMPLE_RATES = [44100, 48000, 96000];
const BIT_DEPTHS = [16, 32];
const CHANNELS = [1, 2];
const BUFFER_SIZES = [1024, 2048, 4096, 8192];

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<AudioStreamConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.audio-stream.menu.port.label'),
      type: 'normal',
      async click() {
        const config = await getConfig();

        const currentPort = config.port || defaultAudioStreamConfig.port;
        const streamUrl = `http://localhost:${currentPort}/stream`;
        
        const newPort =
          (await prompt(
            {
              title: t('plugins.audio-stream.prompt.port.title'),
              label: t('plugins.audio-stream.prompt.port.label', {
                streamUrl,
              }),
              value: config.port,
              type: 'counter',
              counterOptions: { minimum: 1, maximum: 65535 },
              width: 450,
              ...promptOptions(),
            },
            window,
          )) ??
          config.port ??
          defaultAudioStreamConfig.port;

        if (newPort !== config.port) {
          await setConfig({ ...config, port: newPort });
        }
      },
    },
    {
      label: t('plugins.audio-stream.menu.quality-latency.label'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.audio-stream.menu.quality-latency.submenu.sample-rate.label'),
          type: 'submenu',
          submenu: SAMPLE_RATES.map((sampleRate) => ({
            label: `${sampleRate} Hz`,
            type: 'radio' as const,
            checked: config.sampleRate === sampleRate,
            async click() {
              const currentConfig = await getConfig();
              if (currentConfig.sampleRate !== sampleRate) {
                await setConfig({ ...currentConfig, sampleRate });
              }
            },
          })),
        },
        {
          label: t('plugins.audio-stream.menu.quality-latency.submenu.bit-depth.label'),
          type: 'submenu',
          submenu: BIT_DEPTHS.map((bitDepth) => ({
            label: `${bitDepth}-bit`,
            type: 'radio' as const,
            checked: config.bitDepth === bitDepth,
            async click() {
              const currentConfig = await getConfig();
              if (currentConfig.bitDepth !== bitDepth) {
                await setConfig({ ...currentConfig, bitDepth });
              }
            },
          })),
        },
        {
          label: t('plugins.audio-stream.menu.quality-latency.submenu.channels.label'),
          type: 'submenu',
          submenu: CHANNELS.map((channels) => ({
            label: channels === 1 ? t('plugins.audio-stream.menu.quality-latency.submenu.channels.mono') : t('plugins.audio-stream.menu.quality-latency.submenu.channels.stereo'),
            type: 'radio' as const,
            checked: config.channels === channels,
            async click() {
              const currentConfig = await getConfig();
              if (currentConfig.channels !== channels) {
                await setConfig({ ...currentConfig, channels });
              }
            },
          })),
        },
        {
          label: t('plugins.audio-stream.menu.quality-latency.submenu.buffer-size.label'),
          type: 'submenu',
          submenu: BUFFER_SIZES.map((bufferSize) => ({
            label: `${bufferSize} samples`,
            type: 'radio' as const,
            checked: config.bufferSize === bufferSize,
            async click() {
              const currentConfig = await getConfig();
              if (currentConfig.bufferSize !== bufferSize) {
                await setConfig({ ...currentConfig, bufferSize });
              }
            },
          })),
        },
      ],
    },
  ];
};
