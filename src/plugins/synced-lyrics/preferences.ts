import { providerNames, type ProviderName } from './providers';

import type { SourceChoice } from './search/ranking';

export const normalizePreferredProvider = (
  value: unknown,
): 'auto' | ProviderName =>
  providerNames.includes(value as ProviderName)
    ? (value as ProviderName)
    : 'auto';

export const migratePreferredProvider = async (
  value: unknown,
  persist: (config: {
    preferredProvider: 'auto' | ProviderName;
  }) => void | Promise<void>,
) => {
  const preferredProvider = normalizePreferredProvider(value);
  if (value !== preferredProvider) await persist({ preferredProvider });
  return preferredProvider;
};

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const readSongChoice = (
  storage: Storage,
  videoId: string,
): SourceChoice | null => {
  const key = `ytmd-sl-starred-${videoId}`;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      !('provider' in value) ||
      typeof value.provider !== 'string' ||
      !value.provider
    )
      return null;
    if ('kind' in value && value.kind !== 'source') return null;
    const candidateId = 'candidateId' in value ? value.candidateId : null;
    if (candidateId !== null && typeof candidateId !== 'string') return null;
    const choice: SourceChoice = {
      kind: 'source',
      provider: value.provider,
      candidateId,
    };
    // Upgrade old provider-only stars without pretending they chose a variant.
    storage.setItem(key, JSON.stringify(choice));
    return choice;
  } catch {
    return null;
  }
};
export const writeSongChoice = (
  storage: Storage,
  videoId: string,
  choice: SourceChoice | null,
) => {
  const key = `ytmd-sl-starred-${videoId}`;
  if (choice) storage.setItem(key, JSON.stringify(choice));
  else storage.removeItem(key);
};
