import { test, expect } from '@playwright/test';

import { isReverbEngaged, isSlowEngaged } from './engine';

const slowCases: {
  name: string;
  config: { active: boolean; slow: number };
  expected: boolean;
}[] = [
  {
    name: 'inactive at 0.8x is disengaged',
    config: { active: false, slow: 0.8 },
    expected: false,
  },
  {
    name: 'inactive at 1x is disengaged',
    config: { active: false, slow: 1 },
    expected: false,
  },
  {
    name: 'active at exactly 1x is disengaged',
    config: { active: true, slow: 1 },
    expected: false,
  },
  {
    name: 'active just below 1x is engaged',
    config: { active: true, slow: 0.99 },
    expected: true,
  },
  {
    name: 'active below 1x is engaged',
    config: { active: true, slow: 0.8 },
    expected: true,
  },
  {
    name: 'active just above 1x is engaged',
    config: { active: true, slow: 1.01 },
    expected: true,
  },
  {
    name: 'active above 1x is engaged',
    config: { active: true, slow: 1.2 },
    expected: true,
  },
  {
    name: 'a slow below the floor clamps to a non-1x rate',
    config: { active: true, slow: 0.5 },
    expected: true,
  },
  {
    name: 'a slow above the ceiling clamps to a non-1x rate',
    config: { active: true, slow: 5 },
    expected: true,
  },
  {
    name: 'a non-finite slow clamps to 1x',
    config: { active: true, slow: NaN },
    expected: false,
  },
  {
    name: 'a slow that rounds to 1x is disengaged',
    config: { active: true, slow: 1.001 },
    expected: false,
  },
];

test.describe('isSlowEngaged', () => {
  for (const { name, config, expected } of slowCases) {
    test(name, () => {
      expect(isSlowEngaged(config)).toBe(expected);
    });
  }
});

const reverbCases: {
  name: string;
  config: { active: boolean; reverbIntensity: number };
  expected: boolean;
}[] = [
  {
    name: 'inactive at 0.5 intensity is disengaged',
    config: { active: false, reverbIntensity: 0.5 },
    expected: false,
  },
  {
    name: 'inactive at 0 intensity is disengaged',
    config: { active: false, reverbIntensity: 0 },
    expected: false,
  },
  {
    name: 'active at 0 intensity is disengaged',
    config: { active: true, reverbIntensity: 0 },
    expected: false,
  },
  {
    name: 'active just above 0 is engaged',
    config: { active: true, reverbIntensity: 0.01 },
    expected: true,
  },
  {
    name: 'active at a partial intensity is engaged',
    config: { active: true, reverbIntensity: 0.5 },
    expected: true,
  },
  {
    name: 'active at full intensity is engaged',
    config: { active: true, reverbIntensity: 1 },
    expected: true,
  },
  {
    name: 'a negative intensity clamps to 0',
    config: { active: true, reverbIntensity: -1 },
    expected: false,
  },
  {
    name: 'an intensity above the ceiling clamps to 1',
    config: { active: true, reverbIntensity: 2 },
    expected: true,
  },
  {
    name: 'a non-finite intensity clamps to 0',
    config: { active: true, reverbIntensity: NaN },
    expected: false,
  },
  {
    name: 'an intensity that rounds to 0 is disengaged',
    config: { active: true, reverbIntensity: 0.001 },
    expected: false,
  },
];

test.describe('isReverbEngaged', () => {
  for (const { name, config, expected } of reverbCases) {
    test(name, () => {
      expect(isReverbEngaged(config)).toBe(expected);
    });
  }
});
