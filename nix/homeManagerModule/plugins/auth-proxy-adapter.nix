{ lib, ... }:
let
  inherit (lib) mkOption mkEnableOption types;
in
{
  enable = mkEnableOption "Auth Proxy Adapter plugin";
  hostname = mkOption {
    default = "127.0.0.1";
    type = types.str;
    description = "auth proxy host";
  };
  port = mkOption {
    default = 4545;
    type = types.port;
    description = "auth proxy port";
  };
}
