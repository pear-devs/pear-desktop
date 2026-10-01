import type { QueueItem } from '@/types/datahost-get-state';
import type { PlayerOverlays } from '@/types/player-api-events';

export interface QueueResponse {
  requestId?: string;
  items?: QueueItem[];
  autoPlaying?: boolean;
  continuation?: string;
}

export interface WatchNextResponse {
  playerOverlays?: PlayerOverlays;
}
