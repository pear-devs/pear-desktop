import { test, expect } from '@playwright/test';

import { PagedAudio } from './paged-audio';

const values = (...numbers: number[]) => new Float32Array(numbers);

test('writes and reads across page boundaries', () => {
  const audio = new PagedAudio(1, 4, 20);
  audio.write(0, 2, values(1, 2, 3, 4, 5, 6));
  expect([...audio.read(0, 0, 10)]).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 0, 0]);
});

test('adds with a weight', () => {
  const audio = new PagedAudio(1, 4, 20);
  audio.add(0, 3, values(1, 1, 1), (i) => i + 1);
  audio.add(0, 3, values(1, 1, 1));
  expect([...audio.read(0, 3, 3)]).toEqual([2, 3, 4]);
});

test('drops pages outside the window and skips writes there', () => {
  const audio = new PagedAudio(2, 4, 40);
  audio.write(0, 0, new Float32Array(40).fill(1));
  expect(audio.pageCount).toBe(10);

  audio.setWindow(2, 3);
  expect(audio.pageCount).toBe(2);
  expect(audio.holds(8, 16)).toBe(true);
  expect(audio.holds(4, 12)).toBe(false);
  expect([...audio.read(0, 6, 4)]).toEqual([0, 0, 1, 1]);

  audio.write(1, 0, new Float32Array(40).fill(2));
  expect(audio.pageCount).toBe(2);
});

test('ignores samples past the end', () => {
  const audio = new PagedAudio(1, 4, 6);
  audio.write(0, 4, values(1, 2, 3, 4));
  expect([...audio.read(0, 4, 4)]).toEqual([1, 2, 0, 0]);
  expect(audio.holds(4, 6)).toBe(true);
});
