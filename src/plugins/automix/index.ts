import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultConfig, type AutoMixPluginConfig } from './config';
import { renderer } from './renderer';
import style from './style.css?inline';

import type { TransitionPreference } from './planner';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

export type { AutoMixPluginConfig } from './config';

const radio = <T>(
  label: string,
  current: T,
  choices: [T, string][],
  apply: (value: T) => void,
): MenuItemConstructorOptions => ({
  label,
  type: 'submenu',
  submenu: choices.map(([value, choiceLabel]) => ({
    label: choiceLabel,
    type: 'radio',
    checked: current === value,
    click: () => apply(value),
  })),
});

export default createPlugin({
  name: () => t('plugins.automix.name'),
  description: () => t('plugins.automix.description'),
  restartNeeded: false,
  addedVersion: '3.12.X',
  config: defaultConfig,
  stylesheets: [style],

  async menu({
    getConfig,
    setConfig,
  }: MenuContext<AutoMixPluginConfig>): Promise<MenuItemConstructorOptions[]> {
    const config = await getConfig();

    return [
      {
        label: t('plugins.automix.menu.active'),
        type: 'checkbox',
        checked: config.active,
        click: (item) => setConfig({ active: item.checked }),
      },
      radio<TransitionPreference>(
        t('plugins.automix.menu.transition.label'),
        config.transition,
        [
          ['auto', t('plugins.automix.menu.transition.auto')],
          ['segue', t('plugins.automix.style.segue')],
          ['blend', t('plugins.automix.style.blend')],
          ['cut', t('plugins.automix.style.cut')],
          ['smooth', t('plugins.automix.style.smooth')],
        ],
        (transition) => setConfig({ transition }),
      ),
      {
        label: t('plugins.automix.menu.beat-only'),
        type: 'checkbox',
        checked: config.beatOnly,
        click: (item) => setConfig({ beatOnly: item.checked }),
      },
      {
        label: t('plugins.automix.menu.cut-echo'),
        type: 'checkbox',
        checked: config.cutEcho,
        click: (item) => setConfig({ cutEcho: item.checked }),
      },
      {
        label: t('plugins.automix.menu.effects'),
        type: 'checkbox',
        checked: config.effects,
        click: (item) => setConfig({ effects: item.checked }),
      },
      {
        label: t('plugins.automix.menu.spotify-style'),
        type: 'checkbox',
        checked: config.spotifyStyle,
        click: (item) => setConfig({ spotifyStyle: item.checked }),
      },
      radio(
        t('plugins.automix.menu.blend-length'),
        config.blendBeats,
        [8, 16, 32].map((beats) => [
          beats,
          t('plugins.automix.menu.beats', { beats }),
        ]),
        (blendBeats) => setConfig({ blendBeats }),
      ),
      radio(
        t('plugins.automix.menu.tempo-range.label'),
        config.maxStretch,
        [
          [0, t('plugins.automix.menu.tempo-range.off')],
          ...[0.03, 0.05, 0.08].map(
            (range) =>
              [
                range,
                t('plugins.automix.menu.tempo-range.value', {
                  percent: Math.round(range * 100),
                }),
              ] as [number, string],
          ),
        ],
        (maxStretch) => setConfig({ maxStretch }),
      ),
      radio(
        t('plugins.automix.menu.fade-length'),
        config.smoothSeconds,
        [6, 10, 15].map((seconds) => [
          seconds,
          t('plugins.automix.menu.seconds', { seconds }),
        ]),
        (smoothSeconds) => setConfig({ smoothSeconds }),
      ),
      {
        label: t('plugins.automix.menu.respect-albums'),
        type: 'checkbox',
        checked: config.respectAlbums,
        click: (item) => setConfig({ respectAlbums: item.checked }),
      },
      radio<AutoMixPluginConfig['reorderShape']>(
        t('plugins.automix.menu.reorder-shape.label'),
        config.reorderShape,
        [
          ['smooth', t('plugins.automix.menu.reorder-shape.smooth')],
          ['build', t('plugins.automix.menu.reorder-shape.build')],
          ['steady', t('plugins.automix.menu.reorder-shape.steady')],
        ],
        (reorderShape) => setConfig({ reorderShape }),
      ),
      {
        label: t('plugins.automix.menu.apple-analysis'),
        type: 'checkbox',
        checked: config.appleAnalysis,
        click: (item) => setConfig({ appleAnalysis: item.checked }),
      },
      {
        label: t('plugins.automix.menu.show-mix-card'),
        type: 'checkbox',
        checked: config.showMixCard,
        click: (item) => setConfig({ showMixCard: item.checked }),
      },
      {
        label: t('plugins.automix.menu.artwork-fade'),
        type: 'checkbox',
        checked: config.artworkFade,
        click: (item) => setConfig({ artworkFade: item.checked }),
      },
    ];
  },

  backend,
  renderer,
});
