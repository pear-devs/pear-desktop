import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';

import promptOptions from '@/providers/prompt-options';

import { setMenuOptions } from '@/config/plugins';

import { LoggerPrefix } from '@/utils';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';
import type { SlackStatusConfig } from './index';

async function promptSlackStatusOptions(
  options: SlackStatusConfig,
  setConfig: (config: SlackStatusConfig) => void,
  window: Electron.BrowserWindow,
): Promise<void> {
  console.log(LoggerPrefix, t('plugins.slack-status.menu.open'));

  const output = await prompt(
    {
      title: t('plugins.slack-status.name'),
      label: `<div style="font-family: system-ui; line-height: 1.5;">
        <h3>${t('plugins.slack-status.name')}</h3>
        <h4>How to set up Slack API Token</h4>
        <ol>
          <li>Go to <a href="https://api.slack.com/apps" target="_blank">https://api.slack.com/apps</a> and select your app.</li>
          <li>In the left sidebar, click <b>OAuth & Permissions</b>.</li>
          <li>Under <b>Scopes</b>, in the <b>User Token Scopes</b> section, add <code>users.profile:write</code>.</li>
          <li>Click <b>Save Changes</b>.</li>
          <li>At the top, click <b>Install App to Workspace</b> (or <b>Reinstall App</b> if already installed).</li>
          <li>Authorize the app when prompted.</li>
          <li>Copy the token from <b>OAuth Tokens</b> and paste it below.</li>
        </ol>
        <hr />
      </div>`,
      type: 'multiInput',
      useHtmlLabel: true,
      multiInputOptions: [
        {
          label: t('plugins.slack-status.menu.token'),
          value: options.token,
          inputAttrs: {
            type: 'text',
            placeholder: 'xoxc-...',
          },
        },
      ],
      resizable: true,
      width: 620,
      height: 520,
      ...promptOptions(),
    },
    window,
  );

  if (output) {
    const updatedOptions = { ...options } as SlackStatusConfig;
    if (output[0] !== undefined) updatedOptions.token = output[0];
    setConfig(updatedOptions);
    console.log(
      LoggerPrefix,
      t('plugins.slack-status.menu.set', updatedOptions),
    );
  }
}

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<SlackStatusConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  return [
    {
      label: t('plugins.slack-status.menu.set-token'),
      click: () => promptSlackStatusOptions(config, setConfig, window),
    },
    {
      label: t('plugins.slack-status.menu.clear-activity-after-timeout'),
      type: 'checkbox',
      checked: config.activityTimeoutEnabled,
      click(item: Electron.MenuItem) {
        setConfig({
          ...config,
          activityTimeoutEnabled: item.checked,
        });
      },
    },
    {
      label: t('plugins.slack-status.menu.set-inactivity-timeout'),
      click: () => setInactivityTimeout(window, config),
    },
  ];
};

async function setInactivityTimeout(
  win: Electron.BrowserWindow,
  options: SlackStatusConfig,
) {
  const output = await prompt(
    {
      title: t('plugins.slack-status.prompt.set-inactivity-timeout.title'),
      label: t('plugins.slack-status.prompt.set-inactivity-timeout.label'),
      value: String(Math.round((options.activityTimeoutTime ?? 0) / 1e3)),
      type: 'counter',
      counterOptions: { minimum: 0, multiFire: true },
      width: 450,
      ...promptOptions(),
    },
    win,
  );

  if (output) {
    options.activityTimeoutTime = Math.round(~~output * 1e3);
    setMenuOptions('slack-status', options);
  }
}
