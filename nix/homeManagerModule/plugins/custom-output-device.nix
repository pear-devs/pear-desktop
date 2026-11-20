{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Custom output device plugin";
  output = mkOption {
    type = types.str;
    default = "output";
    description = ''
      AudioContext.sinkId

      [Link]: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/sinkId
    '';
  };
  devices = mkOption {
    type = with types; attrsOf str;
    default = { };
    description = ''
      Map of audio devices

      key: MediaDeviceInfo.deviceId
      value: MediaDeviceInfo.label

      P.S.: This is set by the application, you shouldn't *need* to change this.

      [Link]: https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo
    '';
  };
}
