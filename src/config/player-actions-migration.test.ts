import { test, expect } from '@playwright/test';

import { migratePlayerActionsPlugins } from './player-actions-migration';

test('migrates slowed-reverb settings and removes the legacy entry', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': {
      enabled: true,
      slow: 0.8,
      reverbIntensity: 0.4,
      active: false,
    },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: true,
      slowedReverb: { slow: 0.8, reverbIntensity: 0.4, active: false },
    },
  });
});

test('migrates section-repeat settings and removes the legacy entry', () => {
  const result = migratePlayerActionsPlugins({
    'section-repeat': { enabled: true, active: false },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: true,
      sectionRepeat: { active: false },
    },
  });
});

test('preserves both legacy functions', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': { enabled: true, slow: 0.8, reverbIntensity: 0.4 },
    'section-repeat': { enabled: true, active: false },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: true,
      slowedReverb: { slow: 0.8, reverbIntensity: 0.4, active: true },
      sectionRepeat: { active: false },
    },
  });
});

test('keeps a disabled legacy function inactive when both entries are merged', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': { enabled: false, active: true },
    'section-repeat': { enabled: true },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: true,
      slowedReverb: { active: false },
      sectionRepeat: { active: true },
    },
  });
});

test('keeps old-only disabled functions disabled', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': { enabled: false },
    'section-repeat': { enabled: false },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      slowedReverb: { active: false },
      sectionRepeat: { active: false },
    },
  });
});

test('replaces a null current config when legacy settings enable a function', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': { enabled: true },
    'player-actions': null,
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: true,
      slowedReverb: { active: true },
    },
  });
});

test('current fields win over legacy fields, including false and zero values', () => {
  const result = migratePlayerActionsPlugins({
    'slowed-reverb': {
      enabled: true,
      slow: 0.8,
      reverbIntensity: 0.7,
      active: true,
    },
    'section-repeat': { enabled: true, active: true },
    'player-actions': {
      enabled: false,
      slowedReverb: { reverbIntensity: 0, active: false },
      sectionRepeat: { active: false, saved: [] },
    },
  });

  expect(result).toStrictEqual({
    'player-actions': {
      enabled: false,
      slowedReverb: { slow: 0.8, reverbIntensity: 0, active: false },
      sectionRepeat: { active: false, saved: [] },
    },
  });
});

test('ignores malformed legacy entries without mutating the input', () => {
  const input = {
    'slowed-reverb': null,
    'section-repeat': 'not a record',
    'player-actions': null,
  };

  const result = migratePlayerActionsPlugins(input);

  expect(result).toStrictEqual({ 'player-actions': null });
  expect(input).toStrictEqual({
    'slowed-reverb': null,
    'section-repeat': 'not a record',
    'player-actions': null,
  });
});

test('leaves records without legacy entries unchanged', () => {
  const input = {
    'player-actions': {
      enabled: false,
      sectionRepeat: { active: false, saved: [] },
    },
    'other': { value: 1 },
  };

  const result = migratePlayerActionsPlugins(input);

  expect(result).toStrictEqual(input);
  expect(result).not.toBe(input);
});
