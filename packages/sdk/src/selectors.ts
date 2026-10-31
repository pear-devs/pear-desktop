// The selector registry: the only place that knows YTM's DOM.
// Plugins reference entries by name through the `sel` macro (compile error on
// unknown names) or `ctx.sel` at runtime. When YTM changes its markup, fix it
// here once instead of in every plugin.

export const selectors = {
  // ---- app
  app: "ytmusic-app",
  "app.layout": "ytmusic-app-layout",

  // ---- player (the video and the player page)
  "player.api": "#movie_player",
  "player.video": "video",
  "player.container": "ytmusic-player#player",
  "player.top_row_buttons": ".top-row-buttons.ytmusic-player",
  "player.fullscreen_button": "ytmusic-player #song-media-window .fullscreen-button button",
  "player.page": "ytmusic-player-page",
  /** The player page while it is open. */
  "player.page_open": "ytmusic-app-layout[player-page-open]",
  "player.main_panel": "ytmusic-player-page #main-panel",
  "player.side_panel": "ytmusic-player-page #side-panel",
  "player.song_image": "#song-image",
  "player.song_image_img": "#song-image #thumbnail img",
  "player.song_video": "#song-video",
  "player.song_video_wrapper": "#song-video .player-wrapper",
  "player.av_toggle": "ytmusic-av-toggle",
  "player.native_av_toggle": "ytmusic-player-page #av-id",

  // ---- player bar
  // Two layouts: the classic <ytmusic-player-bar>, and the new one YTM tries on
  // some users (`.ytMusicMiniPlayerHost`, behind the music_web_enable_wiz_miniplayer
  // flag; the "Player bar" site setting picks one). Each entry matches either.
  // The new layout's player page has a second bar of its own (`.top-player-bar`,
  // shown in small windows and full screen), hence the `ytmusic-app-layout >`.
  player_bar: "ytmusic-player-bar, ytmusic-app-layout > .ytMusicMiniPlayerHost",
  /** Present only in the new layout. */
  "player_bar.new": "ytmusic-app-layout > .ytMusicMiniPlayerHost",
  "player_bar.background": "#player-bar-background",
  "player_bar.title": "ytmusic-player-bar .title, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicTrackInfoTitle",
  "player_bar.byline": "ytmusic-player-bar .byline, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicTrackInfoByline",
  "player_bar.thumbnail": "ytmusic-player-bar .thumbnail img, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicTrackInfoThumbnail",
  "player_bar.progress": "ytmusic-player-bar #progress-bar, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerProgressBar",
  "player_bar.time": "ytmusic-player-bar .time-info, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerTimeInfo",
  /** Previous, play/pause and next. */
  "player_bar.left_controls": "ytmusic-player-bar .left-controls, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsMainControls",
  "player_bar.play_pause": "ytmusic-player-bar #play-pause-button, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsPlayPauseButton button",
  "player_bar.previous": "ytmusic-player-bar .previous-button, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsPreviousButton button",
  "player_bar.next": "ytmusic-player-bar .next-button, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsNextButton button",
  /** The track info (and, in the classic layout, the likes and the track menu). */
  "player_bar.middle_controls": "ytmusic-player-bar .middle-controls, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerLeftSection",
  /** Likes and the track menu; YTM hides them in narrow windows. */
  "player_bar.middle_buttons": "ytmusic-player-bar .middle-controls-buttons, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerActionBar",
  "player_bar.like_buttons": "ytmusic-player-bar #like-button-renderer, ytmusic-app-layout > .ytMusicMiniPlayerHost segmented-like-dislike-button-view-model",
  "player_bar.like":
    "ytmusic-player-bar #like-button-renderer #button-shape-like button, ytmusic-app-layout > .ytMusicMiniPlayerHost like-button-view-model button",
  "player_bar.dislike":
    "ytmusic-player-bar #like-button-renderer #button-shape-dislike button, ytmusic-app-layout > .ytMusicMiniPlayerHost dislike-button-view-model button",
  "player_bar.menu_button": "ytmusic-player-bar ytmusic-menu-renderer.menu yt-button-shape button, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerMenuButton button",
  "player_bar.right_controls": "ytmusic-player-bar #right-controls, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerRightSection",
  /** Where plugins put their player-bar buttons (prepended). */
  "player_bar.right_controls_buttons": "ytmusic-player-bar #right-controls .right-controls-buttons, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerRightSection",
  /** The volume slider: a paper-slider (classic) or a range input (new); both have a `value` from 0 to 100. */
  "player_bar.volume_slider": "ytmusic-player-bar #volume-slider, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerVolumePopup input",
  /** The volume button (with its slider, in the new layout). */
  "player_bar.volume_button": "ytmusic-player-bar .volume.ytmusic-player-bar, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerVolumeWrapper",
  /** New layout only: the slider's popup, which YTM shows while the volume button is hovered. */
  "player_bar.volume_popup": "ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerVolumePopup",
  /** Classic layout only: the volume button shown in narrow windows. */
  "player_bar.expand_volume": "ytmusic-player-bar #expand-volume",
  "player_bar.volume_sliders":
    "ytmusic-player-bar #volume-slider, ytmusic-player-bar #expand-volume-slider, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerVolumePopup input",
  "player_bar.repeat": "ytmusic-player-bar #right-controls .repeat, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsRepeatButton button",
  "player_bar.shuffle": "ytmusic-player-bar .shuffle, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytmusicPlayerControlsShuffleButton button",
  "player_bar.captions": 'ytmusic-player-bar .right-controls-buttons .captions, ytmusic-app-layout > .ytMusicMiniPlayerHost .ytMusicMiniPlayerRightSection > [client-ve-type="16500"]',
  /** Classic layout only: the menu of buttons that don't fit narrow windows. */
  "player_bar.expanding_menu": "ytmusic-player-bar #expanding-menu",
  /** Opens and closes the player page; in the new layout, a click on the bar itself does. */
  "player_bar.toggle_player_page": "ytmusic-player-bar .toggle-player-page-button, ytmusic-app-layout > .ytMusicMiniPlayerHost",
  /** Classic layout only: the arrow that toggles the player page (the new layout has none). */
  "player_bar.player_page_arrow": "ytmusic-player-bar .toggle-player-page-button",
  /** New layout only: the row holding the like and dislike halves of the pill. */
  "player_bar.like_pair": "ytmusic-app-layout > .ytMusicMiniPlayerHost .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper",
  /** The classic like/dislike pair's element, wherever it is. */
  like_buttons: "ytmusic-like-button-renderer",

  // ---- fullscreen
  "integrations.fullscreen": "ytmusic-app-layout[player-fullscreened]",
  "integrations.fullscreen_button": ".fullscreen-button",
  /** Classic layout only; the new one leaves fullscreen with the Escape key (document.exitFullscreen). */
  "integrations.exit_fullscreen_button": ".exit-fullscreen-button",

  // ---- nav bar
  nav_bar: "ytmusic-nav-bar",
  "nav_bar.background": "#nav-bar-background",
  "nav_bar.divider": "#nav-bar-divider",
  "nav_bar.left": "ytmusic-nav-bar .left-content",
  "nav_bar.center": "ytmusic-nav-bar .center-content",
  "nav_bar.right": "ytmusic-nav-bar .right-content",
  "nav_bar.search_box": "ytmusic-search-box",

  // ---- sidebar (the guide)
  "guide.sidebar": "ytmusic-guide-renderer",
  "guide.background": "#guide-wrapper",
  "guide.mini_background": "#mini-guide-background",
  /** The full and the collapsed ("mini") sidebar; each has its own primary section. */
  "guide.full": "#guide-renderer",
  "guide.mini": "#mini-guide-renderer",
  "guide.primary_items": "ytmusic-guide-section-renderer[is-primary] > #items",
  /** Sidebar entries; each carries its renderer data (`.data`: browse id, icon type). */
  "guide.entry": "ytmusic-guide-entry-renderer",
  /** YTM's entry for the page that shows (highlighted). */
  "guide.active_entry": "ytmusic-guide-entry-renderer[active]",
  /** The sidebar's "Upgrade" entry, which the core marks (it can only be told apart by its data). */
  "upgrade.button": "ytmusic-guide-entry-renderer[pear-upgrade]",

  // ---- browse pages (home, albums, playlists…)
  "browse.page": "#browse-page",
  /** The browse page's element; its `.data` is the server's answer it draws. */
  "browse.response": "ytmusic-browse-response",
  /** The bar of tabs some browse pages have (the Library's: Library, Downloads). */
  "browse.tabs": "ytmusic-browse-response ytmusic-tabs",
  /** The page's shelves, in its section list. */
  "browse.contents": "ytmusic-browse-response ytmusic-section-list-renderer > #contents",
  "browse.header": "#header.ytmusic-item-section-renderer",
  "browse.background": "ytmusic-browse-response #background",
  "browse.gradient": "ytmusic-browse-response .background-gradient",
  "browse.action_buttons": "ytmusic-responsive-header-renderer #action-buttons",
  /** An album's or playlist's title, in its page's header. */
  "browse.title": "ytmusic-responsive-header-renderer h1",
  "browse.continuations": "#browse-page #continuations",
  "browse.tracklist":
    "#browse-page ytmusic-playlist-shelf-renderer, #browse-page ytmusic-shelf-renderer:nth-last-child(1 of ytmusic-shelf-renderer)",
  "browse.track_like": "#button-shape-like > button",
  "browse.track_dislike": "#button-shape-dislike > button",
  "list.play_button": "ytmusic-play-button-renderer",
  tabs: "ytmusic-tabs",
  "tabs.stuck": "ytmusic-tabs.stuck",

  // ---- queue
  queue: "#queue",
  "queue.items": "ytmusic-player-queue #contents",
  /** Every track in the queue, autoplay's included, in order; the playing one has [selected]. */
  "queue.item": "ytmusic-player-queue ytmusic-player-queue-item",

  // ---- lyrics (the player page's tabs)
  /** The player page's tab panel (Up next / Lyrics / Related); it is also the scroller. */
  "lyrics.panel": "ytmusic-player-page #tab-renderer",
  "lyrics.tab": "ytmusic-player-page tp-yt-paper-tab:nth-of-type(2)",
  "lyrics.container": "ytmusic-description-shelf-renderer",

  // ---- popups and dialogs
  "popup.container": "ytmusic-popup-container",
  "popup.menu": "ytmusic-menu-popup-renderer",
  "popup.listbox": "ytmusic-menu-popup-renderer tp-yt-paper-listbox",
  "dialog.you_there": "ytmusic-you-there-renderer",
  /** The Premium reminder YTM shows after skipped ads, and its "Don't renew"/"No thanks" button. */
  "promo.mealbar": "ytmusic-mealbar-promo-renderer",
  "promo.dismiss": "yt-button-renderer.dismiss-button button",
} as const;

export type SelectorName = keyof typeof selectors;

export function isSelectorName(name: string): name is SelectorName {
  return Object.hasOwn(selectors, name);
}
