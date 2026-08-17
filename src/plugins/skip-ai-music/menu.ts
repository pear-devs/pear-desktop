import prompt from 'custom-electron-prompt';
import { dialog } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { getCommunityStatus, refreshCommunityArtists } from './backend';
import { uniqueNormalized } from './match';

import type { SkipAiMusicPluginConfig } from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

const promptList = async (
  window: Electron.BrowserWindow,
  title: string,
  label: string,
  values: string[],
) => {
  const output = await prompt(
    {
      title,
      label,
      value: values.join(', '),
      type: 'input',
      width: 480,
      ...promptOptions(),
    },
    window,
  );

  if (output == null) {
    return values;
  }

  return uniqueNormalized(
    String(output)
      .split(/[\n,;]+/)
      .map((item) => item.trim()),
  );
};

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<SkipAiMusicPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const community = getCommunityStatus();
  const fetched =
    community.fetchedAt > 0
      ? new Date(community.fetchedAt).toLocaleString()
      : t('plugins.skip-ai-music.menu.community-list.never');

  return [
    {
      label: t('plugins.skip-ai-music.menu.use-community-list'),
      type: 'checkbox',
      checked: config.useCommunityList,
      click(item) {
        setConfig({ useCommunityList: item.checked });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.community-list.status', {
        count: community.count,
        fetched,
      }),
      enabled: false,
    },
    {
      label: t('plugins.skip-ai-music.menu.community-list.refresh'),
      async click() {
        try {
          const artists = await refreshCommunityArtists(true);
          await dialog.showMessageBox(window, {
            type: 'info',
            title: t('plugins.skip-ai-music.menu.community-list.refresh'),
            message: t(
              'plugins.skip-ai-music.menu.community-list.refresh-success',
              { count: artists.length },
            ),
          });
        } catch (error) {
          await dialog.showMessageBox(window, {
            type: 'error',
            title: t('plugins.skip-ai-music.menu.community-list.refresh'),
            message: t(
              'plugins.skip-ai-music.menu.community-list.refresh-failed',
            ),
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    { type: 'separator' },
    {
      label: t('plugins.skip-ai-music.menu.dislike-on-skip'),
      type: 'checkbox',
      checked: config.dislikeOnSkip,
      click(item) {
        setConfig({ dislikeOnSkip: item.checked });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.show-player-buttons'),
      type: 'checkbox',
      checked: config.showPlayerButtons,
      click(item) {
        setConfig({ showPlayerButtons: item.checked });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.skip-common-keywords'),
      type: 'checkbox',
      checked: config.skipCommonKeywords,
      click(item) {
        setConfig({ skipCommonKeywords: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: t('plugins.skip-ai-music.menu.edit-blocked-artists'),
      async click() {
        const current = await getConfig();
        setConfig({
          blockedArtists: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.blocked-artists.title'),
            t('plugins.skip-ai-music.prompt.blocked-artists.label'),
            current.blockedArtists,
          ),
        });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.edit-allowed-artists'),
      async click() {
        const current = await getConfig();
        setConfig({
          allowedArtists: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.allowed-artists.title'),
            t('plugins.skip-ai-music.prompt.allowed-artists.label'),
            current.allowedArtists,
          ),
        });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.edit-keywords'),
      async click() {
        const current = await getConfig();
        setConfig({
          blockedKeywords: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.keywords.title'),
            t('plugins.skip-ai-music.prompt.keywords.label'),
            current.blockedKeywords,
          ),
        });
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.clear-blocked-songs', {
        count: config.blockedSongs.length,
      }),
      enabled: config.blockedSongs.length > 0,
      async click() {
        const { response } = await dialog.showMessageBox(window, {
          type: 'question',
          buttons: [
            t('plugins.skip-ai-music.menu.clear-blocked-songs-cancel'),
            t('plugins.skip-ai-music.menu.clear-blocked-songs-confirm'),
          ],
          defaultId: 0,
          cancelId: 0,
          title: t('plugins.skip-ai-music.menu.clear-blocked-songs', {
            count: config.blockedSongs.length,
          }),
          message: t('plugins.skip-ai-music.menu.clear-blocked-songs-message'),
        });

        if (response == 1) {
          setConfig({ blockedSongs: [] });
        }
      },
    },
  ];
};
