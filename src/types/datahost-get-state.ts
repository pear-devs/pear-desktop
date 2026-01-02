import type { PlayerConfig } from '@/types/get-player-response';

export interface GetState {
  castStatus: CastStatus;
  entities: Entities;
  download: Download;
  likeStatus: LikeStatus;
  multiSelect: MultiSelect;
  navigation: Navigation;
  player: Player;
  playerPage: PlayerPage;
  queue: Queue;
  subscribeStatus: SubscribeStatus;
  toggleStates: ToggleStates;
  ui: UI;
  uploads: Uploads;
}

export interface CastStatus {
  castAvailable: boolean;
  castConnectionData: CastConnectionData;
  remoteWatchEndpoint: null;
}

export interface CastConnectionData {
  castConnectionState: string;
  castReceiverName: string;
}

export interface Download {
  isLeaderTab: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Entities {}

export interface LikeStatus {
  videos: Record<string, LikeType>;
  playlists: Entities;
}

export enum LikeType {
  Dislike = 'DISLIKE',
  Indifferent = 'INDIFFERENT',
  Like = 'LIKE',
}

export interface VolumeState {
  state: number;
  isMuted: boolean;
}

export interface MultiSelect {
  multiSelectedItems: Entities;
  latestMultiSelectIndex: number;
  multiSelectParams: string;
}

export interface Navigation {
  artistDiscographyBrowseCommand: null;
  isLoadingIndicatorShowing: boolean;
  libraryTabBrowseCommand: null;
  mainContent: MainContent;
  playerUiState: string;
  playerPageInfo: PlayerPageInfo;
}

export interface MainContent {
  endpoint: MainContentEndpoint;
  response: Response;
}

export interface MainContentEndpoint {
  data: Data;
  clickTrackingVe: TriggerElement;
  createScreenConfig: null;
  JSC$8515_innertubePath: string;
}

export interface TriggerElement {
  veData: VeData;
  csn: string;
}

export interface VeData {
  veType: number;
  veCounter: number;
}

export interface Data {
  query: string;
  suggestStats: SuggestStats;
}

export interface SuggestStats {
  validationStatus: string;
  parameterValidationStatus: string;
  clientName: string;
  searchMethod: string;
  inputMethods: string[];
  originalQuery: string;
  availableSuggestions: unknown[];
  zeroPrefixEnabled: boolean;
  firstEditTimeMsec: number;
  lastEditTimeMsec: number;
}

export interface Response {
  responseContext: ResponseResponseContext;
  contents: ResponseContents;
  trackingParams: string;
}

export interface ResponseContents {
  tabbedSearchResultsRenderer: TabbedSearchResultsRenderer;
}

export interface TabbedSearchResultsRenderer {
  tabs: TabbedSearchResultsRendererTab[];
}

export interface TabbedSearchResultsRendererTab {
  tabRenderer: PurpleTabRenderer;
}

export interface PurpleTabRenderer {
  title: string;
  selected?: boolean;
  content: PurpleContent;
  tabIdentifier: string;
  trackingParams: string;
  endpoint?: BottomEndpointClass;
}

export interface PurpleContent {
  sectionListRenderer: SectionListRenderer;
}

export interface SectionListRenderer {
  contents?: SectionListRendererContent[];
  trackingParams: string;
  header?: SectionListRendererHeader;
  continuations?: Continuation[];
}

export interface SectionListRendererContent {
  musicCardShelfRenderer?: MusicCardShelfRenderer;
  musicShelfRenderer?: MusicShelfRenderer;
}

export interface MusicCardShelfRenderer {
  trackingParams: string;
  thumbnail: MusicResponsiveListItemRendererThumbnail;
  title: Title;
  subtitle: LongBylineText;
  contents: MusicCardShelfRendererContent[];
  buttons: MusicCardShelfRendererButton[];
  menu: MusicCardShelfRendererMenu;
  onTap: OnTap;
  header: MusicCardShelfRendererHeader;
  thumbnailOverlay: ThumbnailOverlayClass;
}

export interface MusicCardShelfRendererButton {
  buttonRenderer: ButtonButtonRenderer;
}

export interface ButtonButtonRenderer {
  style: string;
  size?: string;
  isDisabled?: boolean;
  text: Subtitle;
  icon: DefaultIconClass;
  accessibility: AccessibilityDataAccessibility;
  trackingParams: string;
  accessibilityData: AccessibilityPauseDataClass;
  command: ButtonRendererCommand;
}

export interface AccessibilityDataAccessibility {
  label: string;
}

export interface AccessibilityPauseDataClass {
  accessibilityData: AccessibilityDataAccessibility;
}

export interface ButtonRendererCommand {
  clickTrackingParams: string;
  watchEndpoint?: CommandWatchEndpoint;
  addToPlaylistEndpoint?: Target;
}

export interface Target {
  videoId: string;
}

export interface CommandWatchEndpoint {
  videoId: string;
  params: string;
  watchEndpointMusicSupportedConfigs: PurpleWatchEndpointMusicSupportedConfigs;
}

export interface PurpleWatchEndpointMusicSupportedConfigs {
  watchEndpointMusicConfig: PurpleWatchEndpointMusicConfig;
}

export interface PurpleWatchEndpointMusicConfig {
  musicVideoType: MusicVideoType;
}

export enum MusicVideoType {
  MusicVideoTypeAtv = 'MUSIC_VIDEO_TYPE_ATV',
  MusicVideoTypeOmv = 'MUSIC_VIDEO_TYPE_OMV',
  MusicVideoTypeUgc = 'MUSIC_VIDEO_TYPE_UGC',
}

export interface DefaultIconClass {
  iconType: IconType;
}

export enum IconType {
  AddToPlaylist = 'ADD_TO_PLAYLIST',
  AddToRemoteQueue = 'ADD_TO_REMOTE_QUEUE',
  Album = 'ALBUM',
  Artist = 'ARTIST',
  Favorite = 'FAVORITE',
  Flag = 'FLAG',
  LibraryAdd = 'LIBRARY_ADD',
  LibrarySaved = 'LIBRARY_SAVED',
  Mix = 'MIX',
  MusicShuffle = 'MUSIC_SHUFFLE',
  Pause = 'PAUSE',
  PlayArrow = 'PLAY_ARROW',
  PlaylistAdd = 'PLAYLIST_ADD',
  QueuePlayNext = 'QUEUE_PLAY_NEXT',
  Remove = 'REMOVE',
  Share = 'SHARE',
  Unfavorite = 'UNFAVORITE',
  VolumeUp = 'VOLUME_UP',
}

export interface Subtitle {
  runs: ShortBylineTextRun[];
}

export interface ShortBylineTextRun {
  text: string;
}

export interface MusicCardShelfRendererContent {
  messageRenderer?: MessageRenderer;
  musicResponsiveListItemRenderer?: PurpleMusicResponsiveListItemRenderer;
}

export interface MessageRenderer {
  text: Subtitle;
  trackingParams: string;
  style: MessageRendererStyle;
}

export interface MessageRendererStyle {
  value: string;
}

export interface PurpleMusicResponsiveListItemRenderer {
  trackingParams: string;
  thumbnail: MusicResponsiveListItemRendererThumbnail;
  overlay: ThumbnailOverlayClass;
  flexColumns: FlexColumn[];
  menu: PurpleMenu;
  playlistItemData: Target;
  flexColumnDisplayStyle: string;
  itemHeight: string;
}

export interface FlexColumn {
  musicResponsiveListItemFlexColumnRenderer: MusicResponsiveListItemFlexColumnRenderer;
}

export interface MusicResponsiveListItemFlexColumnRenderer {
  text: Text;
  displayPriority: DisplayPriority;
}

export enum DisplayPriority {
  MusicResponsiveListItemColumnDisplayPriorityHigh = 'MUSIC_RESPONSIVE_LIST_ITEM_COLUMN_DISPLAY_PRIORITY_HIGH',
}

export interface Text {
  runs: PurpleRun[];
}

export interface PurpleRun {
  text: string;
  navigationEndpoint?: PurpleNavigationEndpoint;
}

export interface PurpleNavigationEndpoint {
  clickTrackingParams: string;
  watchEndpoint?: OnTapWatchEndpoint;
  browseEndpoint?: PurpleBrowseEndpoint;
}

export interface PurpleBrowseEndpoint {
  browseId: string;
  browseEndpointContextSupportedConfigs: BrowseEndpointContextSupportedConfigs;
}

export interface BrowseEndpointContextSupportedConfigs {
  browseEndpointContextMusicConfig: BrowseEndpointContextMusicConfig;
}

export interface BrowseEndpointContextMusicConfig {
  pageType: PageType;
}

export enum PageType {
  MusicPageTypeAlbum = 'MUSIC_PAGE_TYPE_ALBUM',
  MusicPageTypeArtist = 'MUSIC_PAGE_TYPE_ARTIST',
  MusicPageTypePlaylist = 'MUSIC_PAGE_TYPE_PLAYLIST',
  MusicPageTypeTrackLyrics = 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
  MusicPageTypeTrackRelated = 'MUSIC_PAGE_TYPE_TRACK_RELATED',
  MusicPageTypeUserChannel = 'MUSIC_PAGE_TYPE_USER_CHANNEL',
}

export interface OnTapWatchEndpoint {
  videoId: string;
  watchEndpointMusicSupportedConfigs: PurpleWatchEndpointMusicSupportedConfigs;
}

export interface PurpleMenu {
  menuRenderer: PurpleMenuRenderer;
}

export interface PurpleMenuRenderer {
  items: PurpleItem[];
  trackingParams: string;
  accessibility: AccessibilityPauseDataClass;
}

export interface PurpleItem {
  menuNavigationItemRenderer?: MenuItemRenderer;
  menuServiceItemRenderer?: MenuItemRenderer;
  toggleMenuServiceItemRenderer?: PurpleToggleMenuServiceItemRenderer;
}

export interface MenuItemRenderer {
  text: Subtitle;
  icon: DefaultIconClass;
  navigationEndpoint?: MenuNavigationItemRendererNavigationEndpoint;
  trackingParams: string;
  serviceEndpoint?: MenuNavigationItemRendererServiceEndpoint;
}

export interface MenuNavigationItemRendererNavigationEndpoint {
  clickTrackingParams: string;
  watchEndpoint?: PurpleWatchEndpoint;
  addToPlaylistEndpoint?: AddToPlaylistEndpoint;
  browseEndpoint?: PurpleBrowseEndpoint;
  shareEntityEndpoint?: ShareEntityEndpoint;
  watchPlaylistEndpoint?: WatchPlaylistEndpoint;
}

export interface AddToPlaylistEndpoint {
  videoId?: string;
  playlistId?: string;
}

export interface ShareEntityEndpoint {
  serializedShareEntity: string;
  sharePanelType: SharePanelType;
}

export enum SharePanelType {
  SharePanelTypeUnifiedSharePanel = 'SHARE_PANEL_TYPE_UNIFIED_SHARE_PANEL',
}

export interface PurpleWatchEndpoint {
  videoId: string;
  playlistId: string;
  params: string;
  loggingContext: LoggingContext;
  watchEndpointMusicSupportedConfigs: PurpleWatchEndpointMusicSupportedConfigs;
}

export interface LoggingContext {
  vssLoggingContext: VssLoggingContext;
}

export interface VssLoggingContext {
  serializedContextData: string;
}

export interface WatchPlaylistEndpoint {
  playlistId: string;
  params: string;
}

export interface MenuNavigationItemRendererServiceEndpoint {
  clickTrackingParams: string;
  queueAddEndpoint?: QueueAddEndpoint;
  removeFromQueueEndpoint?: RemoveFromQueueEndpoint;
  getReportFormEndpoint?: GetReportFormEndpoint;
}

export interface GetReportFormEndpoint {
  params: string;
}

export interface QueueAddEndpoint {
  queueTarget: AddToPlaylistEndpoint;
  queueInsertPosition: QueueInsertPosition;
  commands: CommandElement[];
}

export interface CommandElement {
  clickTrackingParams: string;
  addToToastAction: AddToToastAction;
}

export interface AddToToastAction {
  item: AddToToastActionItem;
}

export interface AddToToastActionItem {
  notificationTextRenderer: NotificationTextRenderer;
}

export interface NotificationTextRenderer {
  successResponseText: Subtitle;
  trackingParams: string;
}

export enum QueueInsertPosition {
  InsertAfterCurrentVideo = 'INSERT_AFTER_CURRENT_VIDEO',
  InsertAtEnd = 'INSERT_AT_END',
}

export interface RemoveFromQueueEndpoint {
  videoId: string;
  commands: CommandElement[];
  itemId: string;
}

export interface PurpleToggleMenuServiceItemRenderer {
  defaultText: Subtitle;
  defaultIcon: DefaultIconClass;
  defaultServiceEndpoint: PurpleDefaultServiceEndpoint;
  toggledText: Subtitle;
  toggledIcon: DefaultIconClass;
  toggledServiceEndpoint: PurpleToggledServiceEndpoint;
  trackingParams: string;
}

export interface PurpleDefaultServiceEndpoint {
  clickTrackingParams: string;
  feedbackEndpoint?: FeedbackEndpoint;
  likeEndpoint?: PurpleLikeEndpoint;
}

export interface FeedbackEndpoint {
  feedbackToken: string;
}

export interface PurpleLikeEndpoint {
  status: LikeType;
  target: Target;
  actions?: LikeEndpointAction[];
}

export interface LikeEndpointAction {
  clickTrackingParams: string;
  musicLibraryStatusUpdateCommand: MusicLibraryStatusUpdateCommand;
}

export interface MusicLibraryStatusUpdateCommand {
  libraryStatus: string;
  addToLibraryFeedbackToken: string;
}

export interface PurpleToggledServiceEndpoint {
  clickTrackingParams: string;
  feedbackEndpoint?: FeedbackEndpoint;
  likeEndpoint?: FluffyLikeEndpoint;
}

export interface FluffyLikeEndpoint {
  status: LikeType;
  target: Target;
}

export interface ThumbnailOverlayClass {
  musicItemThumbnailOverlayRenderer: ThumbnailOverlayMusicItemThumbnailOverlayRenderer;
}

export interface ThumbnailOverlayMusicItemThumbnailOverlayRenderer {
  background: Background;
  content: FluffyContent;
  contentPosition: string;
  displayStyle: string;
}

export interface Background {
  verticalGradient: VerticalGradient;
}

export interface VerticalGradient {
  gradientLayerColors: string[];
}

export interface FluffyContent {
  musicPlayButtonRenderer: PurpleMusicPlayButtonRenderer;
}

export interface PurpleMusicPlayButtonRenderer {
  playNavigationEndpoint: OnTap;
  trackingParams: string;
  playIcon: DefaultIconClass;
  pauseIcon: DefaultIconClass;
  iconColor: number;
  backgroundColor: number;
  activeBackgroundColor: number;
  loadingIndicatorColor: number;
  playingIcon: DefaultIconClass;
  iconLoadingColor: number;
  activeScaleFactor: number;
  buttonSize: string;
  rippleTarget: string;
  accessibilityPlayData: AccessibilityPauseDataClass;
  accessibilityPauseData: AccessibilityPauseDataClass;
}

export interface OnTap {
  clickTrackingParams: string;
  watchEndpoint: OnTapWatchEndpoint;
}

export interface MusicResponsiveListItemRendererThumbnail {
  musicThumbnailRenderer: MusicThumbnailRenderer;
}

export interface MusicThumbnailRenderer {
  thumbnail: ThumbnailDetailsClass;
  thumbnailCrop: string;
  thumbnailScale: string;
  trackingParams: string;
}

export interface ThumbnailDetailsClass {
  thumbnails: ThumbnailElement[];
}

export interface ThumbnailElement {
  url: string;
  width: number;
  height: number;
}

export interface MusicCardShelfRendererHeader {
  musicCardShelfHeaderBasicRenderer: MusicCardShelfHeaderBasicRenderer;
}

export interface MusicCardShelfHeaderBasicRenderer {
  title: Subtitle;
  trackingParams: string;
}

export interface MusicCardShelfRendererMenu {
  menuRenderer: FluffyMenuRenderer;
}

export interface FluffyMenuRenderer {
  items: FluffyItem[];
  trackingParams: string;
  accessibility: AccessibilityPauseDataClass;
}

export interface FluffyItem {
  menuNavigationItemRenderer?: MenuItemRenderer;
  menuServiceItemRenderer?: MenuItemRenderer;
  toggleMenuServiceItemRenderer?: FluffyToggleMenuServiceItemRenderer;
}

export interface FluffyToggleMenuServiceItemRenderer {
  defaultText: Subtitle;
  defaultIcon: DefaultIconClass;
  defaultServiceEndpoint: PurpleServiceEndpoint;
  toggledText: Subtitle;
  toggledIcon: DefaultIconClass;
  toggledServiceEndpoint: PurpleServiceEndpoint;
  trackingParams: string;
}

export interface PurpleServiceEndpoint {
  clickTrackingParams: string;
  likeEndpoint: FluffyLikeEndpoint;
}

export interface LongBylineText {
  runs: LongBylineTextRun[];
}

export interface LongBylineTextRun {
  text: string;
  navigationEndpoint?: RunEndpoint;
}

export interface RunEndpoint {
  clickTrackingParams: string;
  browseEndpoint: PurpleBrowseEndpoint;
}

export interface Title {
  runs: FluffyRun[];
}

export interface FluffyRun {
  text: string;
  navigationEndpoint: OnTap;
}

export interface MusicShelfRenderer {
  title: Subtitle;
  contents: MusicShelfRendererContent[];
  trackingParams: string;
  bottomText: Subtitle;
  bottomEndpoint: BottomEndpointClass;
  shelfDivider: ShelfDivider;
}

export interface BottomEndpointClass {
  clickTrackingParams: string;
  searchEndpoint: SearchEndpoint;
}

export interface SearchEndpoint {
  query: string;
  params: string;
}

export interface MusicShelfRendererContent {
  musicResponsiveListItemRenderer: FluffyMusicResponsiveListItemRenderer;
}

export interface FluffyMusicResponsiveListItemRenderer {
  trackingParams: string;
  thumbnail: MusicResponsiveListItemRendererThumbnail;
  overlay: PurpleOverlay;
  flexColumns: FlexColumn[];
  menu: FluffyMenu;
  playlistItemData?: Target;
  flexColumnDisplayStyle: string;
  itemHeight: string;
  navigationEndpoint?: RunEndpoint;
}

export interface FluffyMenu {
  menuRenderer: TentacledMenuRenderer;
}

export interface TentacledMenuRenderer {
  items: TentacledItem[];
  trackingParams: string;
  accessibility: AccessibilityPauseDataClass;
}

export interface TentacledItem {
  menuNavigationItemRenderer?: MenuItemRenderer;
  menuServiceItemRenderer?: MenuItemRenderer;
  toggleMenuServiceItemRenderer?: TentacledToggleMenuServiceItemRenderer;
}

export interface TentacledToggleMenuServiceItemRenderer {
  defaultText: Subtitle;
  defaultIcon: DefaultIconClass;
  defaultServiceEndpoint: FluffyDefaultServiceEndpoint;
  toggledText: Subtitle;
  toggledIcon: DefaultIconClass;
  toggledServiceEndpoint: FluffyToggledServiceEndpoint;
  trackingParams: string;
}

export interface FluffyDefaultServiceEndpoint {
  clickTrackingParams: string;
  feedbackEndpoint?: FeedbackEndpoint;
  likeEndpoint?: TentacledLikeEndpoint;
}

export interface TentacledLikeEndpoint {
  status: LikeType;
  target: AddToPlaylistEndpoint;
  actions?: LikeEndpointAction[];
}

export interface FluffyToggledServiceEndpoint {
  clickTrackingParams: string;
  feedbackEndpoint?: FeedbackEndpoint;
  likeEndpoint?: StickyLikeEndpoint;
}

export interface StickyLikeEndpoint {
  status: LikeType;
  target: AddToPlaylistEndpoint;
}

export interface PurpleOverlay {
  musicItemThumbnailOverlayRenderer: PurpleMusicItemThumbnailOverlayRenderer;
}

export interface PurpleMusicItemThumbnailOverlayRenderer {
  background: Background;
  content: TentacledContent;
  contentPosition: string;
  displayStyle: string;
}

export interface TentacledContent {
  musicPlayButtonRenderer: FluffyMusicPlayButtonRenderer;
}

export interface FluffyMusicPlayButtonRenderer {
  playNavigationEndpoint: PlayNavigationEndpoint;
  trackingParams: string;
  playIcon: DefaultIconClass;
  pauseIcon: DefaultIconClass;
  iconColor: number;
  backgroundColor: number;
  activeBackgroundColor: number;
  loadingIndicatorColor: number;
  playingIcon: DefaultIconClass;
  iconLoadingColor: number;
  activeScaleFactor: number;
  buttonSize: string;
  rippleTarget: string;
  accessibilityPlayData: AccessibilityPauseDataClass;
  accessibilityPauseData: AccessibilityPauseDataClass;
}

export interface PlayNavigationEndpoint {
  clickTrackingParams: string;
  watchEndpoint?: OnTapWatchEndpoint;
  watchPlaylistEndpoint?: WatchPlaylistEndpoint;
}

export interface ShelfDivider {
  musicShelfDividerRenderer: MusicShelfDividerRenderer;
}

export interface MusicShelfDividerRenderer {
  hidden: boolean;
}

export interface Continuation {
  reloadContinuationData: ReloadContinuationData;
}

export interface ReloadContinuationData {
  continuation: string;
  clickTrackingParams: string;
}

export interface SectionListRendererHeader {
  chipCloudRenderer: ChipCloudRenderer;
}

export interface ChipCloudRenderer {
  chips: ChipCloudRendererChip[];
  collapsedRowCount: number;
  trackingParams: string;
  horizontalScrollable: boolean;
}

export interface ChipCloudRendererChip {
  chipCloudChipRenderer: PurpleChipCloudChipRenderer;
}

export interface PurpleChipCloudChipRenderer {
  style: ChipCloudChipRendererStyle;
  text: Subtitle;
  navigationEndpoint: BottomEndpointClass;
  trackingParams: string;
  accessibilityData: AccessibilityPauseDataClass;
  isSelected: boolean;
  uniqueId: string;
}

export interface ChipCloudChipRendererStyle {
  styleType: string;
}

export interface ResponseResponseContext {
  serviceTrackingParams: ServiceTrackingParam[];
  maxAgeSeconds: number;
}

export interface ServiceTrackingParam {
  service: string;
  params: Param[];
}

export interface Param {
  key: string;
  value: string;
}

export interface PlayerPageInfo {
  open: boolean;
  triggerElement: TriggerElement;
}

export interface Player {
  adPlaying: boolean;
  captionsAvailable: boolean;
  captionsVisible: boolean;
  fullscreened: boolean;
  miniPlayerEnabled: boolean;
  muted: boolean;
  nerdStatsVisible: boolean;
  playerResponse: PlayerResponse;
  playerTriggerInfo: PlayerTriggerInfo;
  preloadedEndpoint_: null;
  volume: number;
  playbackRate: number;
}

export interface PlayerResponse {
  responseContext: ResponseResponseContext;
  playabilityStatus: PlayabilityStatus;
  streamingData: StreamingData;
  heartbeatParams: HeartbeatParams;
  playbackTracking: PlaybackTracking;
  captions: Captions;
  videoDetails: PlayerResponseVideoDetails;
  annotations: Annotation[];
  playerConfig: PlayerConfig;
  storyboards: Storyboards;
  microformat: Microformat;
  trackingParams: string;
  attestation: Attestation;
  endscreen: Endscreen;
  adBreakHeartbeatParams: string;
}

export interface Annotation {
  playerAnnotationsExpandedRenderer: PlayerAnnotationsExpandedRenderer;
}

export interface PlayerAnnotationsExpandedRenderer {
  featuredChannel: FeaturedChannel;
  allowSwipeDismiss: boolean;
}

export interface FeaturedChannel {
  startTimeMs: string;
  endTimeMs: string;
  watermark: ThumbnailDetailsClass;
  trackingParams: string;
  navigationEndpoint: FeaturedChannelNavigationEndpoint;
  channelName: string;
  subscribeButton: SubscribeButtonClass;
}

export interface FeaturedChannelNavigationEndpoint {
  clickTrackingParams: string;
  browseEndpoint: FluffyBrowseEndpoint;
}

export interface FluffyBrowseEndpoint {
  browseId: string;
}

export interface SubscribeButtonClass {
  subscribeButtonRenderer: SubscribeButtonRenderer;
}

export interface SubscribeButtonRenderer {
  buttonText: Subtitle;
  subscribed: boolean;
  enabled: boolean;
  type: string;
  channelId: string;
  showPreferences: boolean;
  subscribedButtonText: Subtitle;
  unsubscribedButtonText: Subtitle;
  trackingParams: string;
  unsubscribeButtonText: Subtitle;
  serviceEndpoints: SubscribeButtonRendererServiceEndpoint[];
}

export interface SubscribeButtonRendererServiceEndpoint {
  clickTrackingParams: string;
  subscribeEndpoint?: SubscribeEndpoint;
  signalServiceEndpoint?: SignalServiceEndpoint;
}

export interface SignalServiceEndpoint {
  signal: string;
  actions: SignalServiceEndpointAction[];
}

export interface SignalServiceEndpointAction {
  clickTrackingParams: string;
  openPopupAction: OpenPopupAction;
}

export interface OpenPopupAction {
  popup: Popup;
  popupType: string;
}

export interface Popup {
  confirmDialogRenderer: ConfirmDialogRenderer;
}

export interface ConfirmDialogRenderer {
  trackingParams: string;
  dialogMessages: Subtitle[];
  confirmButton: CancelButtonClass;
  cancelButton: CancelButtonClass;
}

export interface CancelButtonClass {
  buttonRenderer: CancelButtonButtonRenderer;
}

export interface CancelButtonButtonRenderer {
  style: string;
  isDisabled: boolean;
  text: Subtitle;
  accessibility?: AccessibilityDataAccessibility;
  trackingParams: string;
  serviceEndpoint?: UnsubscribeCommand;
}

export interface UnsubscribeCommand {
  clickTrackingParams: string;
  unsubscribeEndpoint: SubscribeEndpoint;
}

export interface SubscribeEndpoint {
  channelIds: string[];
  params: string;
}

export interface Attestation {
  playerAttestationRenderer: PlayerAttestationRenderer;
}

export interface PlayerAttestationRenderer {
  challenge: string;
  botguardData: BotguardData;
}

export interface BotguardData {
  program: string;
  interpreterSafeUrl: InterpreterSafeURL;
  serverEnvironment: number;
}

export interface InterpreterSafeURL {
  privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string;
}

export interface Captions {
  playerCaptionsTracklistRenderer: PlayerCaptionsTracklistRenderer;
}

export interface PlayerCaptionsTracklistRenderer {
  captionTracks: CaptionTrack[];
  audioTracks: AudioTrack[];
  translationLanguages: TranslationLanguage[];
  defaultAudioTrackIndex: number;
}

export interface AudioTrack {
  captionTrackIndices: number[];
  defaultCaptionTrackIndex: number;
  visibility: string;
  hasDefaultTrack: boolean;
  captionsInitialState: string;
}

export interface CaptionTrack {
  baseUrl: string;
  name: Subtitle;
  vssId: string;
  languageCode: string;
  kind?: string;
  isTranslatable: boolean;
}

export interface TranslationLanguage {
  languageCode: string;
  languageName: Subtitle;
}

export interface Endscreen {
  endscreenRenderer: EndscreenRenderer;
}

export interface EndscreenRenderer {
  elements: Element[];
  startMs: string;
  trackingParams: string;
}

export interface Element {
  endscreenElementRenderer: EndscreenElementRenderer;
}

export interface EndscreenElementRenderer {
  style: string;
  image: ThumbnailDetailsClass;
  icon?: EndscreenElementRendererIcon;
  left: number;
  width: number;
  top: number;
  aspectRatio: number;
  startMs: string;
  endMs: string;
  title: LengthText;
  metadata: Subtitle;
  callToAction?: Subtitle;
  dismiss?: Subtitle;
  endpoint: EndscreenElementRendererEndpoint;
  hovercardButton?: SubscribeButtonClass;
  trackingParams: string;
  isSubscribe?: boolean;
  useClassicSubscribeButton?: boolean;
  id: string;
  thumbnailOverlays?: ThumbnailOverlay[];
}

export interface EndscreenElementRendererEndpoint {
  clickTrackingParams: string;
  browseEndpoint?: FluffyBrowseEndpoint;
  commandMetadata?: Entities;
  watchEndpoint?: Target;
}

export interface EndscreenElementRendererIcon {
  thumbnails: URLEndpoint[];
}

export interface URLEndpoint {
  url: string;
}

export interface ThumbnailOverlay {
  thumbnailOverlayTimeStatusRenderer: ThumbnailOverlayTimeStatusRenderer;
}

export interface ThumbnailOverlayTimeStatusRenderer {
  text: LengthText;
  style: string;
}

export interface LengthText {
  runs: ShortBylineTextRun[];
  accessibility: AccessibilityPauseDataClass;
}

export interface HeartbeatParams {
  heartbeatToken: string;
  intervalMilliseconds: string;
  maxRetries: string;
  drmSessionId: string;
  softFailOnError: boolean;
  heartbeatServerData: string;
}

export interface Microformat {
  microformatDataRenderer: MicroformatDataRenderer;
}

export interface MicroformatDataRenderer {
  urlCanonical: string;
  title: string;
  description: string;
  thumbnail: ThumbnailDetailsClass;
  siteName: string;
  appName: string;
  androidPackage: string;
  iosAppStoreId: string;
  iosAppArguments: string;
  ogType: string;
  urlApplinksIos: string;
  urlApplinksAndroid: string;
  urlTwitterIos: string;
  urlTwitterAndroid: string;
  twitterCardType: string;
  twitterSiteHandle: string;
  schemaDotOrgType: string;
  noindex: boolean;
  unlisted: boolean;
  paid: boolean;
  familySafe: boolean;
  tags: string[];
  availableCountries: string[];
  pageOwnerDetails: PageOwnerDetails;
  videoDetails: MicroformatDataRendererVideoDetails;
  linkAlternates: LinkAlternate[];
  viewCount: string;
  publishDate: Date;
  category: string;
  uploadDate: Date;
}

export interface LinkAlternate {
  hrefUrl: string;
  title?: string;
  alternateType?: string;
}

export interface PageOwnerDetails {
  name: string;
  externalChannelId: string;
  ['\u0079\u006f\u0075\u0074\u0075\u0062\u0065ProfileUrl']: string;
}

export interface MicroformatDataRendererVideoDetails {
  externalVideoId: string;
  durationSeconds: string;
  durationIso8601: string;
}

export interface PlayabilityStatus {
  status: string;
  playableInEmbed: boolean;
  audioOnlyPlayability: AudioOnlyPlayability;
  miniplayer: Miniplayer;
  contextParams: string;
}

export interface AudioOnlyPlayability {
  audioOnlyPlayabilityRenderer: AudioOnlyPlayabilityRenderer;
}

export interface AudioOnlyPlayabilityRenderer {
  trackingParams: string;
  audioOnlyAvailability: string;
}

export interface Miniplayer {
  miniplayerRenderer: MiniplayerRenderer;
}

export interface MiniplayerRenderer {
  playbackMode: string;
}

export interface PlaybackTracking {
  videostatsPlaybackUrl: PtrackingURLClass;
  videostatsDelayplayUrl: AtrURLClass;
  videostatsWatchtimeUrl: PtrackingURLClass;
  ptrackingUrl: PtrackingURLClass;
  qoeUrl: PtrackingURLClass;
  atrUrl: AtrURLClass;
  videostatsScheduledFlushWalltimeSeconds: number[];
  videostatsDefaultFlushIntervalSeconds: number;
  googleRemarketingUrl: AtrURLClass;
}

export interface AtrURLClass {
  baseUrl: string;
  elapsedMediaTimeSeconds: number;
  headers: HeaderElement[];
}

export interface HeaderElement {
  headerType: HeaderType;
}

export enum HeaderType {
  PlusPageID = 'PLUS_PAGE_ID',
  UserAuth = 'USER_AUTH',
  VisitorID = 'VISITOR_ID',
}

export interface PtrackingURLClass {
  baseUrl: string;
  headers: HeaderElement[];
}

export interface Storyboards {
  playerStoryboardSpecRenderer: PlayerStoryboardSpecRenderer;
}

export interface PlayerStoryboardSpecRenderer {
  spec: string;
  recommendedLevel: number;
}

export interface StreamingData {
  expiresInSeconds: string;
  formats: Format[];
  adaptiveFormats: AdaptiveFormat[];
  probeUrl: string;
}

export interface AdaptiveFormat {
  itag: number;
  mimeType: string;
  bitrate: number;
  width?: number;
  height?: number;
  initRange: Range;
  indexRange: Range;
  lastModified: string;
  contentLength: string;
  quality: string;
  fps?: number;
  qualityLabel?: string;
  projectionType: ProjectionType;
  averageBitrate: number;
  approxDurationMs: string;
  signatureCipher: string;
  colorInfo?: ColorInfo;
  highReplication?: boolean;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  loudnessDb?: number;
}

export interface ColorInfo {
  primaries: string;
  transferCharacteristics: string;
  matrixCoefficients: string;
}

export interface Range {
  start: string;
  end: string;
}

export enum ProjectionType {
  Rectangular = 'RECTANGULAR',
}

export interface Format {
  itag: number;
  mimeType: string;
  bitrate: number;
  width: number;
  height: number;
  lastModified: string;
  quality: string;
  fps: number;
  qualityLabel: string;
  projectionType: ProjectionType;
  audioQuality: string;
  approxDurationMs: string;
  audioSampleRate: string;
  audioChannels: number;
  signatureCipher: string;
}

export interface PlayerResponseVideoDetails {
  videoId: string;
  title: string;
  lengthSeconds: string;
  channelId: string;
  isOwnerViewing: boolean;
  isCrawlable: boolean;
  thumbnail: ThumbnailDetailsClass;
  allowRatings: boolean;
  viewCount: string;
  author: string;
  isPrivate: boolean;
  isUnpluggedCorpus: boolean;
  musicVideoType: MusicVideoType;
  isLiveContent: boolean;
  elapsedSeconds: number;
  isPaused: boolean;
}

export interface PlayerTriggerInfo {
  screenLayer: number;
}

export interface PlayerPage {
  playerOverlay: PlayerOverlay;
  playerPageTabs: PlayerPageTabElement[];
  playerPageTabsContent: Entities;
  playerPageTabSelectedIndex: number;
  playerPageWatchNextAutomixParams: string;
  playerPageWatchNextContinuationParams: string;
  playerPageWatchNextMetadata: null;
  playerPageWatchNextResponse: PlayerPageWatchNextResponse;
  watchNextOverlay: null;
}

export interface PlayerOverlay {
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
  likeStatus: LikeType;
  trackingParams: string;
  likesAllowed: boolean;
  serviceEndpoints: ServiceEndpoint[];
}

export interface ServiceEndpoint {
  clickTrackingParams: string;
  likeEndpoint: ServiceEndpointLikeEndpoint;
}

export interface ServiceEndpointLikeEndpoint {
  status: LikeType;
  target: Target;
  likeParams?: LikeParams;
  dislikeParams?: LikeParams;
  removeLikeParams?: LikeParams;
}

// TODO: Add more
export enum LikeParams {
  Oai3D = 'OAI%3D',
}

export interface BrowserMediaSession {
  browserMediaSessionRenderer: BrowserMediaSessionRenderer;
}

export interface BrowserMediaSessionRenderer {
  thumbnailDetails: ThumbnailDetailsClass;
}

export interface PlayerPageTabElement {
  tabRenderer: PlayerPageTabTabRenderer;
}

export interface PlayerPageTabTabRenderer {
  title: string;
  content?: StickyContent;
  trackingParams: string;
  endpoint?: RunEndpoint;
  unselectable?: boolean;
}

export interface StickyContent {
  musicQueueRenderer: MusicQueueRenderer;
}

export interface MusicQueueRenderer {
  hack: boolean;
}

export interface PlayerPageWatchNextResponse {
  responseContext: PlayerPageWatchNextResponseResponseContext;
  contents: PlayerPageWatchNextResponseContents;
  currentVideoEndpoint: CurrentVideoEndpoint;
  trackingParams: string;
  playerOverlays: PlayerOverlay;
  videoReporting: VideoReporting;
}

export interface PlayerPageWatchNextResponseContents {
  singleColumnMusicWatchNextResultsRenderer: SingleColumnMusicWatchNextResultsRenderer;
}

export interface SingleColumnMusicWatchNextResultsRenderer {
  tabbedRenderer: TabbedRenderer;
}

export interface TabbedRenderer {
  watchNextTabbedResultsRenderer: WatchNextTabbedResultsRenderer;
}

export interface WatchNextTabbedResultsRenderer {
  tabs: PlayerPageTabElement[];
}

export interface CurrentVideoEndpoint {
  clickTrackingParams: string;
  watchEndpoint: CurrentVideoEndpointWatchEndpoint;
}

export interface CurrentVideoEndpointWatchEndpoint {
  videoId: string;
  playlistId: string;
  index: number;
  playlistSetVideoId: string;
  loggingContext: LoggingContext;
}

export interface PlayerPageWatchNextResponseResponseContext {
  serviceTrackingParams: ServiceTrackingParam[];
}

export interface VideoReporting {
  reportFormModalRenderer: ReportFormModalRenderer;
}

export interface ReportFormModalRenderer {
  optionsSupportedRenderers: OptionsSupportedRenderers;
  trackingParams: string;
  title: Subtitle;
  submitButton: CancelButtonClass;
  cancelButton: CancelButtonClass;
  footer: Footer;
}

export interface Footer {
  runs: FooterRun[];
}

export interface FooterRun {
  text: string;
  navigationEndpoint?: FluffyNavigationEndpoint;
}

export interface FluffyNavigationEndpoint {
  clickTrackingParams: string;
  urlEndpoint: URLEndpoint;
}

export interface OptionsSupportedRenderers {
  optionsRenderer: OptionsRenderer;
}

export interface OptionsRenderer {
  items: OptionsRendererItem[];
  trackingParams: string;
}

export interface OptionsRendererItem {
  optionSelectableItemRenderer: OptionSelectableItemRenderer;
}

export interface OptionSelectableItemRenderer {
  text: Subtitle;
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

export type RepeatMode = 'NONE' | 'ONE' | 'ALL';

export interface Queue {
  automixItems: unknown[];
  autoplay: boolean;
  hasShownAutoplay: boolean;
  hasUserChangedDefaultAutoplayMode: boolean;
  header: QueueHeader;
  impressedVideoIds: Entities;
  isFetchingChipSteer: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  isPrefetchingContinuations: boolean;
  isRaarEnabled: boolean;
  isRaarSkip: boolean;
  items: QueueItem[];
  nextQueueItemId: number;
  playbackContentMode: string;
  queueContextParams: string;
  repeatMode: RepeatMode;
  responsiveSignals: ResponsiveSignals;
  selectedItemIndex: number;
  shuffleEnabled: boolean;
  shuffleEndpoints: null;
  steeringChips: SteeringChips;
  watchNextType: null;
}

export interface QueueHeader {
  title: Subtitle;
  subtitle: Subtitle;
  buttons: HeaderButton[];
  trackingParams: string;
}

export interface HeaderButton {
  chipCloudChipRenderer: ButtonChipCloudChipRenderer;
}

export interface ButtonChipCloudChipRenderer {
  style: ChipCloudChipRendererStyle;
  text: Subtitle;
  navigationEndpoint: TentacledNavigationEndpoint;
  trackingParams: string;
  icon: DefaultIconClass;
  accessibilityData: AccessibilityPauseDataClass;
  isSelected: boolean;
  uniqueId: string;
}

export interface TentacledNavigationEndpoint {
  clickTrackingParams: string;
  saveQueueToPlaylistCommand: Entities;
}

export interface QueueItem {
  playlistPanelVideoWrapperRenderer?: PlaylistPanelVideoWrapperRenderer;
  playlistPanelVideoRenderer?: ItemPlaylistPanelVideoRenderer;
}

export interface ItemPlaylistPanelVideoRenderer {
  title: Subtitle;
  longBylineText: LongBylineText;
  thumbnail: ThumbnailDetailsClass;
  lengthText: LengthText;
  selected: boolean;
  navigationEndpoint: PlaylistPanelVideoRendererNavigationEndpoint;
  videoId: string;
  shortBylineText: Subtitle;
  trackingParams: string;
  menu: TentacledMenu;
  playlistSetVideoId?: string;
  canReorder: boolean;
}

export interface TentacledMenu {
  menuRenderer: StickyMenuRenderer;
}

export interface StickyMenuRenderer {
  items: StickyItem[];
  trackingParams: string;
  accessibility: AccessibilityPauseDataClass;
}

export interface StickyItem {
  menuNavigationItemRenderer?: MenuItemRenderer;
  menuServiceItemRenderer?: MenuItemRenderer;
  toggleMenuServiceItemRenderer?: StickyToggleMenuServiceItemRenderer;
}

export interface StickyToggleMenuServiceItemRenderer {
  defaultText: Subtitle;
  defaultIcon: DefaultIconClass;
  defaultServiceEndpoint: ServiceEndpoint;
  toggledText: Subtitle;
  toggledIcon: DefaultIconClass;
  toggledServiceEndpoint: ServiceEndpoint;
  trackingParams: string;
}

export interface PlaylistPanelVideoRendererNavigationEndpoint {
  clickTrackingParams: string;
  watchEndpoint: FluffyWatchEndpoint;
}

export interface FluffyWatchEndpoint {
  videoId: string;
  playlistId?: string;
  index: number;
  params: string;
  playerParams?: string;
  playlistSetVideoId?: string;
  loggingContext?: LoggingContext;
  watchEndpointMusicSupportedConfigs: FluffyWatchEndpointMusicSupportedConfigs;
}

export interface FluffyWatchEndpointMusicSupportedConfigs {
  watchEndpointMusicConfig: FluffyWatchEndpointMusicConfig;
}

export interface FluffyWatchEndpointMusicConfig {
  hasPersistentPlaylistPanel: boolean;
  musicVideoType: MusicVideoType;
}

export interface PlaylistPanelVideoWrapperRenderer {
  primaryRenderer: PrimaryRenderer;
  counterpart: Counterpart[];
}

export interface Counterpart {
  counterpartRenderer: CounterpartRenderer;
  segmentMap: SegmentMap;
}

export interface CounterpartRenderer {
  playlistPanelVideoRenderer: CounterpartRendererPlaylistPanelVideoRenderer;
}

export interface CounterpartRendererPlaylistPanelVideoRenderer {
  title: Subtitle;
  longBylineText: LongBylineText;
  thumbnail: ThumbnailDetailsClass;
  lengthText: LengthText;
  selected: boolean;
  navigationEndpoint: PlaylistPanelVideoRendererNavigationEndpoint;
  videoId: string;
  shortBylineText: Subtitle;
  trackingParams: string;
  menu: StickyMenu;
  playlistSetVideoId?: string;
  canReorder: boolean;
}

export interface StickyMenu {
  menuRenderer: IndigoMenuRenderer;
}

export interface IndigoMenuRenderer {
  items: IndigoItem[];
  trackingParams: string;
  accessibility: AccessibilityPauseDataClass;
}

export interface IndigoItem {
  menuNavigationItemRenderer?: MenuItemRenderer;
  menuServiceItemRenderer?: MenuItemRenderer;
  toggleMenuServiceItemRenderer?: IndigoToggleMenuServiceItemRenderer;
}

export interface IndigoToggleMenuServiceItemRenderer {
  defaultText: Subtitle;
  defaultIcon: DefaultIconClass;
  defaultServiceEndpoint: FluffyServiceEndpoint;
  toggledText: Subtitle;
  toggledIcon: DefaultIconClass;
  toggledServiceEndpoint: FluffyServiceEndpoint;
  trackingParams: string;
}

export interface FluffyServiceEndpoint {
  clickTrackingParams: string;
  likeEndpoint?: ServiceEndpointLikeEndpoint;
  feedbackEndpoint?: FeedbackEndpoint;
}

export interface SegmentMap {
  segment: Segment[];
}

export interface Segment {
  primaryVideoStartTimeMilliseconds: string;
  counterpartVideoStartTimeMilliseconds: string;
  durationMilliseconds: string;
}

export interface PrimaryRenderer {
  playlistPanelVideoRenderer: ItemPlaylistPanelVideoRenderer;
}

export interface ResponsiveSignals {
  videoInteraction: VideoInteraction[];
}

export interface VideoInteraction {
  queueImpress?: Entities;
  videoId: string;
  queueIndex: number;
  playbackSkip?: Entities;
}

export interface SteeringChips {
  chips: SteeringChipsChip[];
  trackingParams: string;
}

export interface SteeringChipsChip {
  chipCloudChipRenderer: FluffyChipCloudChipRenderer;
}

export interface FluffyChipCloudChipRenderer {
  text: Subtitle;
  navigationEndpoint: StickyNavigationEndpoint;
  trackingParams: string;
  accessibilityData: AccessibilityPauseDataClass;
  isSelected: boolean;
  uniqueId: string;
}

export interface StickyNavigationEndpoint {
  clickTrackingParams: string;
  queueUpdateCommand: QueueUpdateCommand;
}

export interface QueueUpdateCommand {
  queueUpdateSection: QueueUpdateSection;
  fetchContentsCommand: FetchContentsCommand;
  dedupeAgainstLocalQueue: boolean;
}

export interface FetchContentsCommand {
  clickTrackingParams: string;
  watchEndpoint: FetchContentsCommandWatchEndpoint;
}

export interface FetchContentsCommandWatchEndpoint {
  playlistId: string;
  params: string;
  loggingContext: LoggingContext;
  index: number;
}

export enum QueueUpdateSection {
  QueueUpdateSectionQueue = 'QUEUE_UPDATE_SECTION_QUEUE',
}

export interface SubscribeStatus {
  subscribeStatusByChannelId: Entities;
}

export interface ToggleStates {
  feedbackToggleStates: Entities;
}

export interface UI {
  viewportInfo: ViewportInfo;
  isGuideCollapsed: boolean;
}

export interface ViewportInfo {
  size: number;
  fluid: boolean;
}

export interface Uploads {
  fileUploads: unknown[];
}
