{
  pearLib,
}:
{
  options,
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkIf
    mkOption
    mkEnableOption
    mkPackageOption
    mkRenamedOptionModule
    ;
  cfg = config.programs.pear-desktop;
in
{
  options.programs.pear-desktop = {
    enable = mkEnableOption "Pear Desktop";

    package = mkPackageOption pkgs "pear-desktop" { };

    url = mkOption {
      default = "https://music.youtube.com";
      description = ''
        Starting page url.

        This is only used if `options.resumeOnStart` is enabled.

        This is set internally by the application.
      '';
      type = lib.types.str;
      internal = true;
    };

    version = mkOption {
      description = "Version used in migrations";
      default = "3.12.0";
      type = lib.types.str;
      internal = true;
    };
  };

  imports = [
    ./options.nix
    ./plugins
    (mkRenamedOptionModule
      [
        "programs"
        "youtube-music"
      ]
      [
        "programs"
        "pear-desktop"
      ]
    )
  ];

  config =
    let
      configPath = "YouTube Music/config.json";
      hmConfigPath = "YouTube Music/hm_config.json";
    in
    mkIf cfg.enable {
      home.packages = [ cfg.package ];

      xdg.configFile.${hmConfigPath} = {
        source = pkgs.writeText "pear-desktop-config.json" (
          pearLib.mkPearDesktopConfig { inherit options config; }
        );

        onChange =
          let
            hmConfigFile = "${config.xdg.configHome}/${hmConfigPath}";
            configFile = "${config.xdg.configHome}/${configPath}";
          in
          ''
            run install -Dm664 $VERBOSE_ARG '${hmConfigFile}' '${configFile}'
          '';
      };
    };
}
