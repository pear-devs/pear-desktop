import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  configureWindowsPortablePaths,
  getWindowsPortableDir,
} from '../src/config/portable';

test('portable setup is restricted to the Windows main process', ({}, testInfo) => {
  const portableDir = testInfo.outputPath('portable-exe');
  const runtimes = [
    ['win32', 'renderer', portableDir],
    ['linux', 'browser', portableDir],
    ['darwin', 'browser', portableDir],
    ['win32', 'browser', undefined],
  ] as const;

  for (const [platform, processType, executableDir] of runtimes) {
    expect(
      getWindowsPortableDir(platform, processType, executableDir),
    ).toBeUndefined();
  }
  expect(getWindowsPortableDir('win32', 'browser', portableDir)).toBe(
    portableDir,
  );
  expect(fs.existsSync(portableDir)).toBe(false);
});

test('portable data paths are prepared beside the executable', ({}, testInfo) => {
  const portableDir = testInfo.outputPath('portable-exe');
  fs.mkdirSync(portableDir);
  const paths = new Map<string, string>();

  configureWindowsPortablePaths(portableDir, (name, value) =>
    paths.set(name, value),
  );

  const userData = path.join(portableDir, 'user-data');
  expect([...paths.entries()]).toEqual([
    ['userData', userData],
    ['sessionData', userData],
    ['logs', path.join(userData, 'logs')],
    ['crashDumps', path.join(userData, 'crash-dumps')],
  ]);
  expect(fs.statSync(paths.get('logs')!).isDirectory()).toBe(true);
  expect(fs.statSync(paths.get('crashDumps')!).isDirectory()).toBe(true);
  expect(fs.readdirSync(userData)).not.toContain('.writable-test');
  expect(
    fs
      .readdirSync(userData)
      .filter((entry) => entry.startsWith('.writable-test-')),
  ).toEqual([]);
});

test('an existing read-only probe is preserved', ({}, testInfo) => {
  const portableDir = testInfo.outputPath('portable-exe');
  const userData = path.join(portableDir, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  const existingProbe = path.join(userData, '.writable-test');
  fs.writeFileSync(existingProbe, 'existing settings');
  fs.chmodSync(existingProbe, 0o444);
  const paths = new Map<string, string>();

  try {
    configureWindowsPortablePaths(portableDir, (name, value) =>
      paths.set(name, value),
    );

    expect(paths.get('userData')).toBe(userData);
    expect(fs.readFileSync(existingProbe, 'utf8')).toBe('existing settings');
    expect(
      fs
        .readdirSync(userData)
        .filter((entry) => entry.startsWith('.writable-test-')),
    ).toEqual([]);
  } finally {
    fs.chmodSync(existingProbe, 0o666);
  }
});

for (const occupied of ['user-data', 'logs', 'crash-dumps']) {
  test(`a file occupying ${occupied} aborts setup`, ({}, testInfo) => {
    const portableDir = testInfo.outputPath('portable-exe');
    const userData = path.join(portableDir, 'user-data');
    const occupiedPath =
      occupied === 'user-data' ? userData : path.join(userData, occupied);
    fs.mkdirSync(path.dirname(occupiedPath), { recursive: true });
    fs.writeFileSync(occupiedPath, 'do not overwrite');
    const paths: string[] = [];

    expect(() =>
      configureWindowsPortablePaths(portableDir, (name) => paths.push(name)),
    ).toThrow();
    expect(paths).toEqual([]);
    expect(fs.readFileSync(occupiedPath, 'utf8')).toBe('do not overwrite');
  });
}

test('path override failures propagate instead of falling back', ({}, testInfo) => {
  const portableDir = testInfo.outputPath('portable-exe');
  fs.mkdirSync(portableDir);

  expect(() =>
    configureWindowsPortablePaths(portableDir, () => {
      throw new Error('path override failed');
    }),
  ).toThrow('path override failed');
});
