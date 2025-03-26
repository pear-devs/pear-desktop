import { createPlugin } from '@/utils';
import { onPlayerApiReady, onUnload } from './renderer';
import { t } from '@/i18n';

export type NightcorePluginConfig = {
  enabled: boolean;
  // Default value of effect (-75 to 75)
  defaultEffectValue: number;
  // Whether to remember the last used settings
  rememberSettings: boolean;
};

export default createPlugin({
  name: () => t('plugins.nightcore.name'),
  description: () => t('plugins.nightcore.description'),
  restartNeeded: false,
  config: {
    enabled: true, // Always enabled by default
    defaultEffectValue: 0, // Default to normal speed
    rememberSettings: true,
  },
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
  },
}); 