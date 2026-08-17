import { t } from '@/i18n';

import { refreshCommunityArtists, getCommunityStatus } from './backend';
import { promptStringList } from './list-editor';
import { uniqueNormalized } from './match';
import { promptThreshold } from './threshold-picker';
import {
  clampCommunityMinScore,
  type BlockedSong,
  type SkipAiMusicPluginConfig,
} from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

const songLabel = (song: BlockedSong) => {
  if (song.artist && song.title) {
    return `${song.artist} - ${song.title}`;
  }
  return song.title || song.artist;
};

const promptList = async (
  window: Electron.BrowserWindow,
  title: string,
  description: string,
  placeholder: string,
  values: string[],
) => {
  const output = await promptStringList(window, {
    title,
    description,
    placeholder,
    values,
    addLabel: t('plugins.skip-ai-music.prompt.list-editor.add'),
    cancelLabel: t('plugins.skip-ai-music.prompt.list-editor.cancel'),
    duplicateLabel: t('plugins.skip-ai-music.prompt.list-editor.duplicate'),
    emptyLabel: t('plugins.skip-ai-music.prompt.list-editor.empty'),
    removeLabel: t('plugins.skip-ai-music.prompt.list-editor.remove'),
    removeNamedLabel: t(
      'plugins.skip-ai-music.prompt.list-editor.remove-named',
    ),
    saveLabel: t('plugins.skip-ai-music.prompt.list-editor.save'),
  });

  if (output == null) {
    return values;
  }

  return uniqueNormalized(output);
};

const promptBlockedSongs = async (
  window: Electron.BrowserWindow,
  songs: BlockedSong[],
) => {
  const output = await promptStringList(window, {
    title: t('plugins.skip-ai-music.prompt.blocked-songs.title'),
    description: t('plugins.skip-ai-music.prompt.blocked-songs.description'),
    placeholder: t('plugins.skip-ai-music.prompt.blocked-songs.placeholder'),
    values: songs.map((song) => songLabel(song)),
    addLabel: t('plugins.skip-ai-music.prompt.list-editor.add'),
    cancelLabel: t('plugins.skip-ai-music.prompt.list-editor.cancel'),
    duplicateLabel: t('plugins.skip-ai-music.prompt.list-editor.duplicate'),
    emptyLabel: t('plugins.skip-ai-music.prompt.list-editor.empty'),
    removeLabel: t('plugins.skip-ai-music.prompt.list-editor.remove'),
    removeNamedLabel: t(
      'plugins.skip-ai-music.prompt.list-editor.remove-named',
    ),
    saveLabel: t('plugins.skip-ai-music.prompt.list-editor.save'),
  });

  if (output == null) {
    return songs;
  }

  const next: BlockedSong[] = [];
  for (const entry of output) {
    const split = entry.split(' - ');
    if (split.length >= 2) {
      const titlePart = split.pop()?.trim() || '';
      const artistPart = split.join(' - ').trim();
      if (titlePart) {
        next.push({ artist: artistPart, title: titlePart });
        continue;
      }
    }
    next.push({ artist: '', title: entry.trim() });
  }
  return next;
};

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
  refresh,
}: MenuContext<SkipAiMusicPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const minScore = clampCommunityMinScore(config.communityMinScore);
  const community = getCommunityStatus();
  const fetched =
    community.fetchedAt > 0
      ? new Date(community.fetchedAt).toLocaleString()
      : t('plugins.skip-ai-music.menu.zoundhub.never');

  return [
    {
      label: t('plugins.skip-ai-music.menu.zoundhub.label'),
      submenu: [
        {
          label: t('plugins.skip-ai-music.menu.use-community-list'),
          type: 'checkbox',
          checked: config.useCommunityList,
          click(item) {
            setConfig({ useCommunityList: item.checked });
            refresh();
          },
        },
        {
          label: t('plugins.skip-ai-music.menu.zoundhub.status', {
            count: community.count,
            fetched,
            score: minScore,
          }),
          enabled: false,
        },
        {
          label: t('plugins.skip-ai-music.menu.zoundhub.threshold-value', {
            score: minScore,
          }),
          async click() {
            const current = await getConfig();
            const output = await promptThreshold(window, {
              title: t('plugins.skip-ai-music.prompt.threshold.title'),
              description: t('plugins.skip-ai-music.prompt.threshold.description'),
              value: clampCommunityMinScore(current.communityMinScore),
              valueLabel: t('plugins.skip-ai-music.prompt.threshold.value'),
              cancelLabel: t('plugins.skip-ai-music.prompt.list-editor.cancel'),
              saveLabel: t('plugins.skip-ai-music.prompt.list-editor.save'),
            });

            if (output != null) {
              const score = clampCommunityMinScore(output);
              setConfig({ communityMinScore: score });
              await refreshCommunityArtists(false, score);
              await refresh();
            }
          },
        },
        {
          label: t('plugins.skip-ai-music.menu.zoundhub.refresh'),
          async click() {
            await refreshCommunityArtists(true);
            await refresh();
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: t('plugins.skip-ai-music.menu.behavior.label'),
      submenu: [
        {
          label: t('plugins.skip-ai-music.menu.dislike-on-skip'),
          type: 'checkbox',
          checked: config.dislikeOnSkip,
          click(item) {
            setConfig({ dislikeOnSkip: item.checked });
            refresh();
          },
        },
        {
          label: t('plugins.skip-ai-music.menu.skip-common-keywords'),
          type: 'checkbox',
          checked: config.skipCommonKeywords,
          click(item) {
            setConfig({ skipCommonKeywords: item.checked });
            refresh();
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: t('plugins.skip-ai-music.menu.blocked-artists.label', {
        count: config.blockedArtists.length,
      }),
      async click() {
        const current = await getConfig();
        setConfig({
          blockedArtists: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.blocked-artists.title'),
            t('plugins.skip-ai-music.prompt.blocked-artists.description'),
            t('plugins.skip-ai-music.prompt.blocked-artists.placeholder'),
            current.blockedArtists,
          ),
        });
        await refresh();
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.blocked-songs.label', {
        count: config.blockedSongs.length,
      }),
      async click() {
        const current = await getConfig();
        setConfig({
          blockedSongs: await promptBlockedSongs(
            window,
            current.blockedSongs,
          ),
        });
        await refresh();
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.keywords.label', {
        count: config.blockedKeywords.length,
      }),
      async click() {
        const current = await getConfig();
        setConfig({
          blockedKeywords: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.keywords.title'),
            t('plugins.skip-ai-music.prompt.keywords.description'),
            t('plugins.skip-ai-music.prompt.keywords.placeholder'),
            current.blockedKeywords,
          ),
        });
        await refresh();
      },
    },
    {
      label: t('plugins.skip-ai-music.menu.allowed-artists.label', {
        count: config.allowedArtists.length,
      }),
      async click() {
        const current = await getConfig();
        setConfig({
          allowedArtists: await promptList(
            window,
            t('plugins.skip-ai-music.prompt.allowed-artists.title'),
            t('plugins.skip-ai-music.prompt.allowed-artists.description'),
            t('plugins.skip-ai-music.prompt.allowed-artists.placeholder'),
            current.allowedArtists,
          ),
        });
        await refresh();
      },
    },
  ];
};
