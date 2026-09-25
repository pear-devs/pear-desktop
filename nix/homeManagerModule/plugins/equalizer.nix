{ lib, ... }:
let
  inherit (lib) mkOption mkEnableOption types;
in
{
  enable = mkEnableOption "Equalizer plugin";
  filters = mkOption {
    internal = true;
    default = [ ];
    type =
      with types;
      listOf (submodule {
        options = {
          type = mkOption {
            description = "BiquadFilterType";
            default = "lowshelf";
            type = str;
            internal = true;
          };
          frequency = mkOption {
            default = 80;
            type = number;
            description = "frequency";
            internal = true;
          };
          Q = mkOption {
            type = number;
            description = "Q";
            default = 100;
            internal = true;
          };
          gain = mkOption {
            type = number;
            description = "gain";
            default = 12.0;
            internal = true;
          };
        };
      });
  };
  presets = {
    bass-booster = mkEnableOption "Equalizer's bass-booster preset";
  };
}
