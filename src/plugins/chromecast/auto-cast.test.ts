import { expect, test } from '@playwright/test';

import { savedCastReceiver, shouldAutoCast } from './auto-cast';

const device = {
  lastReceiverId: 'office-speaker',
  lastAppId: 'CC1AD845',
};

test('auto cast requires explicit opt-in and a valid saved receiver', () => {
  expect(shouldAutoCast(undefined)).toBe(false);
  expect(shouldAutoCast(device)).toBe(false);
  expect(shouldAutoCast({ ...device, autoCastOnStartup: true })).toBe(true);
  expect(
    shouldAutoCast({ ...device, autoCastOnStartup: true, enabled: false }),
  ).toBe(false);
  expect(
    shouldAutoCast({ ...device, autoCastOnStartup: true, lastAppId: '' }),
  ).toBe(false);
});

test('an explicit disconnect suppresses reconnect until the next manual connection', () => {
  expect(
    shouldAutoCast({
      ...device,
      autoCastOnStartup: true,
      autoReconnectSuppressed: true,
    }),
  ).toBe(false);
  expect(shouldAutoCast({ ...device, autoCastOnStartup: true })).toBe(true);
});

test('saved receiver rejects malformed device IDs and app IDs', () => {
  expect(savedCastReceiver(device)).toEqual({
    id: 'office-speaker',
    appId: 'CC1AD845',
  });
  expect(
    savedCastReceiver({ ...device, lastReceiverId: '../office' }),
  ).toBeNull();
  expect(savedCastReceiver({ ...device, lastAppId: 'CC1AD845\0' })).toBeNull();
});
