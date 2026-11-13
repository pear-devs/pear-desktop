// The part of a plugin context every process shares.

import { mergeDeep } from '@/plugins/utils/common/config';
import { LoggerPrefix } from '@/utils';

import type { Instance } from './runner';
import type {
  BaseContext,
  Listen,
  Logger,
  NodeEmitter,
} from '@/types/contexts';

export const createLogger = (id: string): Logger => ({
  log: (...args) => console.log(LoggerPrefix, `[${id}]`, ...args),
  warn: (...args) => console.warn(LoggerPrefix, `[${id}]`, ...args),
  error: (...args) => console.error(LoggerPrefix, `[${id}]`, ...args),
});

const isEventTarget = (target: unknown): target is EventTarget =>
  typeof (target as EventTarget).addEventListener === 'function';

/**
 * @param persist saves a config patch where this process saves config
 *   (the store in main, IPC to main elsewhere).
 */
export function createBaseContext<C>(
  instance: Instance,
  persist: (patch: Record<string, unknown>) => unknown,
): BaseContext<C> {
  const { cleanups, timers } = instance;

  const listen = ((
    target: EventTarget | NodeEmitter,
    type: string,
    listener: (...args: never[]) => void,
    options?: AddEventListenerOptions | boolean,
  ) => {
    if (isEventTarget(target)) {
      target.addEventListener(type, listener as EventListener, options);
      cleanups.add(() =>
        target.removeEventListener(type, listener as EventListener, options),
      );
    } else {
      target.on(type, listener);
      cleanups.add(() => target.removeListener(type, listener));
    }
  }) as Listen;

  return {
    id: instance.id,
    get config() {
      return instance.config as Readonly<C>;
    },
    async setConfig(patch) {
      const values = { ...(patch as Record<string, unknown>) };
      delete values.enabled;
      instance.config = mergeDeep(instance.config, values) as Record<
        string,
        unknown
      >;
      await persist(values);
    },
    onConfigChange(listener) {
      const entry = listener as Parameters<
        typeof instance.configListeners.add
      >[0];
      instance.configListeners.add(entry);
      cleanups.add(() => instance.configListeners.delete(entry));
    },
    onCleanup(fn) {
      cleanups.add(fn);
    },
    signal: instance.abort.signal,
    setTimeout: (fn, ms) => timers.setTimeout(fn, ms),
    setInterval: (fn, ms) => timers.setInterval(fn, ms),
    clearTimeout: (timer) => timers.clearTimeout(timer),
    clearInterval: (timer) => timers.clearInterval(timer),
    listen,
    log: createLogger(instance.id),
  };
}
