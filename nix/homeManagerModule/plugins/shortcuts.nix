{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
  shortcutMappingType = types.submodule {
    options = {
      previous = mkOption {
        default = "";
        type = types.str;
        description = "previous shortcut";
      };
      playPause = mkOption {
        default = "";
        type = types.str;
        description = "play/pause shortcut";
      };
      next = mkOption {
        default = "";
        type = types.str;
        description = "next shortcut";
      };
    };
  };
in
{
  enable = mkEnableOption "Shortcuts plugin";
  overrideMediaKeys = mkEnableOption "" // {
    description = "Whether to override media keys";
  };
  global = mkOption {
    default = { };
    type = shortcutMappingType;
    description = "global shortcuts";
  };
  local = mkOption {
    default = { };
    type = shortcutMappingType;
    internal = true;
  };
}
