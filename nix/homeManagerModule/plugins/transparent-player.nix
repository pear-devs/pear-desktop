{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Transparent player plugin";
  opacity = mkOption {
    type = types.number;
    default = 0.5;
    description = "Transparent player's opacity";
  };
  type = mkOption {
    type = types.enum [
      "mica"
      "acrylic"
      "tabbed"
      "none"
    ];
    default = "none";
    description = "Transparent player's material type";
  };
}
