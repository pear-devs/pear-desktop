import type { WatchNextResponse } from '@/types/music-player-desktop-internal';

export interface AlbumDetails {
  responseContext: ResponseContext;
  contents: Contents;
  currentVideoEndpoint: CurrentVideoEndpoint;
  trackingParams: string;
  playerOverlays: PlayerOverlays;
  videoReporting: VideoReporting;
}

export interface Contents {
  singleColumnMusicWatchNextResultsRenderer: SingleColumnMusicWatchNextResultsRenderer;
}

export interface SingleColumnMusicWatchNextResultsRenderer {
  tabbedRenderer: TabbedRenderer;
}

export interface TabbedRenderer {
  watchNextTabbedResultsRenderer: WatchNextTabbedResultsRenderer;
}

export interface WatchNextTabbedResultsRenderer {
  tabs: Tab[];
}

export interface Tab {
  tabRenderer: TabRenderer;
}

export interface TabRenderer {
  title: string;
  content?: Content;
  trackingParams: string;
  endpoint?: Endpoint;
}

export interface Content {
  musicQueueRenderer: MusicQueueRenderer;
}

export interface MusicQueueRenderer {
  hack: boolean;
}

export interface Endpoint {
  clickTrackingParams: string;
  browseEndpoint: BrowseEndpoint;
}

export interface BrowseEndpoint {
  browseId: string;
  browseEndpointContextSupportedConfigs: BrowseEndpointContextSupportedConfigs;
}

export interface BrowseEndpointContextSupportedConfigs {
  browseEndpointContextMusicConfig: BrowseEndpointContextMusicConfig;
}

export interface BrowseEndpointContextMusicConfig {
  pageType: string;
}

export interface CurrentVideoEndpoint {
  clickTrackingParams: string;
  watchEndpoint: WatchEndpoint;
}

export interface WatchEndpoint {
  videoId: string;
  playlistId: string;
  index: number;
  playlistSetVideoId: string;
  loggingContext: LoggingContext;
}

export interface LoggingContext {
  vssLoggingContext: VssLoggingContext;
}

export interface VssLoggingContext {
  serializedContextData: string;
}

export interface PlayerOverlays {
  playerOverlayRenderer: PlayerOverlayRenderer;
}

export interface PlayerOverlayRenderer {
  actions: PlayerOverlayRendererAction[];
  browserMediaSession: BrowserMediaSession;
}

export interface PlayerOverlayRendererAction {
  likeButtonRenderer: LikeButtonRenderer;
}

export interface LikeButtonRenderer {
  target: Target;
  likeStatus: string;
  trackingParams: string;
  likesAllowed: boolean;
  serviceEndpoints: ServiceEndpoint[];
}

export interface ServiceEndpoint {
  clickTrackingParams: string;
  likeEndpoint: LikeEndpoint;
}

export interface LikeEndpoint {
  status: string;
  target: Target;
  actions?: LikeEndpointAction[];
  likeParams?: string;
  dislikeParams?: string;
  removeLikeParams?: string;
}

export interface LikeEndpointAction {
  clickTrackingParams: string;
  musicLibraryStatusUpdateCommand: MusicLibraryStatusUpdateCommand;
}

export interface MusicLibraryStatusUpdateCommand {
  libraryStatus: string;
  addToLibraryFeedbackToken: string;
}

export interface Target {
  videoId: string;
}

export interface BrowserMediaSession {
  browserMediaSessionRenderer: BrowserMediaSessionRenderer;
}

export interface BrowserMediaSessionRenderer {
  album: Title;
  thumbnailDetails: ThumbnailDetails;
}

export interface Title {
  runs: TitleRun[];
}

export interface TitleRun {
  text: string;
}

export interface ThumbnailDetails {
  thumbnails: Thumbnail[];
}

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export interface ResponseContext {
  serviceTrackingParams: ServiceTrackingParam[];
}

export interface ServiceTrackingParam {
  service: string;
  params: Param[];
}

export interface Param {
  key: string;
  value: string;
}

export interface VideoReporting {
  reportFormModalRenderer: ReportFormModalRenderer;
}

export interface ReportFormModalRenderer {
  optionsSupportedRenderers: OptionsSupportedRenderers;
  trackingParams: string;
  title: Title;
  submitButton: Button;
  cancelButton: Button;
  footer: Footer;
}

export interface Button {
  buttonRenderer: ButtonRenderer;
}

export interface ButtonRenderer {
  style: string;
  isDisabled: boolean;
  text: Title;
  trackingParams: string;
}

export interface Footer {
  runs: FooterRun[];
}

export interface FooterRun {
  text: string;
  navigationEndpoint?: NavigationEndpoint;
}

export interface NavigationEndpoint {
  clickTrackingParams: string;
  urlEndpoint: URLEndpoint;
}

export interface URLEndpoint {
  url: string;
}

export interface OptionsSupportedRenderers {
  optionsRenderer: OptionsRenderer;
}

export interface OptionsRenderer {
  items: Item[];
  trackingParams: string;
}

export interface Item {
  optionSelectableItemRenderer: OptionSelectableItemRenderer;
}

export interface OptionSelectableItemRenderer {
  text: Title;
  trackingParams: string;
  submitEndpoint: SubmitEndpoint;
}

export interface SubmitEndpoint {
  clickTrackingParams: string;
  flagEndpoint: FlagEndpoint;
}

export interface FlagEndpoint {
  flagAction: string;
}

// see song-info-front.ts
export type VideoDataChangeValue = Record<string, unknown> & {
  videoId: string;
  title: string;
  author: string;

  playlistId: string;
  isUpcoming: boolean;
  loading: boolean;

  lengthSeconds: number;

  /**
   * Internal variable (for album data)
   **/
  ['\u0079\u0074\u006d\u0064WatchNextResponse']?: WatchNextResponse;
};

export interface PlayerAPIEvents {
  videodatachange: {
    value: VideoDataChangeValue;
    name: 'dataloaded' | 'dataupdated';
  };
  onStateChange: number;
}
