{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "SponsorBlock plugin";
  apiURL = mkOption {
    default = "https://sponsor.ajay.app";
    type = types.str;
    description = "API url";
    internal = true;
  };
  categories =
    let
      categoryList = [
        "sponsor"
        "intro"
        "outro"
        "interaction"
        "selfpromo"
        "music_offtopic"
      ];
    in
    mkOption {
      default = categoryList;
      description = "SponsorBlock categories";
      type = types.listOf (types.enum categoryList);
      internal = true;
    };
}
