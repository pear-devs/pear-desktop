// pear-desktop's Music Together wire types, kept as they are so its clients and
// this one can share a session.

export type Profile = {
  id: string;
  handleId: string;
  name: string;
  thumbnail: string;
};

export type VideoData = {
  videoId: string;
  ownerId: string;
};

/** host-only: listen only; playlist: change the queue; all: also play, pause and seek. */
export type Permission = "host-only" | "playlist" | "all";

export const PERMISSIONS: readonly Permission[] = ["host-only", "playlist", "all"];

export const getDefaultProfile = (connectionID: string, id: string = Date.now().toString(), name = `Guest ${id.slice(0, 4)}`): Profile => ({
  id: connectionID,
  handleId: `#music-together:${id}`,
  name,
  thumbnail: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
});

export type ConnectionEventMap = {
  CLEAR_QUEUE: null;
  ADD_SONGS: { videoList: VideoData[]; index?: number };
  REMOVE_SONG: { index: number };
  MOVE_SONG: { fromIndex: number; toIndex: number };
  SET_INDEX: { index: number };
  IDENTIFY: { profile: Profile } | undefined;
  SYNC_PROFILE: { profiles: Record<string, Profile> } | undefined;
  SYNC_QUEUE: { videoList: VideoData[] } | undefined;
  SYNC_PROGRESS: { progress?: number; state?: number; index?: number } | undefined;
  PERMISSION: Permission | undefined;
  CONNECTION_CLOSED: null;
};

export type ConnectionEventUnion = {
  [Event in keyof ConnectionEventMap]: {
    type: Event;
    payload: ConnectionEventMap[Event];
    after?: ConnectionEventUnion[];
  };
}[keyof ConnectionEventMap];
