import type { PluginConfig } from '@/types/plugins';

export type AdblockerPluginConfig = PluginConfig & {
  cache: boolean;
  additionalBlockLists: string[];
};
