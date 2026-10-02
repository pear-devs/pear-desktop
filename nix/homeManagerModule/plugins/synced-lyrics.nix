{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Synced Lyrics plugin";
  preciseTiming = mkEnableOption "precise timing" // {
    default = true;
  };
  showLyricsEvenIfInexact = mkEnableOption "lyrics even if inexact" // {
    default = true;
  };
  showTimeCodes = mkEnableOption "time codes";
  defaultTextString = mkOption {
    default = "♪";
    type = types.str;
    description = "character between lyrics";
  };
  lineEffect = mkOption {
    default = "fancy";
    type = types.enum [
      "fancy"
      "scale"
      "offset"
      "focus"
    ];
    description = "line effect";
  };
  romanization = mkEnableOption "romanized lyrics" // {
    default = true;
  };
}
