import { describe, expect, it, vi } from 'vitest';

import { IpcRegistry } from '@/loader/ipc-registry';
import { buildConfigMenu, type MenuEnv, patchAt } from '@/loader/menu-builder';
import { config, defaultsOf } from '@/plugins/utils/common/config';
import { Platform } from '@/types/plugins';

describe('IpcRegistry', () => {
  it('routes invokes by plugin and name', async () => {
    const registry = new IpcRegistry();
    registry.handle('a', 'add', (x: number, y: number) => x + y);
    registry.handle('b', 'add', () => 'other plugin');
    expect(await registry.invoke('a', 'add', [1, 2])).toBe(3);
    expect(await registry.invoke('b', 'add', [])).toBe('other plugin');
  });

  it('rejects invokes nobody handles, and removed handlers', async () => {
    const registry = new IpcRegistry();
    const remove = registry.handle('a', 'x', () => 1);
    remove();
    await expect(registry.invoke('a', 'x', [])).rejects.toThrow(/no handler/);
  });

  it('refuses a second handler for the same name', () => {
    const registry = new IpcRegistry();
    registry.handle('a', 'x', () => 1);
    expect(() => registry.handle('a', 'x', () => 2)).toThrow(/already/);
  });

  it('emits to listeners until they are removed', () => {
    const registry = new IpcRegistry();
    const fn = vi.fn();
    const off = registry.on('a', 'tick', fn);
    registry.on('a', 'tick', fn);
    registry.emit('a', 'tick', [1]);
    off();
    registry.emit('a', 'tick', [2]);
    registry.emit('b', 'tick', [3]);
    expect(fn.mock.calls).toEqual([[1], [1], [2]]);
  });

  it('keeps emitting when a listener throws', () => {
    const registry = new IpcRegistry();
    const fn = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.on('a', 'x', () => {
      throw new Error('boom');
    });
    registry.on('a', 'x', fn);
    registry.emit('a', 'x', []);
    expect(fn).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('buildConfigMenu', () => {
  const shape = {
    autoload: config.bool(true, { label: 'autoload' }),
    hour12: config.bool(true, { label: 'clock24', invert: true }),
    effect: config.select('b', [{ value: 'a', label: 'A' }, { value: 'b' }], {
      label: 'effect',
    }),
    quality: config.number(50, {
      label: 'quality',
      options: [{ value: 10 }, { value: 50, label: { text: '50px' } }],
    }),
    steps: config.number(1, { label: 'steps', min: 1 }),
    keys: config.group(
      { up: config.shortcut('', { label: 'up' }) },
      { label: 'keys' },
    ),
    flat: config.group({ inner: config.bool(false, { label: 'inner' }) }),
    windowsOnly: config.bool(false, {
      label: 'win',
      platforms: Platform.Windows,
    }),
    unlabelled: config.bool(false),
    state: config.hidden(0),
    list: config.list([], { label: 'list' }),
  };

  const makeEnv = () => {
    const set = vi.fn();
    const prompt = vi.fn();
    const env: MenuEnv = {
      label: (label) =>
        typeof label === 'string'
          ? `t:${label}`
          : 'text' in label
            ? label.text
            : `t:${label.key}`,
      platform: Platform.Linux,
      set,
      prompt,
    };
    return { env, set, prompt };
  };

  it('generates items for labelled, visible fields', () => {
    const { env } = makeEnv();
    const items = buildConfigMenu(shape, defaultsOf(shape), env);
    expect(items.map((item) => item.label)).toEqual([
      't:autoload',
      't:clock24',
      't:effect',
      't:quality',
      't:steps',
      't:keys',
      't:inner',
    ]);
  });

  it('wires checkboxes, inverted checkboxes and radios', () => {
    const { env, set } = makeEnv();
    const items = buildConfigMenu(shape, defaultsOf(shape), env);
    const click = (item: (typeof items)[number], checked?: boolean) =>
      (item.click as (item: { checked?: boolean }) => void)({ checked });

    expect(items[0]).toMatchObject({ type: 'checkbox', checked: true });
    click(items[0], false);
    expect(set).toHaveBeenLastCalledWith(['autoload'], false);

    expect(items[1]).toMatchObject({ checked: false });
    click(items[1], true);
    expect(set).toHaveBeenLastCalledWith(['hour12'], false);

    const effect = items[2].submenu as Electron.MenuItemConstructorOptions[];
    expect(effect.map((it) => [it.label, it.checked])).toEqual([
      ['t:A', false],
      ['b', true],
    ]);
    click(effect[0]);
    expect(set).toHaveBeenLastCalledWith(['effect'], 'a');

    const quality = items[3].submenu as Electron.MenuItemConstructorOptions[];
    expect(quality.map((it) => it.label)).toEqual(['10', '50px']);
  });

  it('prompts for fields without options, with their nested path', () => {
    const { env, prompt } = makeEnv();
    const items = buildConfigMenu(shape, defaultsOf(shape), env);
    (items[4].click as () => void)();
    expect(prompt).toHaveBeenLastCalledWith(shape.steps, ['steps'], 1);
    const keys = items[5].submenu as Electron.MenuItemConstructorOptions[];
    (keys[0].click as () => void)();
    expect(prompt).toHaveBeenLastCalledWith(
      shape.keys.fields.up,
      ['keys', 'up'],
      '',
    );
  });

  it('shows platform-specific fields only on their platform', () => {
    const { env } = makeEnv();
    env.platform = Platform.Windows;
    const items = buildConfigMenu(shape, defaultsOf(shape), env);
    expect(items.map((item) => item.label)).toContain('t:win');
  });

  it('builds nested patches', () => {
    expect(patchAt(['a', 'b'], 1)).toEqual({ a: { b: 1 } });
    expect(patchAt(['a'], 1)).toEqual({ a: 1 });
  });
});
