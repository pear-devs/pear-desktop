{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Album Color Theme plugin";
  ratio = mkOption {
    default = 0.5;
    description = "Color mix ratio";
    type = types.number;
  };
  enableSeekbar = mkEnableOption "seek bar";
}
