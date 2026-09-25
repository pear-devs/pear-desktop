{ lib, ... }:
let
  inherit (lib) types mkOption mkEnableOption;
in
{
  enable = mkEnableOption "Discord Rich Presence plugin";
  autoReconnect = mkEnableOption "" // {
    description = "If enabled, will try to reconnect to discord every 5 seconds after disconnecting or failing to connect";
    default = true;
  };
  activityTimeoutEnabled = mkEnableOption "" // {
    description = "If enabled, the discord rich presence gets cleared when music paused after the time specified below";
    default = true;
  };
  activityTimeoutTime = mkOption {
    description = "The time in milliseconds after which the discord rich presence gets cleared when music paused";
    default = 10 * 60 * 1000;
    type = types.number;
  };
  playOnYouTubeMusic = mkEnableOption "" // {
    description = ''Add a "Play on Pear Desktop" button to rich presence'';
    default = true;
  };
  hideGitHubButton = mkEnableOption "" // {
    description = ''Hide the "View App On GitHub" button in the rich presence'';
  };
  hideDurationLeft = mkEnableOption "" // {
    description = ''Hide the "duration left" in the rich presence'';
  };
  statusDisplayType = mkOption {
    description = ''
      Controls which field is displayed in the Discord status text

      0: Name
      1: State
      2: Details

      https://discord-api-types.dev/api/discord-api-types-v10/enum/StatusDisplayType
    '';
    default = 2;
    example = 1;
    type = types.enum [
      0
      1
      2
    ];
  };
}
