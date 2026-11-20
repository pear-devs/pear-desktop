{ lib, ... }:
let
  inherit (lib) mkOption mkEnableOption types;
in
{
  enable = mkEnableOption "API Server plugin";
  hostname = mkOption {
    default = null;
    type = with types; nullOr str;
    example = "0.0.0.0";
    description = "API server host";
  };
  port = mkOption {
    default = null;
    type = with types; nullOr port;
    example = 26538;
    description = "API server port";
  };
  authStrategy = mkOption {
    type = types.enum [
      "AUTH_AT_FIRST"
      "NONE"
    ];
    default = "AUTH_AT_FIRST";
    description = "API server authentication";
  };
  secret = mkOption {
    default = null;
    type = with types; nullOr str;
    internal = true;
  };
  authorizedClients = mkOption {
    default = [ ];
    type = types.listOf types.str;
    internal = true;
  };
  useHttps = mkEnableOption "HTTPS support";
  certPath = mkOption {
    description = "string path to HTTPS certificate";
    type = with types; nullOr str;
    default = null;
  };
  keyPath = mkOption {
    description = "path to HTTPS key";
    type = with types; nullOr str;
    default = null;
  };
}
