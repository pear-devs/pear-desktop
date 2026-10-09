{ lib, ... }:
let
  inherit (lib) mkEnableOption;
in
{
  enable = mkEnableOption "'Disable Autoplay' plugin";
  applyOnce = mkEnableOption "" // {
    description = "Whether to apply only on startup";
  };
}
