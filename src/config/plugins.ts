import { allPlugins } from 'virtual:plugins';

import {
  isPlainObject,
  mergeDeep,
  type PluginState,
  resolvePluginState,
} from '@/plugins/utils/common/config';
import { restart } from '@/providers/app-controls';

import { store } from './store';

/** What is stored for every plugin (partial, without defaults). */
export function getPlugins() {
  return (store.get('plugins') ?? {}) as Record<string, unknown>;
}

/** A plugin's `enabled` flag and config, with defaults applied. */
export async function getPluginState(id: string): Promise<PluginState> {
  return resolvePluginState((await allPlugins())[id], getPlugins()[id]);
}

export async function isEnabled(id: string) {
  return (await getPluginState(id)).enabled;
}

/** Saves a partial config of a plugin (`enabled` is left alone). */
export function setPluginConfig(id: string, patch: unknown) {
  if (!isPlainObject(patch)) return;
  const values = { ...patch };
  delete values.enabled;
  const plugins = getPlugins();
  store.set('plugins', {
    ...plugins,
    [id]: mergeDeep(plugins[id] ?? {}, values),
  });
}

function setEnabled(id: string, enabled: boolean) {
  const plugins = getPlugins();
  const stored = isPlainObject(plugins[id]) ? plugins[id] : {};
  store.set('plugins', { ...plugins, [id]: { ...stored, enabled } });
  if (store.get('options.restartOnConfigChanges')) {
    restart();
  }
}

export function enable(id: string) {
  setEnabled(id, true);
}

export function disable(id: string) {
  setEnabled(id, false);
}
