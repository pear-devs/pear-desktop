import { ProviderNames } from './index';
import { LRCLib } from './LRCLib';
import { LyricsGenius } from './LyricsGenius';
import { MusixMatch } from './MusixMatch';
import { YTMusic } from './YTMusic';

export const providers = {
  [ProviderNames.YTMusic]: new YTMusic(),
  [ProviderNames.LRCLib]: new LRCLib(),
  [ProviderNames.MusixMatch]: new MusixMatch(),
  [ProviderNames.LyricsGenius]: new LyricsGenius(),
  // [ProviderNames.Megalobiz]: new Megalobiz(), // Disabled because it is too unstable and slow
} as const;
