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

  player_bar: "ytmusic-player-bar",
  "player_bar.play_pause": "ytmusic-player-bar #play-pause-button",
  "player_bar.next": "ytmusic-player-bar .next-button",
  "player_bar.previous": "ytmusic-player-bar .previous-button",
  "player_bar.left_controls": "ytmusic-player-bar .left-controls",
  "player_bar.middle_controls": "ytmusic-player-bar .middle-controls",
  "player_bar.right_controls": "ytmusic-player-bar #right-controls",
  "player_bar.right_controls_buttons": "ytmusic-player-bar #right-controls .right-controls-buttons",
  "player_bar.volume_slider": "ytmusic-player-bar #volume-slider",
  "player_bar.progress": "ytmusic-player-bar #progress-bar",
  "player_bar.like_buttons": "ytmusic-player-bar #like-button-renderer",
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
  "upgrade.button": "ytmusic-guide-entry-renderer:last-child, tp-yt-paper-item.ytmusic-guide-entry-renderer[href*='music_premium']",

  // ---- integrations (api-server, discord, scrobbler, notifications, …)
  "integrations.fullscreen": "ytmusic-player-bar[player-fullscreened]",
  "integrations.fullscreen_button": ".fullscreen-button",
  "integrations.exit_fullscreen_button": ".exit-fullscreen-button",

  // ---- network & files (adblock, downloader, proxy, sponsorblock)

  // ---- audio (equalizer, compressor, crossfade, volume, speed, quality, visualizer, …)

  // ---- interface tweaks (album actions, colors, ambient mode, clock, navigation, pip, …)

  // ---- lyrics & music together
} as const;

export type SelectorName = keyof typeof selectors;

export function isSelectorName(name: string): name is SelectorName {
  return Object.hasOwn(selectors, name);
}
