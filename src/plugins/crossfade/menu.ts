import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { crossfadeConfig } from './types';
import type { ConfigOf } from '@/plugins/utils/common/config';
import type { MenuContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

type CrossfadePluginConfig = ConfigOf<typeof crossfadeConfig>;

const promptCrossfadeValues = async (
  win: BrowserWindow,
  options: Readonly<CrossfadePluginConfig>,
): Promise<CrossfadePluginConfig | undefined> => {
  const res = await prompt(
    {
      title: t('plugins.crossfade.prompt.options'),
      type: 'multiInput',
      multiInputOptions: [
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-in-duration',
          ),
          value: options.fadeInDuration,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
            step: '100',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-out-duration',
          ),
          value: options.fadeOutDuration,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
            step: '100',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.seconds-before-end',
          ),
          value: options.secondsBeforeEnd,
          inputAttrs: {
            type: 'number',
            required: true,
            min: '0',
          },
        },
        {
          label: t(
            'plugins.crossfade.prompt.options.multi-input.fade-scaling.label',
          ),
          selectOptions: {
            linear: t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.linear',
            ),
            logarithmic: t(
              'plugins.crossfade.prompt.options.multi-input.fade-scaling.logarithmic',
            ),
          },
          value: options.fadeScaling,
        },
      ],
      resizable: true,
      height: 360,
      ...promptOptions(),
    },
    win,
  ).catch(console.error);

  if (!res) {
    return undefined;
  }

  let fadeScaling: 'linear' | 'logarithmic' | number;
  if (res[3] === 'linear' || res[3] === 'logarithmic') {
    fadeScaling = res[3];
  } else if (isFinite(Number(res[3]))) {
    fadeScaling = Number(res[3]);
  } else {
    fadeScaling = options.fadeScaling;
  }

  return {
    fadeInDuration: Number(res[0]),
    fadeOutDuration: Number(res[1]),
    secondsBeforeEnd: Number(res[2]),
    fadeScaling,
  };
};

export const menu = (ctx: MenuContext<CrossfadePluginConfig>) => [
  {
    label: t('plugins.crossfade.menu.advanced'),
    async click() {
      const newOptions = await promptCrossfadeValues(ctx.window, ctx.config);
      if (newOptions) {
        await ctx.setConfig(newOptions);
      }
    },
  },
];
