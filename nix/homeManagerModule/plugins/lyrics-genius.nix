{ lib, ... }:
let
  inherit (lib) mkEnableOption;
in
{
  enable = mkEnableOption "Lyrics Genius plugin";
  romanizedLyrics = mkEnableOption "romanized lyrics";
}
