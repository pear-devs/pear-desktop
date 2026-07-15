import prompt from 'custom-electron-prompt';
import { type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { type ScrobblerPluginConfig } from './index';
import { type SetConfType, backend } from './main';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

async function promptLastFmOptions(
  options: ScrobblerPluginConfig,
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
    if (output[0]) {
      options.scrobblers.lastfm.apiKey = output[0];
    }

    if (output[1]) {
      options.scrobblers.lastfm.secret = output[1];
    }

    setConfig(options);
  }
}

async function promptListenbrainzOptions(
  options: ScrobblerPluginConfig,
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
    options.scrobblers.listenbrainz.token = output;
    setConfig(options);
  }
}

async function promptCustomRegex(
  options: ScrobblerPluginConfig,
  setConfig: SetConfType,
  window: BrowserWindow,
) {
  const output = await prompt(
    {
      title: t('plugins.scrobbler.prompt.custom-regex.title'),
      label: t('plugins.scrobbler.prompt.custom-regex.label'),
      type: 'input',
      value: options.customRegex,
      ...promptOptions(),
    },
    window,
  );

  if (output !== null) {
    options.customRegex = output;
    setConfig(options);
  }
}

async function promptTimingOptions(
  scrobbler: 'lastfm' | 'listenbrainz',
  options: ScrobblerPluginConfig,
  setConfig: SetConfType,
  window: BrowserWindow,
) {
  const target = options.scrobblers[scrobbler];
  const output = await prompt(
    {
      title: t('plugins.scrobbler.prompt.timing.title'),
      label: t('plugins.scrobbler.prompt.timing.title'),
      type: 'multiInput',
      multiInputOptions: [
        {
          label: t('plugins.scrobbler.prompt.timing.min-duration'),
          value: String(target.minSongDuration),
          inputAttrs: { type: 'number', min: '0' },
        },
        {
          label: t('plugins.scrobbler.prompt.timing.delay-percent'),
          value: String(target.delayPercent),
          inputAttrs: { type: 'number', min: '0', max: '100' },
        },
        {
          label: t('plugins.scrobbler.prompt.timing.delay-seconds'),
          value: String(target.delaySeconds),
          inputAttrs: { type: 'number', min: '0' },
        },
      ],
      resizable: true,
      height: 360,
      ...promptOptions(),
    },
    window,
  );

  if (output) {
    if (output[0]) target.minSongDuration = Number(output[0]);
    if (output[1]) target.delayPercent = Number(output[1]);
    if (output[2]) target.delaySeconds = Number(output[2]);
    setConfig(options);
  }
}

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<ScrobblerPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.scrobbler.menu.scrobble-other-media'),
      type: 'checkbox',
      checked: Boolean(config.scrobbleOtherMedia),
      click(item) {
        config.scrobbleOtherMedia = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.scrobble-alternative-title'),
      type: 'checkbox',
      checked: Boolean(config.alternativeTitles),
      click(item) {
        config.alternativeTitles = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.scrobble-alternative-artist'),
      type: 'checkbox',
      checked: Boolean(config.alternativeArtist),
      click(item) {
        config.alternativeArtist = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.metadata-cleanup'),
      type: 'checkbox',
      checked: Boolean(config.metadataCleanup),
      click(item) {
        config.metadataCleanup = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.parse-title'),
      type: 'checkbox',
      checked: Boolean(config.parseTitle),
      click(item) {
        config.parseTitle = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.custom-regex'),
      click() {
        promptCustomRegex(config, setConfig, window);
      },
    },
    {
      label: 'Last.fm',
      submenu: [
        {
          label: t('main.menu.plugins.enabled'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.lastfm?.enabled),
          click(item) {
            backend.toggleScrobblers(config, window);
            config.scrobblers.lastfm.enabled = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.lastfm.now-playing'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.lastfm?.nowPlaying),
          click(item) {
            config.scrobblers.lastfm.nowPlaying = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.lastfm.love-on-like'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.lastfm?.loveOnLike),
          click(item) {
            config.scrobblers.lastfm.loveOnLike = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.lastfm.force-scrobble-on-like'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.lastfm?.forceScrobbleOnLike),
          click(item) {
            config.scrobblers.lastfm.forceScrobbleOnLike = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.lastfm.timing'),
          click() {
            promptTimingOptions('lastfm', config, setConfig, window);
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
          checked: Boolean(config.scrobblers.listenbrainz?.enabled),
          click(item) {
            backend.toggleScrobblers(config, window);
            config.scrobblers.listenbrainz.enabled = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.listenbrainz.now-playing'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.listenbrainz?.nowPlaying),
          click(item) {
            config.scrobblers.listenbrainz.nowPlaying = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.listenbrainz.love-on-like'),
          type: 'checkbox',
          checked: Boolean(config.scrobblers.listenbrainz?.loveOnLike),
          click(item) {
            config.scrobblers.listenbrainz.loveOnLike = item.checked;
            setConfig(config);
          },
        },
        {
          label: t('plugins.scrobbler.menu.listenbrainz.timing'),
          click() {
            promptTimingOptions('listenbrainz', config, setConfig, window);
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
