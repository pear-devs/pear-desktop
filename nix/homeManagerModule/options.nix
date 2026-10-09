{ lib, pkgs, ... }:
let
  inherit (pkgs.stdenv.hostPlatform) isDarwin isLinux;
  inherit (lib) mkOption mkEnableOption types;
in
{
  options.programs.pear-desktop.options = {
    language = mkOption {
      default = null;
      description = "Language used by the application";
      type = types.enum [
        null
        "ar"
        "bg"
        "ca"
        "cs"
        "de"
        "el"
        "en"
        "es"
        "et"
        "fa"
        "fi"
        "fil"
        "fr"
        "he"
        "hi"
        "hr"
        "hu"
        "id"
        "is"
        "it"
        "ja"
        "ka"
        "ko"
        "lt"
        "ms"
        "nb"
        "ne"
        "nl"
        "pl"
        "pt-BR"
        "pt"
        "ro"
        "ru"
        "si"
        "sl"
        "sv"
        "th"
        "tr"
        "uk"
        "ur"
        "vi"
        "zh-CN"
        "zh-TW"
      ];
    };
    tray = mkEnableOption "tray support";
    appVisible = mkEnableOption "" // {
      default = true;
      description = "";
    };
    autoUpdates = mkEnableOption "auto updates" // {
      description = "This is not used on nix, set `programs.pear-desktop.package` instead";
      internal = true;
    };
    alwaysOnTop = mkEnableOption "always on top";
    hideMenu = mkEnableOption "" // {
      description = "Whether to hide the menu on Windows/Linux (use Alt to toggle it)";
      internal = isDarwin;
    };
    hideMenuWarned = mkOption {
      description = "Used internally to determine if hide menu warning should be displayed";
      default = true;
      internal = true;
    };
    startAtLogin = mkOption {
      description = ''
        Whether to start the app at login on Windows/Mac

        https://www.electronjs.org/docs/api/app#appsetloginitemsettingssettings-macos-windows
      '';
      internal = isLinux;
      default = false;
    };
    disableHardwareAcceleration = mkEnableOption "" // {
      description = "Whether to disable hardware acceleration";
    };
    removeUpgradeButton = mkEnableOption "" // {
      description = "Whether to remove the upgrade button";
    };
    restartOnConfigChanges = mkEnableOption "" // {
      description = "Whether to restart on config changes";
    };
    trayClickPlayPause = mkEnableOption "" // {
      description = "Whether to play/pause when clicking the tray icon";
    };
    autoResetAppCache = mkEnableOption "" // {
      description = "Whether to reset the cache when the app starts";
    };
    resumeOnStart = mkEnableOption "" // {
      description = "Whether to resume the last song when the app starts";
      default = true;
    };
    likeButtons = mkOption {
      description = "Whether to show or hide the like buttons";
      default = "";
      type = types.enum [
        ""
        "force"
        "hide"
      ];
    };
    swapLikeButtonsOrder = mkEnableOption "" // {
      description = "Whether to swap the like buttons order";
    };
    proxy = mkOption {
      default = "";
      description = "Proxy uri";
      example = "SOCKS5://127.0.0.1:9999";
      type = types.str;
    };
    startingPage = mkOption {
      description = "Starting page";
      default = "";
      type = types.enum [
        ""
        "Default"
        "Home"
        "Explore"
        "New Releases"
        "Charts"
        "Moods & Genres"
        "Library"
        "Playlists"
        "Songs"
        "Albums"
        "Artists"
        "Subscribed Artists"
        "Uploads"
        "Uploaded Playlists"
        "Uploaded Songs"
        "Uploaded Albums"
        "Uploaded Artists"
      ];
    };
    overrideUserAgent = mkEnableOption "" // {
      default = true;
      description = "Whether to override User-Agent";
    };
    usePodcastParticipantAsArtist = mkEnableOption "" // {
      default = true;
      description = ''
        Whether to use the podcast participant as artist.

        Workaround used when listening to a podcast.
      '';
    };
    themes = mkOption {
      default = [ ];
      description = "Custom CSS themes";
      type = types.listOf types.path;
    };
    customWindowTitle = mkOption {
      description = ''
        Set window title to this value instead of dynamically changing it to
        the current song's name.

        See https://github.com/pear-devs/pear-desktop/pull/3656
      '';
      default = null;
      type = types.nullOr types.str;
    };
  };
}
