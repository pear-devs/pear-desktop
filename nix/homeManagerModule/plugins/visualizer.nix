{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
  mkOptionalOption =
    { type, ... }@args:
    mkOption {
      default = null;
      type = types.nullOr type;
    }
    // (builtins.removeAttrs args [ "type" ]);
in
{
  enable = mkEnableOption "Visualizer plugin";
  type = mkOption {
    default = "butterchurn";
    description = "Visualizer type";
    type = types.enum [
      "butterchurn"
      "vudio"
      "wave"
    ];
  };
  butterchurn = {
    preset = mkOption {
      default = "martin [shadow harlequins shape code] - fata morgana";
      type = types.str;
      internal = true;
    };
    blendTimeInSeconds = mkOption {
      default = 2.7;
      type = types.number;
      internal = true;
    };
  };
  vudio = {
    effect = mkOption {
      default = "lighting";
      type = types.enum [
        "waveform"
        "circlewave"
        "circlebar"
        "lighting"
      ];
      internal = true;
    };
    accuracy = mkOption {
      default = 128;
      type = types.number;
      internal = true;
    };
    lighting = {
      maxHeight = mkOption {
        default = 160;
        type = types.number;
        internal = true;
      };
      maxSize = mkOption {
        default = 12;
        type = types.number;
        internal = true;
      };
      lineWidth = mkOption {
        default = 1;
        type = types.number;
        internal = true;
      };
      color = mkOption {
        default = "#49f3f7";
        type = types.str;
        internal = true;
      };
      shadowBlur = mkOption {
        default = 2;
        type = types.number;
        internal = true;
      };
      shadowColor = mkOption {
        default = "rgba(244,244,244,.5)";
        type = types.str;
        internal = true;
      };
      fadeSide = mkEnableOption "fade side" // {
        default = true;
        internal = true;
      };
      prettify = mkEnableOption "prettify" // {
        internal = true;
      };
      horizontalAlign = mkOption {
        default = "center";
        type = types.enum [
          "left"
          "center"
          "right"
        ];
        internal = true;
      };
      verticalAlign = mkOption {
        default = "middle";
        type = types.enum [
          "top"
          "middle"
          "bottom"
        ];
        internal = true;
      };
      dottify = mkEnableOption "dottify" // {
        default = true;
        internal = true;
      };
    };
  };
  wave =
    let
      waveColor =
        with types;
        submodule {
          options = {
            gradient = mkOption {
              default = null;
              type = nullOr (listOf str);
            };
            rotate = mkOption {
              default = null;
              type = nullOr number;
            };
          };
        };
      animation =
        with types;
        submodule {
          options = {
            type = mkOption {
              type = str;
              internal = true;
            };
            config = {
              bottom = mkOptionalOption {
                type = bool;
                internal = true;
              };
              top = mkOptionalOption {
                type = bool;
                internal = true;
              };
              count = mkOptionalOption {
                type = number;
                internal = true;
              };
              cubeHeight = mkOptionalOption {
                type = number;
                internal = true;
              };
              lineWidth = mkOptionalOption {
                type = number;
                internal = true;
              };
              diameter = mkOptionalOption {
                type = number;
                internal = true;
              };
              fillColor = mkOptionalOption {
                type = oneOf [
                  str
                  waveColor
                ];
                internal = true;
              };
              lineColor = mkOptionalOption {
                type = oneOf [
                  str
                  waveColor
                ];
                internal = true;
              };
              radius = mkOptionalOption {
                type = number;
                internal = true;
              };
              frequencyBand = mkOptionalOption {
                type = str;
                internal = true;
              };
            };
          };
        };
    in
    {
      animations = mkOption {
        type = with types; listOf animation;
        internal = true;
        default = [
          {
            type = "Cubes";
            config = {
              bottom = true;
              count = 30;
              cubeHeight = 5;
              fillColor = {
                gradient = [
                  "#FAD961"
                  "#F76B1C"
                ];
              };
              lineColor = "rgba(0,0,0,0)";
              radius = 20;
            };
          }
          {
            type = "Cubes";
            config = {
              top = true;
              count = 12;
              cubeHeight = 5;
              fillColor = {
                gradient = [
                  "#FAD961"
                  "#F76B1C"
                ];
              };
              lineColor = "rgba(0,0,0,0)";
              radius = 10;
            };
          }
          {
            type = "Circles";
            config = {
              lineColor = {
                gradient = [
                  "#FAD961"
                  "#FAD961"
                  "#F76B1C"
                ];
                rotate = 90;
              };
              lineWidth = 4;
              diameter = 20;
              count = 10;
              frequencyBand = "base";
            };
          }
        ];
      };
    };
}
