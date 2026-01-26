import { ProviderNames } from './index';
import { YTMusic } from './YTMusic';
import { LRCLib } from './LRCLib';
import { MusixMatch } from './MusixMatch';
import { LyricsGenius } from './LyricsGenius';

export const providers = {
  [ProviderNames.YTMusic]: new YTMusic(),
  [ProviderNames.LRCLib]: new LRCLib(),
  [ProviderNames.MusixMatch]: new MusixMatch(),
  [ProviderNames.LyricsGenius]: new LyricsGenius(),
  // [ProviderNames.Megalobiz]: new Megalobiz(), // Disabled because it is too unstable and slow
} as const;
