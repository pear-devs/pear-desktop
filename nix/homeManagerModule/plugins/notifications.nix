{ lib, pkgs }:
let
  inherit (lib) mkEnableOption mkOption types;
  inherit (pkgs.stdenv.hostPlatform) isLinux;
in
{
  enable = mkEnableOption "Notifications plugin";
  unpauseNotification = mkEnableOption "" // {
    description = "Whether to show notification on unpause";
  };
  urgency = mkOption {
    default = "normal";
    description = "Only has effect on Linux";
    type = types.enum [
      "low"
      "normal"
      "critical"
    ];
    internal = !isLinux;
  };
  interactive = mkOption {
    default = true;
    type = types.bool;
    description = "Only has effect on Windows";
    internal = true;
  };
  toastStyle = mkOption {
    default = 1;
    type = types.enum [
      1
      2
      3
      4
      5
      6
      7
    ];
    description = ''
      1: logo
      2: banner_centered_top
      3: hero
      4: banner_top_custom
      5: banner_centered_bottom
      6: banner_bottom
      7: legacy
    '';
    internal = true;
  };
  refreshOnPlayPause = mkEnableOption "refresh on play/pause" // {
    internal = true;
  };
  trayControls = mkEnableOption "tray controls" // {
    internal = true;
  };
  hideButtonText = mkEnableOption "hide button text" // {
    internal = true;
  };
}
