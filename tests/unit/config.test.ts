import { describe, expect, it } from 'vitest';

import {
  changedOutsideHidden,
  config,
  defaultsOf,
  mergeDeep,
  normalizeConfig,
  resolvePluginState,
} from '@/plugins/utils/common/config';

const shape = {
  autoload: config.bool(false, { label: 'k.autoload' }),
  steps: config.number(1, { min: 1, max: 10 }),
  effect: config.select('fancy', [{ value: 'fancy' }, { value: 'scale' }]),
  shortcuts: config.group({
    up: config.shortcut(''),
    down: config.shortcut(''),
  }),
  categories: config.multi(
    ['sponsor'],
    [{ value: 'sponsor' }, { value: 'intro' }],
  ),
  lists: config.list([]),
  position: config.hidden<[number, number]>([10, 10]),
  presets: config.hidden<Record<string, boolean>>({ bass: false }),
};

describe('config schema', () => {
  it('builds defaults, nesting groups', () => {
    expect(defaultsOf(shape)).toEqual({
      autoload: false,
      steps: 1,
      effect: 'fancy',
      shortcuts: { up: '', down: '' },
      categories: ['sponsor'],
      lists: [],
      position: [10, 10],
      presets: { bass: false },
    });
  });

  it('does not share default objects between results', () => {
    const a = defaultsOf(shape);
    a.position[0] = 99;
    expect(defaultsOf(shape).position).toEqual([10, 10]);
  });

  it('keeps valid stored values and resets invalid ones', () => {
    const result = normalizeConfig(shape, {
      autoload: true,
      steps: 50, // out of range
      effect: 'nope', // not an option
      shortcuts: { up: 'Ctrl+Up', down: 3 },
      categories: ['intro', 'bogus'],
      lists: ['a', 'b'],
      unknown: 'dropped',
    });
    expect(result).toEqual({
      autoload: true,
      steps: 1,
      effect: 'fancy',
      shortcuts: { up: 'Ctrl+Up', down: '' },
      categories: ['sponsor'],
      lists: ['a', 'b'],
      position: [10, 10],
      presets: { bass: false },
    });
  });

  it('takes any stored hidden value, merging plain objects over the default', () => {
    const result = normalizeConfig(shape, {
      position: [1, 2],
      presets: { extra: true },
    });
    expect(result.position).toEqual([1, 2]);
    expect(result.presets).toEqual({ bass: false, extra: true });
  });

  it('treats non-objects as nothing stored', () => {
    expect(normalizeConfig(shape, null)).toEqual(defaultsOf(shape));
    expect(normalizeConfig(shape, 'x')).toEqual(defaultsOf(shape));
  });

  it('tells hidden-only changes apart', () => {
    const base = defaultsOf(shape);
    expect(
      changedOutsideHidden(shape, base, { ...base, position: [0, 0] }),
    ).toBe(false);
    expect(
      changedOutsideHidden(shape, base, {
        ...base,
        shortcuts: { up: 'X', down: '' },
      }),
    ).toBe(true);
  });

  it('merges deeply, replacing arrays', () => {
    expect(mergeDeep({ a: { b: 1, c: [1, 2] } }, { a: { c: [3] } })).toEqual({
      a: { b: 1, c: [3] },
    });
  });

  describe('resolvePluginState', () => {
    it('takes enabled from storage, else the default', () => {
      expect(
        resolvePluginState({ config: shape }, { enabled: true }).enabled,
      ).toBe(true);
      expect(resolvePluginState({ config: shape }, {}).enabled).toBe(false);
      expect(
        resolvePluginState({ enabledByDefault: () => true }, undefined).enabled,
      ).toBe(true);
    });

    it('leaves enabled out of the config', () => {
      const state = resolvePluginState(
        { config: shape },
        { enabled: true, autoload: true },
      );
      expect(state.config).not.toHaveProperty('enabled');
      expect(state.config.autoload).toBe(true);
    });
  });
});
