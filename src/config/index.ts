import { deepmergeCustom } from 'deepmerge-ts';

import { store, type IStore } from './store';
import { restart } from '@/providers/app-controls';

import type { defaultConfig } from './defaults';

const deepmerge = deepmergeCustom({
  mergeArrays: false,
});

export { defaultConfig } from './defaults';
export * as plugins from './plugins';

export const set = (key: string, value: unknown) => {
  store.set(key, value);
};

export const setPartial = (
  key: string,
  value: object,
  defaultValue?: object,
) => {
  const newValue = deepmerge(defaultValue ?? {}, store.get(key) ?? {}, value);
  store.set(key, newValue);
};

export const setMenuOption = (key: string, value: unknown) => {
  set(key, value);
  if (store.get('options.restartOnConfigChanges')) {
    restart();
  }
};

// MAGIC OF TYPESCRIPT

type Prev = [
  never,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  ...0[],
];
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never;
type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
          ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
          : never;
      }[keyof T]
    : '';

type SplitKey<K> = K extends `${infer A}.${infer B}` ? [A, B] : [K, string];
type PathValue<T, K extends string> =
  SplitKey<K> extends [infer A extends keyof T, infer B extends string]
    ? PathValue<T[A], B>
    : T;

export const get = <Key extends Paths<typeof defaultConfig>>(key: Key) =>
  store.get(key) as PathValue<typeof defaultConfig, typeof key>;

export const edit = () => store.openInEditor();

export const watch = (cb: Parameters<IStore['onDidAnyChange']>[0]) => {
  store.onDidAnyChange(cb);
};
