import { config, type PageContextOf } from "@pear/sdk";
import type { CosmeticsRequest } from "./engine.ts";

export const IN_PLAYER = "In player";
export const WITH_BLOCKLISTS = "With blocklists";

export const schema = {
  // Values are pear-desktop's, so its settings keep working.
  blocker: config.select(
    IN_PLAYER,
    [
      { value: IN_PLAYER, label: "In the player" },
      { value: WITH_BLOCKLISTS, label: "With blocklists" },
    ],
    {
      label: "Blocker",
      description:
        "In the player removes ad and tracking placements from \u0059\u006f\u0075\u0054\u0075\u0062\u0065's player data; with blocklists filters network requests " +
        "with pear-desktop's curated lists.",
    },
  ),
  skipAds: config.bool(true, {
    label: "Skip ads that still play",
    description: "Gets through them in a blink, muted, without cutting into the track.",
  }),
  cache: config.bool(true, {
    label: "Cache the blocklists",
    description: "Starts blocking instantly on launch; lists refresh in the background.",
    group: "Blocklists",
  }),
  additionalBlockLists: config.list([], {
    label: "Additional blocklists",
    placeholder: "https://…/filters.txt",
    description: "URLs of extra lists in Adblock Plus / uBlock syntax.",
    group: "Blocklists",
  }),
  disableDefaultLists: config.bool(false, {
    label: "Disable the default blocklists",
    description: "Only use the additional blocklists.",
    group: "Blocklists",
  }),
  // pear-desktop applied the lists' cosmetic filters too; their scriptlets for the video
  // site can desync playback, so those are opt-in.
  cosmeticFilters: config.select(
    "styles",
    [
      { value: "off", label: "Off" },
      { value: "styles", label: "Hide elements" },
      { value: "all", label: "Hide elements and run scriptlets" },
    ],
    {
      label: "Cosmetic filters",
      description: "The lists' element hiding; scriptlets may cut the start of tracks.",
      group: "Blocklists",
    },
  ),
};

export interface DoNotTrackCommands {
  /** The blocklists' cosmetic filters for the page (null until the lists are loaded). */
  cosmetics(request: CosmeticsRequest): { styles: string; scripts: string[] } | null;
}

export type Ctx = PageContextOf<typeof schema, DoNotTrackCommands>;
