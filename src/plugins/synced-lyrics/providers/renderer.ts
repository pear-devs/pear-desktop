import { ProviderNames } from './index';
import { LRCLib } from './LRCLib';
import { LyricsGenius } from './LyricsGenius';
import { YTMusic } from './YTMusic';

export const providers = {
  [ProviderNames.YTMusic]: new YTMusic(),
  [ProviderNames.LRCLib]: new LRCLib(),
  [ProviderNames.LyricsGenius]: new LyricsGenius(),
  // [ProviderNames.Megalobiz]: new Megalobiz(), // Disabled because it is too unstable and slow
} as const;
