declare module '@jellybrick/mpris-service' {
  import { EventEmitter } from 'events';

  import { type interface as dbusInterface } from '@jellybrick/dbus-next';

  interface RootInterfaceOptions {
    identity?: string;
    supportedUriSchemes?: string[];
    supportedMimeTypes?: string[];
    desktopEntry?: string;
  }

  export interface Track {
    'mpris:trackid'?: string;
    'mpris:length'?: number;
    'mpris:artUrl'?: string;
    'xesam:album'?: string;
    'xesam:albumArtist'?: string[];
    'xesam:artist'?: string[];
    'xesam:asText'?: string;
    'xesam:audioBPM'?: number;
    'xesam:autoRating'?: number;
    'xesam:comment'?: string[];
    'xesam:composer'?: string[];
    'xesam:contentCreated'?: string;
    'xesam:discNumber'?: number;
    'xesam:firstUsed'?: string;
    'xesam:genre'?: string[];
    'xesam:lastUsed'?: string;
    'xesam:lyricist'?: string[];
    'xesam:title'?: string;
    'xesam:trackNumber'?: number;
    'xesam:url'?: string;
    'xesam:useCount'?: number;
    'xesam:userRating'?: number;
  }

  export type PlayBackStatus = 'Playing' | 'Paused' | 'Stopped';

  export type LoopStatus = 'None' | 'Track' | 'Playlist';

  export const PLAYBACK_STATUS_PLAYING: 'Playing';
  export const PLAYBACK_STATUS_PAUSED: 'Paused';
  export const PLAYBACK_STATUS_STOPPED: 'Stopped';

  export const LOOP_STATUS_NONE: 'None';
  export const LOOP_STATUS_TRACK: 'Track';
  export const LOOP_STATUS_PLAYLIST: 'Playlist';

  export type Interfaces = 'player' | 'trackList' | 'playlists';

  export interface AdditionalPlayerOptions {
    name: string;
    supportedInterfaces: Interfaces[];
  }

  export type PlayerOptions = RootInterfaceOptions & AdditionalPlayerOptions;

  export interface Position {
    trackId: string;
    position: number;
  }

  declare class Player extends EventEmitter {
    constructor(opts: {
      name: string;
      identity: string;
      supportedMimeTypes?: string[];
      supportedInterfaces?: string[];
    });

    //RootInterface
    on(event: 'quit', listener: () => void): this;
    on(event: 'raise', listener: () => void): this;
    on(
      event: 'fullscreen',
      listener: (fullscreenEnabled: boolean) => void,
    ): this;

    emit(type: string, ...args: unknown[]): unknown;

    name: string;
    identity: string;
    fullscreen?: boolean;
    supportedUriSchemes: string[];
    supportedMimeTypes: string[];
    canQuit: boolean;
    canRaise: boolean;
    canUsePlayerControls?: boolean;
    desktopEntry?: string;
    hasTrackList: boolean;

    // PlayerInterface
    on(event: 'next', listener: () => void): this;
    on(event: 'previous', listener: () => void): this;
    on(event: 'pause', listener: () => void): this;
    on(event: 'playpause', listener: () => void): this;
    on(event: 'stop', listener: () => void): this;
    on(event: 'play', listener: () => void): this;
    on(event: 'seek', listener: (offset: number) => void): this;
    on(event: 'open', listener: ({ uri: string }) => void): this;
    on(event: 'loopStatus', listener: (status: LoopStatus) => void): this;
    on(event: 'rate', listener: () => void): this;
    on(event: 'shuffle', listener: (enableShuffle: boolean) => void): this;
    on(event: 'volume', listener: (newVolume: number) => void): this;
    on(event: 'position', listener: (position: Position) => void): this;

    playbackStatus: PlayBackStatus;
    loopStatus: LoopStatus;
    shuffle: boolean;
    metadata: Track;
    volume: number;
    canControl: boolean;
    canPause: boolean;
    canPlay: boolean;
    canSeek: boolean;
    canGoNext: boolean;
    canGoPrevious: boolean;
    rate: number;
    minimumRate: number;
    maximumRate: number;

    abstract getPosition(): number;

    seeked(position: number): void;

    // TracklistInterface
    on(event: 'addTrack', listener: () => void): this;
    on(event: 'removeTrack', listener: () => void): this;
    on(event: 'goTo', listener: () => void): this;

    tracks: Track[];
    canEditTracks: boolean;

    on(event: '*', a: unknown[]): this;

    addTrack(track: string): void;

    removeTrack(trackId: string): void;

    // PlaylistsInterface
    on(event: 'activatePlaylist', listener: () => void): this;

    playlists: Playlist[];
    activePlaylist: string;

    setPlaylists(playlists: Playlist[]): void;

    setActivePlaylist(playlistId: string): void;

    // Player methods
    constructor(opts: PlayerOptions);

    on(event: 'error', listener: (error: Error) => void): this;

    init(opts: RootInterfaceOptions): void;

    objectPath(subpath?: string): string;

    getPosition(): number;

    seeked(position: number): void;

    getTrackIndex(trackId: string): number;

    getTrack(trackId: string): Track;

    addTrack(track: Track): void;

    removeTrack(trackId: string): void;

    getPlaylistIndex(playlistId: string): number;

    setPlaylists(playlists: Track[]): void;

    setActivePlaylist(playlistId: string): void;
  }

  export interface MprisInterface extends dbusInterface.Interface {
    setProperty(property: string, valuePlain: unknown): void;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface RootInterface {}

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface PlayerInterface {}

  export interface TracklistInterface {
    TrackListReplaced(tracks: Track[]): void;

    TrackAdded(afterTrack: string): void;

    TrackRemoved(trackId: string): void;
  }

  export interface PlaylistsInterface {
    PlaylistChanged(playlist: unknown[]): void;

    setActivePlaylistId(playlistId: string): void;
  }

  export default Player;
}
