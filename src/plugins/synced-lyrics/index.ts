import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { renderer } from './renderer';
import style from './style.css?inline';

import type { SyncedLyricsPluginConfig } from './types';

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  SyncedLyricsPluginConfig
>({
  name: () => t('plugins.synced-lyrics.name'),
  description: () => t('plugins.synced-lyrics.description'),
  authors: ['Non0reo', 'ArjixWasTaken', 'KimJammer', 'Strvm'],
  restartNeeded: true,
  addedVersion: '3.5.X',
  config: {
    enabled: false,
    preciseTiming: true,
    showLyricsEvenIfInexact: true,
    showTimeCodes: false,
    defaultTextString: '♪',
    lineEffect: 'fancy',
    romanization: true,
  },

  settings: [
    {
      type: 'switch',
      key: 'preciseTiming',
      label: () => t('plugins.synced-lyrics.settings.precise-timing'),
    },
    {
      type: 'switch',
      key: 'showLyricsEvenIfInexact',
      label: () => t('plugins.synced-lyrics.settings.show-inexact'),
    },
    {
      type: 'switch',
      key: 'showTimeCodes',
      label: () => t('plugins.synced-lyrics.settings.show-time-codes'),
    },
    {
      type: 'switch',
      key: 'romanization',
      label: () => t('plugins.synced-lyrics.settings.romanization'),
    },
    {
      type: 'select',
      key: 'lineEffect',
      label: () => t('plugins.synced-lyrics.settings.line-effect'),
      options: [
        { value: 'fancy', label: () => t('plugins.synced-lyrics.settings.effect.fancy') },
        { value: 'scale', label: () => t('plugins.synced-lyrics.settings.effect.scale') },
        { value: 'offset', label: () => t('plugins.synced-lyrics.settings.effect.offset') },
        { value: 'focus', label: () => t('plugins.synced-lyrics.settings.effect.focus') },
      ],
    },
  ],

  menu,
  renderer,
  backend,
  stylesheets: [style],
});
