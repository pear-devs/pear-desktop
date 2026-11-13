import { describe, expect, it, vi } from 'vitest';

import { createBaseContext } from '@/loader/context';
import { type Part, PluginRunner } from '@/loader/runner';
import { config } from '@/plugins/utils/common/config';

import type { BaseContext } from '@/types/contexts';

type Ctx = BaseContext<Record<string, unknown>>;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const makeRunner = (
  parts: Record<string, Part<Ctx>>,
  schemas: Record<string, Record<string, ReturnType<typeof config.bool>>> = {},
) => {
  const persisted: Record<string, unknown>[] = [];
  const errors: [string, string, unknown][] = [];
  const runner = new PluginRunner<Ctx>({
    load: (id) => ({ part: parts[id], schema: schemas[id] }),
    createContext: (instance) =>
      createBaseContext(instance, (patch) => persisted.push(patch)),
    onError: (id, phase, error) => errors.push([id, phase, error]),
  });
  return { runner, persisted, errors };
};

describe('PluginRunner', () => {
  it('runs cleanups in reverse order on stop', async () => {
    const order: string[] = [];
    const { runner } = makeRunner({
      a: (ctx) => {
        ctx.onCleanup(() => order.push('first'));
        ctx.onCleanup(() => order.push('second'));
        return () => order.push('returned');
      },
    });
    await runner.start('a', {});
    expect(runner.isRunning('a')).toBe(true);
    await runner.stop('a');
    expect(order).toEqual(['returned', 'second', 'first']);
    expect(runner.isRunning('a')).toBe(false);
  });

  it('does not start twice', async () => {
    const start = vi.fn();
    const { runner } = makeRunner({ a: start });
    await Promise.all([runner.start('a', {}), runner.start('a', {})]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('undoes what a start registers after it was stopped', async () => {
    const gate = deferred();
    const cleanup = vi.fn();
    const late = vi.fn();
    let signal: AbortSignal | undefined;
    const { runner } = makeRunner({
      a: async (ctx) => {
        signal = ctx.signal;
        await gate.promise;
        ctx.onCleanup(late);
        return cleanup;
      },
    });
    const starting = runner.start('a', {});
    await Promise.resolve();
    await runner.stop('a');
    expect(signal?.aborted).toBe(true);
    gate.resolve();
    await starting;
    expect(late).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runner.isRunning('a')).toBe(false);
  });

  it('clears timers on stop', async () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn();
      const { runner } = makeRunner({
        a: (ctx) => {
          ctx.setInterval(tick, 10);
        },
      });
      await runner.start('a', {});
      vi.advanceTimersByTime(25);
      expect(tick).toHaveBeenCalledTimes(2);
      await runner.stop('a');
      vi.advanceTimersByTime(100);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes listeners from event targets and emitters', async () => {
    const target = new EventTarget();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const emitter = {
      on: (event: string, fn: (...args: unknown[]) => void) =>
        listeners.set(event, fn),
      removeListener: (event: string) => listeners.delete(event),
    };
    const onEvent = vi.fn();
    const { runner } = makeRunner({
      a: (ctx) => {
        ctx.listen(target, 'ping', onEvent);
        ctx.listen(emitter, 'ping', onEvent);
      },
    });
    await runner.start('a', {});
    target.dispatchEvent(new Event('ping'));
    expect(listeners.has('ping')).toBe(true);
    await runner.stop('a');
    target.dispatchEvent(new Event('ping'));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(listeners.has('ping')).toBe(false);
  });

  it('isolates a failing start and reports it', async () => {
    const cleanup = vi.fn();
    const { runner, errors } = makeRunner({
      bad: (ctx) => {
        ctx.onCleanup(cleanup);
        throw new Error('boom');
      },
      good: () => {},
    });
    await runner.start('bad', {});
    await runner.start('good', {});
    expect(runner.isRunning('bad')).toBe(false);
    expect(runner.isRunning('good')).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(errors[0]?.[0]).toBe('bad');
    expect(runner.errors().has('bad')).toBe(true);
  });

  it('skips plugins without a part for this process', async () => {
    const { runner } = makeRunner({});
    await runner.start('none', {});
    expect(runner.isRunning('none')).toBe(false);
  });

  describe('applyConfig', () => {
    const schema = { on: config.bool(false), state: config.hidden(0) };

    it('restarts a part without config listeners', async () => {
      const seen: unknown[] = [];
      const { runner } = makeRunner(
        { a: (ctx) => void seen.push(ctx.config.on) },
        { a: schema as never },
      );
      await runner.start('a', { on: false, state: 0 });
      await runner.applyConfig('a', { on: true, state: 0 });
      expect(seen).toEqual([false, true]);
    });

    it('calls config listeners instead of restarting', async () => {
      const start = vi.fn();
      const listener = vi.fn();
      const { runner } = makeRunner(
        {
          a: (ctx) => {
            start();
            ctx.onConfigChange(listener);
          },
        },
        { a: schema as never },
      );
      await runner.start('a', { on: false, state: 0 });
      await runner.applyConfig('a', { on: true, state: 0 });
      expect(start).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        { on: true, state: 0 },
        { on: false, state: 0 },
      );
    });

    it('does not restart when only hidden fields changed', async () => {
      const start = vi.fn();
      const { runner } = makeRunner({ a: start }, { a: schema as never });
      await runner.start('a', { on: false, state: 0 });
      await runner.applyConfig('a', { on: false, state: 5 });
      expect(start).toHaveBeenCalledOnce();
    });

    it('does nothing for an equal config', async () => {
      const start = vi.fn();
      const { runner } = makeRunner({ a: start }, { a: schema as never });
      await runner.start('a', { on: false, state: 0 });
      await runner.applyConfig('a', { on: false, state: 0 });
      expect(start).toHaveBeenCalledOnce();
    });
  });

  it('setConfig updates ctx.config at once and persists the patch without enabled', async () => {
    let ctx: Ctx | undefined;
    const { runner, persisted } = makeRunner({
      a: (c) => {
        ctx = c;
      },
    });
    await runner.start('a', { nested: { x: 1, y: 2 } });
    await ctx!.setConfig({ nested: { x: 3 }, enabled: false } as never);
    expect(ctx!.config).toEqual({ nested: { x: 3, y: 2 } });
    expect(persisted).toEqual([{ nested: { x: 3 } }]);
  });
});
