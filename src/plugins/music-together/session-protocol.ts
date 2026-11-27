import type { Permission, VideoData } from './types';

export type QueueCommand =
  | { kind: 'add'; videoIds: string[]; before: string | null }
  | { kind: 'remove'; entryId: string }
  | { kind: 'move'; entryId: string; before: string | null }
  | { kind: 'select'; entryId: string }
  | { kind: 'next' };

export type RemoveFailure = 'permission' | 'failed';

export type PlaybackTarget = {
  videoId?: string;
  playlistId?: string;
  params?: string;
};

export type SessionCommand =
  | QueueCommand
  | ({ kind: 'queue-media'; placement: 'next' | 'end' } & (
      | { videoId: string; playlistId?: never }
      | { playlistId: string; videoId?: never }
    ))
  | ({ kind: 'navigate' } & PlaybackTarget)
  | { kind: 'playback'; entryId: string; state?: 1 | 2; position?: number };

export type SessionState = {
  sequence: number;
  queueRevision: number;
  queue?: VideoData[];
  permission: Permission;
  playback: {
    entryId: string;
    videoId: string;
    position: number;
    state: number;
    seekRevision: number;
  } | null;
};
