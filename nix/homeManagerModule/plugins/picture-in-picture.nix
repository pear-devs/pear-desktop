{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Picture-in-picture plugin";
  alwaysOnTop = mkEnableOption "always on top" // {
    default = true;
  };
  savePosition = mkEnableOption "save window position" // {
    default = true;
  };
  saveSize = mkEnableOption "save window size";
  hotkey = mkOption {
    default = "P";
    type = types.str;
    description = "hotkey to open the PiP";
  };
  pip-position = mkOption {
    default = [
      10
      10
    ];
    description = "[x y]";
    type = with types; listOf int;
    internal = true;
  };
  pip-size = mkOption {
    default = [
      450
      275
    ];
    description = "[width height]";
    type = with types; listOf int;
    internal = true;
  };
  isInPiP = mkOption {
    default = false;
    type = types.bool;
    internal = true;
  };
  useNativePiP = mkEnableOption "" // {
    default = true;
    description = "Use the browser's native PiP";
  };
}
