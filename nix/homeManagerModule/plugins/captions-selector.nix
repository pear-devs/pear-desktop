{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption;
in
{
  enable = mkEnableOption "Captions Selector plugin";
  disableCaptions = mkEnableOption "" // {
    description = "Whether to disable captions";
  };
  autoload = mkEnableOption "autoload last used caption";
  lastCaptionsCode = mkOption {
    default = "";
    type = lib.types.str;
    internal = true;
  };
}
