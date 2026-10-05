import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';

const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('clean removes only fixed build outputs and tolerates missing paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'pear-clean-'));
  try {
    for (const target of ['dist', 'pack', '.vite-inspect']) {
      mkdirSync(join(root, target, 'nested'), { recursive: true });
      writeFileSync(join(root, target, 'nested', '.fixture'), 'generated');
    }
    writeFileSync(join(root, 'keep.txt'), 'preserved');
    const clean = () => execSync(scripts.clean, { cwd: root });
    clean();
    clean();
    for (const target of ['dist', 'pack', '.vite-inspect']) {
      expect(existsSync(join(root, target))).toBe(false);
    }
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('preserved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean unlinks output symlinks without deleting their targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'pear-clean-'));
  try {
    const outside = join(root, 'preserved');
    mkdirSync(outside);
    writeFileSync(join(outside, 'fixture'), 'preserved');
    for (const target of ['dist', 'pack', '.vite-inspect']) {
      symlinkSync(
        outside,
        join(root, target),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    execSync(scripts.clean, { cwd: root });
    expect(readFileSync(join(outside, 'fixture'), 'utf8')).toBe('preserved');
    for (const target of ['dist', 'pack', '.vite-inspect']) {
      expect(existsSync(join(root, target))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
