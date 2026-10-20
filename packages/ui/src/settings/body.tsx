// What the dialog's body shows: a section, or the search results.

import type { ComponentChildren } from "preact";
import { useText } from "../strings.ts";
import { About } from "./about.tsx";
import { BlockView, CoreCards, coreGroups, PluginCard } from "./cards.tsx";
import { fieldMatches, groupFields, matches } from "./groups.ts";
import { joinTitles, SECTIONS, type Section, sectionText } from "./sections.ts";
import type { Dialog } from "./state.ts";

export function SectionBody({ dialog, section, enabled }: { dialog: Dialog; section: Section; enabled: string[] }) {
  switch (section.id) {
    case "plugins":
      return (
        <>
          {dialog.plugins.map((plugin) => (
            <PluginCard key={plugin.id} dialog={dialog} plugin={plugin} />
          ))}
        </>
      );
    case "about":
      return <About model={dialog.model} enabled={enabled} />;
    default:
      return (
        <>
          {section.blocks.map((block, index) => (
            <BlockView key={index} dialog={dialog} block={block} />
          ))}
        </>
      );
  }
}

/** Core fields and plugins matching `query`: a plugin by its name or description, or by its fields (shown open). */
export function SearchResults({ dialog, query }: { dialog: Dialog; query: string }) {
  const text = useText();
  const needle = query.toLowerCase();
  const filter = fieldMatches(needle);
  const results: ComponentChildren[] = [];

  for (const section of Object.values(SECTIONS)) {
    const label = sectionText(text, section.id).label;
    for (const block of section.blocks) {
      if (block.kind !== "core") continue;
      const groups = coreGroups(dialog, block.section, filter);
      if (groups.length === 0) continue;
      const title = joinTitles(label, block.title && text(block.title));
      results.push(<CoreCards dialog={dialog} section={block.section} groups={groups} title={title} />);
    }
  }
  for (const plugin of dialog.plugins) {
    if (matches(needle, plugin.name, plugin.description, plugin.id)) {
      results.push(<PluginCard key={plugin.id} dialog={dialog} plugin={plugin} />);
      continue;
    }
    const groups = groupFields(plugin.config, dialog.platform, dialog.localizer(plugin.id), filter);
    if (groups.length > 0) results.push(<PluginCard key={plugin.id} dialog={dialog} plugin={plugin} forceOpen groups={groups} />);
  }

  if (results.length === 0) return <div class="empty">{text("settings-ui.no-match", { query })}</div>;
  return <>{results}</>;
}
