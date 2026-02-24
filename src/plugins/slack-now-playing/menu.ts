import prompt from 'custom-electron-prompt';
import { type BrowserWindow, dialog } from 'electron';

import promptOptions from '@/providers/prompt-options';
import { t } from '@/i18n';

import type { SlackNowPlayingConfig } from './main';
import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

/**
 * Result of configuration validation
 */
type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates the Slack Now Playing configuration
 * @param config The configuration to validate
 * @returns A validation result object
 */
function validateConfig(config: SlackNowPlayingConfig): ValidationResult {
  const errors: string[] = [];

  // Check token
  if (!config.token) {
    errors.push('Missing Slack API token');
  } else if (!config.token.startsWith('xoxc-')) {
    errors.push('Invalid Slack API token format (should start with "xoxc-")');
  }

  // Check cookie token
  if (!config.cookieToken) {
    errors.push('Missing Slack cookie token');
  } else if (!config.cookieToken.startsWith('xoxd-')) {
    errors.push(
      'Invalid Slack cookie token format (should start with "xoxd-")',
    );
  }

  // Check emoji name
  if (!config.emojiName) {
    errors.push('Missing custom emoji name');
  } else if (!/^[a-z0-9_-]+$/.test(config.emojiName)) {
    errors.push(
      'Invalid emoji name format (should only contain lowercase letters, numbers, hyphens, and underscores)',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Prompts user for Slack Now Playing plugin settings
 * @param options Current plugin configuration
 * @param setConfig Function to save the updated configuration
 * @param window Browser window instance
 * @returns Promise that resolves when the configuration is saved
 */
async function promptSlackNowPlayingOptions(
  options: SlackNowPlayingConfig,
  setConfig: (config: SlackNowPlayingConfig) => void,
  window: BrowserWindow,
): Promise<void> {
  const output = await prompt(
    {
      title: t('plugins.slack-now-playing.name'),
      label: `<div style="font-family: system-ui; line-height: 1.5;">
        <h3>${t('plugins.slack-now-playing.name')}</h3>
        <h4>HOW TO GET YOUR SLACK TOKENS:</h4>
        <p>Open Slack in browser & press F12<br />
        For <strong>${t('plugins.slack-now-playing.menu.token')}</strong>: Network tab > Make a request > Find "token" parameter<br />
        For <strong>${t('plugins.slack-now-playing.menu.cookie-token')}</strong>: Application tab > Cookies > "d" cookie value</p>
        <p><strong>${t('plugins.slack-now-playing.menu.emoji-name')}</strong>: Used to display album art in your status</p>
      </div>`,
      type: 'multiInput',
      useHtmlLabel: true,
      multiInputOptions: [
        {
          label: t('plugins.slack-now-playing.menu.token'),
          value: options.token,
          inputAttrs: {
            type: 'text',
            placeholder: 'xoxc-...',
          },
        },
        {
          label: t('plugins.slack-now-playing.menu.cookie-token'),
          value: options.cookieToken,
          inputAttrs: {
            type: 'text',
            placeholder: 'xoxd-...',
          },
        },
        {
          label: t('plugins.slack-now-playing.menu.emoji-name'),
          value: options.emojiName,
          inputAttrs: {
            type: 'text',
            placeholder: 'my-album-art',
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
    try {
      // Create a deep copy of the options to ensure we don't modify the original
      const updatedOptions = { ...options } as SlackNowPlayingConfig;

      // Update only the fields that were provided
      if (output[0] !== undefined) {
        updatedOptions.token = output[0];
      }
      if (output[1] !== undefined) {
        updatedOptions.cookieToken = output[1];
      }
      if (output[2] !== undefined) {
        updatedOptions.emojiName = output[2];
      }

      // Validate the updated options
      const validationResult = validateConfig(updatedOptions);

      if (!validationResult.valid) {
        // Show validation errors to the user
        await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Slack Now Playing Configuration Issues',
          message: 'There are issues with your Slack configuration:',
          detail: validationResult.errors.join('\n'),
          buttons: ['OK'],
        });
      }

      // Save the config even if it has validation errors
      // This allows users to save partial configurations
      setConfig(updatedOptions);

      // Config has been saved successfully
    } catch (error) {
      console.error('Error saving Slack Now Playing configuration:', error);
      await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Configuration Error',
        message: 'Failed to save Slack Now Playing configuration',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['OK'],
      });
    }
  }
}

export const onMenu = ({
  window,
  getConfig,
  setConfig,
}: MenuContext<SlackNowPlayingConfig>): MenuTemplate => {
  return [
    {
      label: t('plugins.slack-now-playing.menu.settings'),
      async click() {
        // Get the latest config before showing the prompt
        const latestConfig = await getConfig();
        await promptSlackNowPlayingOptions(latestConfig, setConfig, window);
      },
    },
  ];
};
