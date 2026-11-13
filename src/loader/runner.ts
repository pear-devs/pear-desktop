// Runs one process's part (backend, preload or renderer) of every plugin.
// Process-agnostic: each loader supplies how to load a part and how to build
// its context.

import {
  changedOutsideHidden,
  type ConfigShape,
} from '@/plugins/utils/common/config';

import { type Cleanup, CleanupStack, timerSet } from './cleanup';

export type PartResult = void | Cleanup | Promise<void | Cleanup>;
export type Part<Ctx> = (ctx: Ctx) => PartResult;

type AnyConfig = Record<string, unknown>;
export type ConfigListener = (
  config: AnyConfig,
  previous: AnyConfig,
) => unknown;

/** One run of a plugin part: created on start, never reused after stop. */
export class Instance {
  readonly cleanups: CleanupStack;
  readonly timers = timerSet();
  readonly abort = new AbortController();
  readonly configListeners = new Set<ConfigListener>();
  stopped = false;

  constructor(
    readonly id: string,
    public config: AnyConfig,
    onError: (error: unknown) => void,
  ) {
    this.cleanups = new CleanupStack(onError);
  }

  async dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    this.timers.stop();
    this.configListeners.clear();
    await this.cleanups.run();
  }
}

export type RunnerPhase = 'start' | 'cleanup' | 'config';

export interface RunnerOptions<Ctx> {
  /** The plugin's part for this process, and its config schema. */
  load(
    id: string,
  ):
    | { part?: Part<Ctx>; schema?: ConfigShape }
    | undefined
    | Promise<{ part?: Part<Ctx>; schema?: ConfigShape } | undefined>;
  createContext(instance: Instance): Ctx;
  onStarted?(id: string, ms: number): void;
  onStopped?(id: string): void;
  onError?(id: string, phase: RunnerPhase, error: unknown): void;
}

export class PluginRunner<Ctx> {
  readonly #options: RunnerOptions<Ctx>;
  readonly #instances = new Map<string, Instance>();
  readonly #schemas = new Map<string, ConfigShape | undefined>();
  readonly #errors = new Map<string, unknown>();

  constructor(options: RunnerOptions<Ctx>) {
    this.#options = options;
  }

  isRunning(id: string) {
    return this.#instances.has(id);
  }

  running() {
    return [...this.#instances.keys()];
  }

  /** The error the last start of each plugin failed with. */
  errors(): ReadonlyMap<string, unknown> {
    return this.#errors;
  }

  #report(id: string, phase: RunnerPhase, error: unknown) {
    if (phase === 'start') this.#errors.set(id, error);
    this.#options.onError?.(id, phase, error);
  }

  /**
   * Starts the plugin's part with `config`. Resolves once its start settled.
   * A stop while it is still starting doesn't wait: whatever the start
   * registers afterwards is undone at once.
   */
  async start(id: string, config: AnyConfig) {
    if (this.#instances.has(id)) return;
    const instance = new Instance(id, config, (error) =>
      this.#report(id, 'cleanup', error),
    );
    this.#instances.set(id, instance);
    this.#errors.delete(id);

    try {
      const plugin = await this.#options.load(id);
      if (instance.stopped) return;
      if (!plugin?.part) {
        this.#instances.delete(id);
        return;
      }
      this.#schemas.set(id, plugin.schema);

      const startedAt = performance.now();
      const result = await plugin.part(this.#options.createContext(instance));
      if (typeof result === 'function') instance.cleanups.add(result);
      if (!instance.stopped) {
        this.#options.onStarted?.(id, performance.now() - startedAt);
      }
    } catch (error) {
      this.#report(id, 'start', error);
      if (this.#instances.get(id) === instance) this.#instances.delete(id);
      await instance.dispose();
    }
  }

  async stop(id: string) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    this.#instances.delete(id);
    await instance.dispose();
    this.#options.onStopped?.(id);
  }

  async restart(id: string, config?: AnyConfig) {
    const next = config ?? this.#instances.get(id)?.config;
    await this.stop(id);
    if (next) await this.start(id, next);
  }

  async stopAll() {
    await Promise.all(this.running().map((id) => this.stop(id)));
  }

  /**
   * A running plugin's config changed. Its `onConfigChange` listeners get the
   * new config if it registered any; otherwise the part restarts, unless only
   * hidden (runtime state) fields changed.
   */
  async applyConfig(id: string, config: AnyConfig) {
    const instance = this.#instances.get(id);
    if (!instance) return;
    const previous = instance.config;
    if (JSON.stringify(previous) === JSON.stringify(config)) return;
    instance.config = config;

    if (instance.configListeners.size > 0) {
      for (const listener of [...instance.configListeners]) {
        try {
          await listener(config, previous);
        } catch (error) {
          this.#report(id, 'config', error);
        }
      }
      return;
    }

    const schema = this.#schemas.get(id);
    if (schema && !changedOutsideHidden(schema, previous, config)) return;
    await this.restart(id, config);
  }
}
