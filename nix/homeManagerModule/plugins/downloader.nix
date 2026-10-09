{ lib, ... }:
let
  inherit (lib) mkOption mkEnableOption types;
in
{
  enable = mkEnableOption "Downloader plugin";
  downloadFolder = mkOption {
    description = "download folder";
    default = null;
    type = types.nullOr types.str;
  };
  downloadOnFinish = {
    enable = mkEnableOption "download on finish";
    seconds = mkOption {
      description = "last x seconds";
      default = 20;
      type = types.number;
    };
    percent = mkOption {
      description = "last x percent";
      default = 10;
      type = types.number;
    };
    mode = mkOption {
      description = "time mode";
      type = types.enum [
        "percent"
        "seconds"
      ];
      default = "seconds";
    };
    folder = mkOption {
      description = "download on finish folder";
      default = null;
      type = types.nullOr types.str;
    };
  };
  selectedPreset = mkOption {
    default = "mp3 (256kbps)";
    description = "downloader preset";
    type = types.enum [
      "mp3 (256kbps)"
      "Custom"
      "Source"
    ];
  };
  customPresetSetting = {
    extension = mkOption {
      description = "custom preset setting extension";
      default = "mp3";
      type = types.nullOr types.str;
    };
    ffmpegArgs = mkOption {
      description = "custom preset setting ffmpeg args";
      default = [
        "-b:a"
        "256k"
      ];
      type = types.listOf types.str;
    };
  };
  skipExisting = mkEnableOption "skip existing";
  playlistMaxItems = mkOption {
    description = "playlist max items";
    default = null;
    type = with types; nullOr number;
  };
}
