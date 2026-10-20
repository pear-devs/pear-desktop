// The selector registry: the only place that knows YTM's DOM.
// Plugins reference entries by name through the `sel` macro (compile error on
// unknown names) or `ctx.sel` at runtime. When YTM changes its markup, fix it
// here once instead of in every plugin.

export const selectors = {
  app: "ytmusic-app",
  "app.layout": "ytmusic-app-layout",

  "player.api": "#movie_player",
  "player.video": "video",
  "player.page": "ytmusic-player-page",
  "player.song_image": "#song-image",
  "player.song_video": "#song-video",
  "player.av_toggle": "ytmusic-av-toggle",
  "player.main_panel": "ytmusic-player-page #main-panel",

  player_bar: "ytmusic-player-bar",
  "player_bar.play_pause": "ytmusic-player-bar #play-pause-button",
  "player_bar.next": "ytmusic-player-bar .next-button",
  "player_bar.previous": "ytmusic-player-bar .previous-button",
  "player_bar.left_controls": "ytmusic-player-bar .left-controls",
  "player_bar.middle_controls": "ytmusic-player-bar .middle-controls",
  "player_bar.right_controls": "ytmusic-player-bar #right-controls",
  "player_bar.right_controls_buttons": "ytmusic-player-bar #right-controls .right-controls-buttons",
  "player_bar.volume_slider": "ytmusic-player-bar #volume-slider",
  "player_bar.volume_button": "ytmusic-player-bar .volume.ytmusic-player-bar",
  "player_bar.progress": "ytmusic-player-bar #progress-bar",
  "player_bar.like_buttons": "ytmusic-player-bar #like-button-renderer",
  /** The like/dislike pair's element, wherever it is. */
  like_buttons: "ytmusic-like-button-renderer",
  /** Likes and the track menu; YTM hides them in narrow windows. */
  "player_bar.middle_buttons": "ytmusic-player-bar .middle-controls-buttons",
  "player_bar.like": "ytmusic-player-bar #like-button-renderer #button-shape-like button",
  "player_bar.dislike": "ytmusic-player-bar #like-button-renderer #button-shape-dislike button",
  "player_bar.repeat": "ytmusic-player-bar #right-controls .repeat",
  "player_bar.shuffle": "ytmusic-player-bar .shuffle",
  "player_bar.title": "ytmusic-player-bar .title",
  "player_bar.byline": "ytmusic-player-bar .byline",
  "player_bar.thumbnail": "ytmusic-player-bar .thumbnail img",

  nav_bar: "ytmusic-nav-bar",
  "nav_bar.background": "#nav-bar-background",
  "nav_bar.divider": "#nav-bar-divider",
  "nav_bar.left": "ytmusic-nav-bar .left-content",
  "nav_bar.center": "ytmusic-nav-bar .center-content",
  "nav_bar.right": "ytmusic-nav-bar .right-content",
  "nav_bar.search_box": "ytmusic-search-box",

  "guide.sidebar": "ytmusic-guide-renderer",
  /** The full and the collapsed ("mini") sidebar; each has its own primary section. */
  "guide.full": "#guide-renderer",
  "guide.mini": "#mini-guide-renderer",
  "guide.primary_items": "ytmusic-guide-section-renderer[is-primary] > #items",
  "browse.header": "#header.ytmusic-item-section-renderer",
  tabs: "ytmusic-tabs",
  "tabs.stuck": "ytmusic-tabs.stuck",

  queue: "#queue",
  "queue.items": "ytmusic-player-queue #contents",
  "popup.container": "ytmusic-popup-container",
  "popup.menu": "ytmusic-menu-popup-renderer",
  "dialog.you_there": "ytmusic-you-there-renderer",
  "lyrics.tab": "ytmusic-player-page tp-yt-paper-tab:nth-of-type(2)",
  "lyrics.container": "ytmusic-description-shelf-renderer",
  /** Sidebar entries; each carries its renderer data (`.data`: browse id, icon type). */
  "guide.entry": "ytmusic-guide-entry-renderer",
  /** The sidebar's "Upgrade" entry, which the core marks (it can only be told apart by its data). */
  "upgrade.button": "ytmusic-guide-entry-renderer[pear-upgrade]",

  // ---- integrations (api-server, discord, scrobbler, notifications, …)
  "integrations.fullscreen": "ytmusic-player-bar[player-fullscreened]",
  "integrations.fullscreen_button": ".fullscreen-button",
  "integrations.exit_fullscreen_button": ".exit-fullscreen-button",

  // ---- network & files (adblock, downloader, proxy, sponsorblock)
  /** The Premium reminder YTM shows after skipped ads, and its "Don't renew"/"No thanks" button. */
  "promo.mealbar": "ytmusic-mealbar-promo-renderer",
  "promo.dismiss": "yt-button-renderer.dismiss-button button",

  // ---- audio (equalizer, compressor, crossfade, volume, speed, quality, visualizer, …)
  "player.container": "ytmusic-player#player",
  "player.top_row_buttons": ".top-row-buttons.ytmusic-player",
  "player_bar.expand_volume": "ytmusic-player-bar #expand-volume",
  "player_bar.volume_sliders": "ytmusic-player-bar #volume-slider, ytmusic-player-bar #expand-volume-slider",
  "player_bar.captions": "ytmusic-player-bar .right-controls-buttons .captions",

  // ---- interface tweaks (album actions, colors, ambient mode, clock, navigation, pip, …)
  "player_bar.background": "#player-bar-background",
  "guide.background": "#guide-wrapper",
  "guide.mini_background": "#mini-guide-background",
  "browse.background": "ytmusic-browse-response #background",
  "browse.gradient": "ytmusic-browse-response .background-gradient",
  "browse.page": "#browse-page",
  "browse.action_buttons": "ytmusic-responsive-header-renderer #action-buttons",
  "browse.continuations": "#browse-page #continuations",
  "browse.tracklist":
    "#browse-page ytmusic-playlist-shelf-renderer, #browse-page ytmusic-shelf-renderer:nth-last-child(1 of ytmusic-shelf-renderer)",
  "browse.track_like": "#button-shape-like > button",
  "browse.track_dislike": "#button-shape-dislike > button",
  "list.play_button": "ytmusic-play-button-renderer",
  "player.side_panel": "ytmusic-player-page #side-panel",
  "player.song_image_img": "#song-image #thumbnail img",
  "player.song_video_wrapper": "#song-video .player-wrapper",
  "player.native_av_toggle": "ytmusic-player-page #av-id",
  "player_bar.menu_button": "ytmusic-player-bar ytmusic-menu-renderer.menu yt-button-shape button",
  "player_bar.toggle_page": "ytmusic-player-bar .toggle-player-page-button",
  "player.fullscreen_button": "ytmusic-player #song-media-window .fullscreen-button button",
  "popup.listbox": "ytmusic-menu-popup-renderer tp-yt-paper-listbox",

  // ---- lyrics & music together
  /** The player page's tab panel (Up next / Lyrics / Related); it is also the scroller. */
  "lyrics.panel": "ytmusic-player-page #tab-renderer",
} as const;

export type SelectorName = keyof typeof selectors;

export function isSelectorName(name: string): name is SelectorName {
  return Object.hasOwn(selectors, name);
}
