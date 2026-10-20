import { config, type ConfigOf } from "@pear/sdk";

export const schema = {
  preferredProvider: config.select(
    "auto",
    [
      // pear-desktop's provider names, so its setting carries over.
      { value: "auto", label: "Best available" },
      { value: "LRCLib", label: "LRCLIB" },
      { value: "YTMusic", label: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music" },
      { value: "MusixMatch", label: "Musixmatch" },
      { value: "Megalobiz", label: "Megalobiz" },
      { value: "LyricsGenius", label: "Genius" },
    ],
    { label: "Preferred provider", description: "Used whenever it has lyrics; otherwise word-synced beats line-synced beats plain." },
  ),
  lineEffect: config.select(
    "fancy",
    [
      { value: "fancy", label: "Fancy (glow)" },
      { value: "scale", label: "Scale" },
      { value: "offset", label: "Offset" },
      { value: "focus", label: "Focus (blur others)" },
    ],
    { label: "Current line effect" },
  ),
  gapText: config.select(
    "dots",
    [
      { value: "dots", label: "Animated dots" },
      { value: "bullets", label: "•••" },
      { value: "note", label: "♪" },
      { value: "dash", label: "———" },
      { value: "none", label: "Nothing" },
    ],
    { label: "Instrumental breaks" },
  ),
  showTimeCodes: config.bool(false, { label: "Show time codes" }),
  offsetMs: config.number(0, {
    label: "Timing offset",
    description: "Positive values show lines earlier.",
    min: -2000,
    max: 2000,
    step: 50,
    unit: "ms",
  }),
  romanization: config.bool(true, {
    label: "Romanize lyrics",
    description: "Japanese, Korean and Chinese. The Japanese dictionary (about 17 MB) downloads on first use.",
  }),
  convertChinese: config.select(
    "off",
    [
      { value: "off", label: "Keep as is" },
      { value: "s2t", label: "Simplified → Traditional" },
      { value: "t2s", label: "Traditional → Simplified" },
    ],
    { label: "Chinese characters" },
  ),
  showLyricsEvenIfInexact: config.bool(true, {
    label: "Show lyrics even if inexact",
    description: "Also try looser searches; may occasionally match a different version of the song.",
  }),
  musixmatchToken: config.string("", {
    label: "Musixmatch user token",
    description:
      "Musixmatch only serves lyrics to signed-in apps: the usertoken of your own Musixmatch desktop app session. Without one, Musixmatch reports that it needs it.",
    secret: true,
  }),
};

export type LyricsConfig = ConfigOf<typeof schema>;
