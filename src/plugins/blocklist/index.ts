import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMenu } from './menu';
import {
  onConfigChange,
  onPlayerApiReady,
  onRendererLoad,
  stop,
} from './renderer';
import style from './style.css?inline';

export type BlockedArtist = {
  /** Display name of the artist, used for matching (case-insensitive). */
  name: string;
  /** YouTube channel id (`UC...`) of the artist, when known. */
  channelId?: string;
};

export type BlocklistPluginConfig = {
  enabled: boolean;
  blockedArtists: BlockedArtist[];
};

export const defaultConfig: BlocklistPluginConfig = {
  enabled: false,
  blockedArtists: [],
};

export default createPlugin({
  name: () => t('plugins.blocklist.name'),
  description: () => t('plugins.blocklist.description'),
  restartNeeded: true,
  config: defaultConfig,
  stylesheets: [style],
  menu: onMenu,
  renderer: {
    start: onRendererLoad,
    onConfigChange,
    onPlayerApiReady,
    stop,
  },
});
