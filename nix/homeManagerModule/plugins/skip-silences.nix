{ lib, ... }:
let
  inherit (lib) mkEnableOption;
in
{
  enable = mkEnableOption "Skip Silences plugin";
  onlySkipBeginning = mkEnableOption "" // {
    description = "Whether to only skip beginning";
  };
}
