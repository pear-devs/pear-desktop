// The dialog's sections and what each one shows.

import type { CoreSection } from "@pear/sdk/core-config";
import type { IconName } from "../icons.tsx";
import type { Text, UiKey } from "../strings.ts";

export type Block =
  /** A core settings section, one card per field group. */
  | { kind: "core"; section: CoreSection; title?: UiKey }
  /** A plugin's card, embedded where it belongs thematically. */
  | { kind: "plugin"; id: string; title: UiKey }
  | { kind: "developer" }
  /** YTM's feature flags this session (only in YTM's page). */
  | { kind: "site-flags" };

export type SectionId = "general" | "appearance" | "window" | "advanced" | "developer" | "plugins" | "about";

export interface Section {
  id: SectionId;
  icon: IconName;
  /** What the section shows; "plugins" and "about" have views of their own. */
  blocks: Block[];
}

/** By id, in the sidebar's order. */
export const SECTIONS: Record<SectionId, Section> = {
  general: {
    id: "general",
    icon: "settings",
    blocks: [{ kind: "core", section: "general" }],
  },
  appearance: {
    id: "appearance",
    icon: "palette",
    blocks: [{ kind: "core", section: "appearance" }],
  },
  window: {
    id: "window",
    icon: "window",
    blocks: [
      { kind: "core", section: "window" },
      { kind: "plugin", id: "tray", title: "settings-ui.blocks.tray" },
      { kind: "plugin", id: "in-app-menu", title: "settings-ui.blocks.title-bar" },
    ],
  },
  advanced: {
    id: "advanced",
    icon: "tune",
    blocks: [
      { kind: "core", section: "advanced" },
      { kind: "core", section: "apiServer", title: "settings-ui.blocks.api-server" },
    ],
  },
  developer: {
    id: "developer",
    icon: "code",
    blocks: [{ kind: "core", section: "site" }, { kind: "site-flags" }, { kind: "developer" }],
  },
  plugins: { id: "plugins", icon: "puzzle", blocks: [] },
  about: { id: "about", icon: "info", blocks: [] },
};

export const sectionText = (text: Text, id: SectionId) => ({
  label: text(`settings-ui.sections.${id}.label`),
  sub: text(`settings-ui.sections.${id}.sub`),
});

/** "Label · Sub-label", leaving out the missing parts; undefined when both are. */
export function joinTitles(...titles: (string | undefined)[]) {
  return titles.filter(Boolean).join(" · ") || undefined;
}
