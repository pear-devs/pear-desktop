{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Video Toggle plugin";
  hideVideo = mkEnableOption "" // {
    description = "Whether to hide the video";
    internal = true;
  };
  mode = mkOption {
    default = "custom";
    type = types.enum [
      "custom"
      "native"
      "disabled"
    ];
    description = "video toggle mode";
  };
  forceHide = mkEnableOption "" // {
    description = "Whether to forcefully hide the video toggle";
  };
  align = mkOption {
    default = "left";
    type = types.enum [
      "left"
      "middle"
      "right"
    ];
    description = "video toggle alignment";
  };
}
