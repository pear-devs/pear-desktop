import prompt from 'custom-electron-prompt';
import { app, dialog, type BrowserWindow } from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

  if (output !== null) {
    options.scrobblers.listenbrainz.token = output;
    setConfig(options);
  }
}

async function promptMusicBrainzEmail(
  options: ScrobblerPluginConfig,
  setConfig: SetConfType,
  window: BrowserWindow,
) {
  const output = await prompt(
    {
      title: t('plugins.scrobbler.prompt.musicbrainz-email.title'),
      label: t('plugins.scrobbler.prompt.musicbrainz-email.label'),
      type: 'input',
      value: options.musicBrainzEmail,
      ...promptOptions(),
    },
    window,
  );

  if (output !== null) {
    const email = output.trim();
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return;
    }
    options.musicBrainzEmail = email;
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
      label: t('plugins.scrobbler.menu.use-musicbrainz'),
      type: 'checkbox',
      checked: Boolean(config.useMusicBrainz),
      async click(item) {
        if (item.checked && !config.musicBrainzEmail) {
          await promptMusicBrainzEmail(config, setConfig, window);
          if (!config.musicBrainzEmail) {
            // User cancelled or left it empty
            config.useMusicBrainz = false;
            setConfig(config);
            return;
          }
        }
        config.useMusicBrainz = item.checked;
        setConfig(config);
      },
    },
    {
      label: t('plugins.scrobbler.menu.musicbrainz-email'),
      click() {
        promptMusicBrainzEmail(config, setConfig, window);
      },
    },
    {
      label: t('plugins.scrobbler.menu.regex-filters'),
      async click() {
        // HACK: custom-electron-prompt does not support <textarea> natively.
        // Instead of building a complex custom BrowserWindow from scratch with IPC, we use its
        // customScript option to inject a script that hides the default single-line <input>
        // and renders a <textarea> over it, syncing the value back to the hidden input.
        const scriptDirectory = join(app.getPath('userData'), 'scrobbler');
        mkdirSync(scriptDirectory, { recursive: true, mode: 0o700 });
        const customScriptDirectory = mkdtempSync(
          join(scriptDirectory, 'prompt-textarea-'),
        );
        const customScriptPath = join(customScriptDirectory, 'script.js');
        writeFileSync(
          customScriptPath,
          `
            module.exports = () => {
              const input = document.getElementById('data');
              if (input && input.tagName === 'INPUT') {
                input.style.display = 'none';

                const textarea = document.createElement('textarea');
                textarea.value = decodeURIComponent(input.value);

                textarea.style.width = '100%';
                textarea.style.height = '100%';
                textarea.style.boxSizing = 'border-box';
                textarea.style.resize = 'none';
                textarea.style.marginTop = '10px';
                textarea.style.padding = '5px';
                textarea.style.background = '#2c2c2c';
                textarea.style.color = '#fff';
                textarea.style.border = '1px solid #444';
                textarea.style.fontFamily = 'monospace';

                textarea.addEventListener('input', () => {
                  input.value = encodeURIComponent(textarea.value);
                });

                input.parentNode.insertBefore(textarea, input);

                const form = document.getElementById('form');
                if (form) {
                   form.style.display = 'flex';
                   form.style.flexDirection = 'column';
                   form.style.height = 'calc(100vh - 20px)';
                }
                const dataContainer = document.getElementById('data-container');
                if (dataContainer) {
                   dataContainer.style.flex = '1';
                   dataContainer.style.display = 'flex';
                   dataContainer.style.flexDirection = 'column';
                }
              }
            };
          `,
          { mode: 0o600 },
        );

        let output: string | null;
        try {
          output = await prompt(
            {
              title: t('plugins.scrobbler.menu.regex-filters'),
              label: t('plugins.scrobbler.prompt.regex-filter-multi.label'),
              type: 'input',
              value: encodeURIComponent(
                (config.customRegexFilters || []).join('\n'),
              ),
              resizable: true,
              height: 400,
              width: 500,
              customScript: customScriptPath,
              ...promptOptions(),
            },
            window,
          );
        } finally {
          rmSync(customScriptDirectory, { force: true, recursive: true });
        }

        if (output !== null) {
          const filters = decodeURIComponent(output)
            .split('\n')
            .map((line: string) => line.trim())
            .filter(Boolean);
          const invalidFilterIndex = filters.findIndex((filter) => {
            try {
              new RegExp(filter, 'i');
              return false;
            } catch {
              return true;
            }
          });

          if (invalidFilterIndex !== -1) {
            const filter = filters[invalidFilterIndex];
            let errorMessage = '';
            try {
              new RegExp(filter, 'i');
            } catch (error) {
              errorMessage =
                error instanceof Error ? error.message : String(error);
            }

            await dialog.showMessageBox(window, {
              type: 'error',
              title: t('plugins.scrobbler.dialog.invalid-regex.title'),
              message: t('plugins.scrobbler.dialog.invalid-regex.message', {
                line: invalidFilterIndex + 1,
                error: errorMessage,
              }),
            });
            return;
          }

          config.customRegexFilters = filters;
          setConfig(config);
        }
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
          label: t('plugins.scrobbler.menu.listenbrainz.token'),
          click() {
            promptListenbrainzOptions(config, setConfig, window);
          },
        },
      ],
    },
  ];
};
