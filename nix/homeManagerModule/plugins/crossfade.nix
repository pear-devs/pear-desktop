{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Crossfade plugin";
  fadeInDuration = mkOption {
    description = "fade in duration (ms)";
    default = 1500;
    type = types.number;
  };
  fadeOutDuration = mkOption {
    description = "fade out duration (ms)";
    default = 5000;
    type = types.number;
  };
  secondsBeforeEnd = mkOption {
    description = "crossfade n seconds before end";
    default = 10;
    type = types.number;
  };
  fadeScaling = mkOption {
    description = "fade scaling";
    default = "linear";
    type = types.oneOf [
      (types.enum [
        "linear"
        "logarithmic"
      ])
      types.number
    ];
  };
}
