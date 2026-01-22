// TODO: fully type definitions for music-player

import type { VideoDetails } from './video-details';
import type { GetPlayerResponse } from './get-player-response';
import type { PlayerAPIEvents } from './player-api-events';
import type { WatchNextResponse } from '@/types/music-player-desktop-internal';

export interface MusicPlayer {
  getInternalApiInterface: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getApiInterface: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  cueVideoByPlayerVars: () => void;
  loadVideoByPlayerVars: () => void;
  preloadVideoByPlayerVars: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getAdState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  sendAbandonmentPing: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setLoopRange: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getLoopRange: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setAutonavState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  seekToLiveHead: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  requestSeekToWallTimeSeconds: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  seekToStreamTime: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  startSeekCsiAction: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getStreamTimeOffset: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getVideoData: () => VideoDetails;
  setInlinePreview: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateDownloadState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  queueOfflineAction: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  pauseVideoDownload: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  resumeVideoDownload: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  refreshAllStaleEntities: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isOrchestrationLeader: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getAppState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateLastActiveTime: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setBlackout: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setUserEngagement: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateSubtitlesUserSettings: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getPresentingPlayerType: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  canPlayType: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updatePlaylist: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateVideoData: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateEnvironmentData: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  sendVideoStatsEngageEvent: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  productsInVideoVisibilityUpdated: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setSafetyMode: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isAtLiveHead: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getVideoAspectRatio: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getPreferredQuality: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getPlaybackQualityLabel: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setPlaybackQualityRange: (quality: string) => void;
  onAdUxClicked: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getFeedbackProductData: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getStoryboardFrame: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getStoryboardFrameIndex: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getStoryboardLevel: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getNumberOfStoryboardLevels: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getCaptionWindowContainerId: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getAvailableQualityLabels: () => string[];
  addUtcCueRange: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  showAirplayPicker: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  dispatchReduxAction: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getPlayerResponse: () => GetPlayerResponse;
  getHeartbeatResponse: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  changeMarkerVisibility: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setAutonav: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isNotServable: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  channelSubscribed: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  channelUnsubscribed: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  togglePictureInPicture: () => void;
  supportsGaplessAudio: () => boolean;
  supportsGaplessShorts: () => boolean;
  enqueueVideoByPlayerVars: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  clearQueue: () => void;
  getAudioTrack: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setAudioTrack: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getAvailableAudioTracks: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getMaxPlaybackQuality: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getUserPlaybackQualityPreference: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getSubtitlesUserSettings: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  resetSubtitlesUserSettings: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setMinimized: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setOverlayVisibility: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  confirmYpcRental: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  toggleSubtitlesOn: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isSubtitlesOn: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  queueNextVideo: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  handleExternalCall: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  logApiCall: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isExternalMethodAvailable: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setScreenLayer: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getCurrentPlaylistSequence: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getPlaylistSequenceForTime: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  shouldSendVisibilityState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  syncVolume: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  highlightSettingsMenuItem: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  openSettingsMenuItem: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getVisibilityState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  isMutedByMutedAutoplay: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setGlobalCrop: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setInternalSize: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  seekBy: (seconds: number) => void;
  showControls: () => void;
  hideControls: () => void;
  cancelPlayback: () => void;
  getProgressState: () => {
    airingEnd: number;
    airingStart: number;
    allowSeeking: boolean;
    clipEnd: number;
    clipStart: number;
    current: number;
    displayedStart: number;
    duration: number;
    ingestionTime: number;
    isAtLiveHead: boolean;
    loaded: number;
    offset: number;
    seekableEnd: number;
    seekableStart: number;
    viewerLivestreamJoinMediaTime: number;
  };
  isInline: () => boolean;
  setInline: (isInline: boolean) => void;
  setLoopVideo: (value: boolean) => void;
  getLoopVideo: () => boolean;
  getVideoContentRect: <Return>() => Return;
  getVideoStats: <Return>() => Return;
  getStoryboardFormat: <Return>() => Return;
  toggleFullscreen: <Return>() => Return;
  isFullscreen: () => boolean;
  getPlayerSize: <Return>() => Return;
  toggleSubtitles: () => void;
  setCenterCrop: <Parameter>(param: Parameter) => void;
  setFauxFullscreen: <Parameter>(param: Parameter) => void;
  setSizeStyle: <Parameter>(params: Parameter) => void;
  handleGlobalKeyDown: () => void;
  handleGlobalKeyUp: () => void;
  wakeUpControls: () => void;
  cueVideoById: (
    videoId: string,
    startSeconds: number,
    suggestedQuality: string,
  ) => void;
  loadVideoById: (
    videoId: string,
    startSeconds: number,
    suggestedQuality: string,
  ) => void;
  cueVideoByUrl: (
    mediaContentUrl: string,
    startSeconds: number,
    suggestedQuality: string,
    playerType: string,
  ) => void;
  loadVideoByUrl: (
    mediaContentUrl: string,
    startSeconds: number,
    suggestedQuality: string,
    playerType: string,
  ) => void;
  /**
   * Note: This doesn't resume playback, it plays from the start.
   */
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  clearVideo: () => void;
  getVideoBytesLoaded: () => number;
  getVideoBytesTotal: () => number;
  getVideoLoadedFraction: () => number;
  getVideoStartBytes: () => number;
  cuePlaylist: () => void;
  loadPlaylist: () => void;
  nextVideo: () => void;
  previousVideo: () => void;
  playVideoAt: () => void;
  setShuffle: <Parameter>(param: Parameter) => void;
  setLoop: <Parameter>(param: Parameter) => void;
  getPlaylist: <Return extends unknown[]>() => Return;
  getPlaylistIndex: () => number;
  getPlaylistId: () => string | undefined;
  loadModule: (moduleName: string) => void;
  unloadModule: (moduleName: string) => void;
  setOption: <T>(optionName: string, key: string, value: T) => void;
  getOption: <T>(optionName: string, key: string) => T | null | undefined;
  getOptions: () => string[];
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  /**
   * @param volume 0-100
   */
  setVolume: (volume: number) => void;
  getVolume: () => number;
  seekTo: (seconds: number) => void;
  getPlayerMode: <Return>() => Return;
  /**
   * 1: playing
   * 2: paused
   */
  getPlayerState: () => number;
  getAvailablePlaybackRates: () => number[];
  getPlaybackQuality: () => string;
  setPlaybackQuality: (quality: string) => void;
  getAvailableQualityLevels: () => string[];
  /**
   * @return float between start and end in seconds
   */
  getCurrentTime: () => number;
  /**
   * @return int song duration in seconds
   */
  getDuration: () => number;
  addEventListener: <K extends keyof PlayerAPIEvents>(
    type: K,
    listener: (
      this: Document,
      name: K extends 'videodatachange' ? PlayerAPIEvents[K]['name'] : never,
      data: K extends 'videodatachange' ? PlayerAPIEvents[K]['value'] : never,
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  removeEventListener: <K extends keyof PlayerAPIEvents>(
    type: K,
    listener: (
      this: Document,
      name: K extends 'videodatachange' ? PlayerAPIEvents[K]['name'] : never,
      data: K extends 'videodatachange' ? PlayerAPIEvents[K]['value'] : never,
    ) => void,
    options?: boolean | EventListenerOptions,
  ) => void;
  getDebugText: () => string;
  addCueRange: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  removeCueRange: (range: unknown[]) => void;
  setSize: (size: { width: number; height: number }) => void;
  destroy: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getSphericalProperties: <Return>() => Return;
  setSphericalProperties: <Parameter>(param: Parameter) => void;
  mutedAutoplay: () => void;
  /**
   * @return string HTMLIFrameElement
   */
  getVideoEmbedCode: () => string;
  /**
   * @return string full URL of the video (include playlist id)
   */
  getVideoUrl: () => string;
  getMediaReferenceTime: () => number;
  getSize: () => { width: number; height: number };
  logImaAdEvent: (eventType: unknown, breakType: unknown) => void;
  preloadVideoById: (
    videoId: string,
    startSeconds: number,
    suggestedQuality: string,
  ) => void;
  setAccountLinkState: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  updateAccountLinkingConfig: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getAvailableQualityData: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  setCompositeParam: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  getStatsForNerds: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  showVideoInfo: () => void;
  hideVideoInfo: () => void;
  isVideoInfoVisible: () => boolean;
  getPlaybackRate: () => number;
  setPlaybackRate: (playbackRate: number) => void;
  updateFullerscreenEduButtonSubtleModeState: <
    Parameters extends unknown[],
    Return,
  >(
    ...params: Parameters
  ) => Return;
  updateFullerscreenEduButtonVisibility: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;
  addEmbedsConversionTrackingParams: <Parameters extends unknown[], Return>(
    ...params: Parameters
  ) => Return;

  getWatchNextResponse(): WatchNextResponse;
}
