{ lib, ... }:
let
  inherit (lib) mkOption types mkEnableOption;
in
{
  enable = mkEnableOption "Ambient Mode plugin";
  quality = mkOption {
    default = 50;
    description = "ambient mode quality (pixels)";
    type = types.enum [
      10
      25
      50
      100
      200
      500
      1000
    ];
  };
  buffer = mkOption {
    default = 30;
    description = "ambient mode buffer";
    type = types.enum [
      1
      5
      10
      20
      30
    ];
  };
  interpolationTime = mkOption {
    default = 1500;
    description = "ambient mode interpolation time (ms)";
    type = types.enum [
      0
      500
      1000
      1500
      2000
      3000
      4000
      5000
    ];
  };
  blur = mkOption {
    default = 100;
    description = "ambient mode blur (%)";
    type = types.enum [
      0
      5
      10
      25
      50
      100
      150
      200
      500
    ];
  };
  size = mkOption {
    default = 100;
    description = "ambient mode size (%)";
    type = types.enum [
      100
      110
      125
      150
      175
      200
      300
    ];
  };
  opacity = mkOption {
    description = "Value between 0.0 and 1.0";
    default = 1.0;
    type = types.numbers.between 0 1;
  };
  fullscreen = mkEnableOption "ambient mode fullscreen";
}
