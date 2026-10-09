{ lib, ... }:
let
  inherit (lib) mkEnableOption mkOption types;
in
{
  enable = mkEnableOption "Scrobbler plugin";
  scrobbleOtherMedia = mkEnableOption "" // {
    description = "Attempt to scrobble other video types (e.g. Podcasts, normal videos)";
    default = true;
  };
  alternativeTitles = mkEnableOption "" // {
    description = ''
      Use alternative titles for scrobbling (Useful for non-roman song titles, e.g. (Not) A Devil -> デビルじゃないもん)
    '';
    default = true;
  };
  alternativeArtist = mkEnableOption "" // {
    description = ''
      Use alternative artist for scrobbling (e.g., DECO27 & (or) PinocchioP -> DECO27 / marasy -> まらしぃ)
    '';
    default = true;
  };
  scrobblers = {
    lastfm = {
      enable = mkEnableOption "Last.fm scrobbling";
      token = mkOption {
        description = "Token used for authentication";
        default = null;
        type = with types; nullOr str;
      };
      sessionKey = mkOption {
        description = "Session key used for scrobbling";
        default = null;
        type = with types; nullOr str;
      };
      apiRoot = mkOption {
        description = "Root of the Last.fm API";
        default = null;
        example = "https://ws.audioscrobbler.com/2.0/";
        type = with types; nullOr str;
      };
      apiKey = mkOption {
        description = "Last.fm api key";
        default = null;
        type = with types; nullOr str;
      };
      secret = mkOption {
        description = "Last.fm api secret";
        default = null;
        type = with types; nullOr str;
      };
    };
    listenbrainz = {
      enable = mkEnableOption "ListenBrainz scrobbling";
      token = mkOption {
        description = "ListenBrainz API key";
        default = null;
        type = types.nullOr types.str;
      };
      apiRoot = mkOption {
        description = "Root of the ListenBrainz API";
        default = null;
        example = "https://api.listenbrainz.org/1/";
        type = with types; nullOr str;
      };
    };
  };
}
