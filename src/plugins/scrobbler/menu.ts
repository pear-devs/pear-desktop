import prompt from 'custom-electron-prompt';
import { type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { ScrobblerPluginConfig, SetConfType } from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

async function promptLastFmOptions(
  options: Readonly<ScrobblerPluginConfig>,
  setConfig: SetConfType,
  window: BrowserWindow,
) {
  const output = await prompt(
    {
      title: t('plugins.scrobbler.menu.lastfm.api-settings'),
      label: t('plugins.scrobbler.menu.lastfm.api-settings'),
      type: 'multiInput',
      multiInputOptions: [
        {
          label: t('plugins.scrobbler.prompt.lastfm.api-key'),
          value: options.scrobblers.lastfm?.apiKey,
          inputAttrs: {
            type: 'text',
          },
        },
        {
          label: t('plugins.scrobbler.prompt.lastfm.api-secret'),
          value: options.scrobblers.lastfm?.secret,
          inputAttrs: {
            type: 'text',
          },
        },
      ],
      resizable: true,
      height: 360,
      ...promptOptions(),
    },
    window,
  );

  if (output) {
    const lastfm: { apiKey?: string; secret?: string } = {};
    if (output[0]) {
      lastfm.apiKey = output[0];
    }

    if (output[1]) {
      lastfm.secret = output[1];
    }

    await setConfig({ scrobblers: { lastfm } });
  }
}

async function promptListenbrainzOptions(
  options: Readonly<ScrobblerPluginConfig>,
  setConfig: SetConfType,
  window: BrowserWindow,
) {
  const output = await prompt(
    {
      title: t('plugins.scrobbler.prompt.listenbrainz.token.title'),
      label: t('plugins.scrobbler.prompt.listenbrainz.token.label'),
      type: 'input',
      value: options.scrobblers.listenbrainz?.token,
      ...promptOptions(),
    },
    window,
  );

  if (output) {
    await setConfig({ scrobblers: { listenbrainz: { token: output } } });
  }
}

export const onMenu = (
  ctx: MenuContext<ScrobblerPluginConfig>,
): MenuTemplate => {
  const { window, config } = ctx;
  const setConfig: SetConfType = (patch) => ctx.setConfig(patch);
  return [
    {
      label: 'Last.fm',
      submenu: [
        {
          label: t('main.menu.plugins.enabled'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.lastfm.enabled),
          click(item) {
            setConfig({ scrobblers: { lastfm: { enabled: item.checked } } });
          },
        },
        {
          label: t('plugins.scrobbler.menu.lastfm.api-settings'),
          click() {
            promptLastFmOptions(config, setConfig, window);
          },
        },
      ],
    },
    {
      label: 'ListenBrainz',
      submenu: [
        {
          label: t('main.menu.plugins.enabled'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.listenbrainz.enabled),
          click(item) {
            setConfig({
              scrobblers: { listenbrainz: { enabled: item.checked } },
            });
          },
        },
        {
          label: t('plugins.scrobbler.menu.listenbrainz.token'),
          click() {
            promptListenbrainzOptions(config, setConfig, window);
          },
        },
      ],
    },
  ];
};
