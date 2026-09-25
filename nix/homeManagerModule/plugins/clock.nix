{ lib, ... }:
let
  inherit (lib) mkEnableOption;
in
{
  enable = mkEnableOption "Clock plugin";
  displaySeconds = mkEnableOption "" // {
    description = "Whether to display seconds";
  };
  hour12 = mkEnableOption "12-hour clock";
}
