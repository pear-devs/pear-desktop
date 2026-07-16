import { createSignal } from 'solid-js';

import type { defaultConfig } from '@/config/defaults';
import type { RendererContext } from '@/types/contexts';
import type { RestartRequirement } from '@/types/restart';

export type StoreShape = typeof defaultConfig;
export type PluginConfigMap = Record<
  string,
  Record<string, unknown> & { enabled?: boolean }
>;

export interface AppMeta {
  version: string;
  platform: string;
}

// ---- reactive config snapshot (seeded + pushed from the backend) ----
const [store, setStore] = createSignal<StoreShape | null>(null);
export { store };

// ---- IPC bridge (wired in the renderer's start()) ----
type Ipc = RendererContext<{ enabled: boolean }>['ipc'];
let ipc: Ipc | null = null;
export const setIpc = (value: Ipc) => {
  ipc = value;
};

const pendingPluginWrites = new Map<
  string,
  { timeout: ReturnType<typeof setTimeout>; write: () => Promise<unknown> }
>();
const PLUGIN_SLIDER_DEBOUNCE_MS = 200;

export const bridge = {
  loadStore: () => ipc!.invoke('ytmd-sui:load-store') as Promise<StoreShape>,
  optionSet: (key: string, value: unknown) =>
    ipc!.invoke('ytmd-sui:option-set', key, value),
  pluginToggle: (id: string, enabled: boolean) =>
    ipc!.invoke('ytmd-sui:plugin-toggle', id, enabled),
  // Plugin field writes ride the app's existing per-plugin config channel.
  pluginSet: (id: string, partial: object) =>
    ipc!.invoke('peard:set-config', id, partial),
  restartSessionOpen: () => ipc!.invoke('ytmd-sui:restart-session-open'),
  restartSessionClose: (changes: RestartRequirement[]) =>
    ipc!.invoke('ytmd-sui:restart-session-close', changes),
  configEdit: () => ipc!.invoke('ytmd-sui:config-edit'),
  toggleDevTools: () => ipc!.invoke('ytmd-sui:toggle-devtools'),
  restart: () => ipc!.invoke('ytmd-sui:restart'),
  appMeta: () => ipc!.invoke('ytmd-sui:app-meta') as Promise<AppMeta>,
};

export const refreshStore = async () => {
  setStore(await bridge.loadStore());
};

export const listenStorePush = () => {
  ipc!.on('ytmd-sui:store-changed', (next: StoreShape) => {
    setStore(next);
  });
};

// ---- value helpers ----

const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

export const getByPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );

/** Optimistically patch a dotted path in the local store signal. */
export const patchLocal = (path: string, value: unknown) => {
  const current = store();
  if (!current) return;
  const next = clone(current) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  let node = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  setStore(next as unknown as StoreShape);
};

// ---- shallow deep-merge for plugin defaults + stored overrides ----
export const deepMergeLite = <T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown> | undefined,
): T => {
  if (!override) return clone(base);
  const out = clone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMergeLite(
        out[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out as T;
};

/** Build a nested partial object from a dotted key + value. */
export const nestPartial = (
  path: string,
  value: unknown,
): Record<string, unknown> => {
  const keys = path.split('.');
  const root: Record<string, unknown> = {};
  let node = root;
  for (let i = 0; i < keys.length - 1; i++) {
    node[keys[i]] = {};
    node = node[keys[i]] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return root;
};

// ---- app option get/set (with the tray composite special case) ----

const TRAY_KEY = 'options.__trayMode';

export const getAppValue = (snapshot: StoreShape, key: string): unknown => {
  if (key === TRAY_KEY) {
    if (!snapshot.options.tray) return 'off';
    return snapshot.options.appVisible ? 'show' : 'hide';
  }
  return getByPath(snapshot, key);
};

export const setAppValue = (key: string, value: unknown) => {
  if (key === TRAY_KEY) {
    const tray = value !== 'off';
    const appVisible = value !== 'hide';
    patchLocal('options.tray', tray);
    patchLocal('options.appVisible', appVisible);
    bridge.optionSet('options.tray', tray);
    bridge.optionSet('options.appVisible', appVisible);
    return;
  }
  patchLocal(key, value);
  bridge.optionSet(key, value);
};

// ---- plugin config get/set ----

export const getPluginConfig = (
  snapshot: StoreShape,
  id: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  const stored = (snapshot.plugins as PluginConfigMap)[id];
  return deepMergeLite(defaults, stored);
};

export const setPluginValue = (id: string, key: string, value: unknown) => {
  patchLocal(`plugins.${id}.${key}`, value);
  bridge.pluginSet(id, nestPartial(key, value));
};

/** Update a slider immediately, then persist its final value after dragging. */
export const setPluginSliderValue = (
  id: string,
  key: string,
  value: unknown,
) => {
  patchLocal(`plugins.${id}.${key}`, value);

  const writeKey = `${id}:${key}`;
  const pending = pendingPluginWrites.get(writeKey);
  if (pending) clearTimeout(pending.timeout);

  const write = () => bridge.pluginSet(id, nestPartial(key, value));

  pendingPluginWrites.set(writeKey, {
    timeout: setTimeout(() => {
      pendingPluginWrites.delete(writeKey);
      write();
    }, PLUGIN_SLIDER_DEBOUNCE_MS),
    write,
  });
};

/** Persist slider values that are still waiting for their debounce timer. */
export const flushPendingPluginSliderWrites = async () => {
  const pending = [...pendingPluginWrites.values()];
  pendingPluginWrites.clear();

  for (const item of pending) clearTimeout(item.timeout);
  await Promise.all(pending.map((item) => item.write()));
};
