import * as z from 'zod';

import type { LyricCandidate } from '../types';

export enum ProviderNames {
  YTMusic = 'YTMusic',
  LRCLib = 'LRCLib',
  MusixMatch = 'MusixMatch',
  LyricsGenius = 'LyricsGenius',
  // Megalobiz = 'Megalobiz',
}

export const ProviderNameSchema = z.enum(ProviderNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export const providerNames = ProviderNameSchema.options;

export type ProviderState = {
  state: 'fetching' | 'done' | 'error';
  candidates: LyricCandidate[];
  error: Error | null;
};
