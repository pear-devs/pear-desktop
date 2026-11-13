{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Precise Volume plugin";
  steps = mkOption {
    default = 1;
    description = "Percentage of volume to change";
    type = types.number;
  };
  arrowsShortcut = mkEnableOption "" // {
    default = true;
    description = "ArrowUp + ArrowDown local shortcuts";
  };
  globalShortcuts = {
    volumeUp = mkOption {
      description = "Global shortcut for volume up";
      default = "";
      type = types.str;
    };
    volumeDown = mkOption {
      description = "Global shortcut for volume down";
      default = "";
      type = types.str;
    };
  };
  savedVolume = mkOption {
    default = null;
    description = "Default volume";
    type = types.nullOr types.number;
    internal = true;
  };
}
