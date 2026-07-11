{ lib, pkgs, ... }:
let
  inherit (lib) mkEnableOption;
  inherit (pkgs.stdenv.hostPlatform) isLinux;
in
{
  enable = mkEnableOption "In-App Menu plugin";
  hideDOMWindowControls = mkEnableOption "" // {
    description = "Whether to hide DOM window controls";
    internal = !isLinux;
  };
}
