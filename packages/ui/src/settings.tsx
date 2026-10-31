// The settings dialog: a sidebar with search and sections (General, Window &
// Tray, Advanced, Plugins, About) and the selected section's cards. Shared by
// the in-page overlay and the standalone settings window.

import { useEffect, useRef, useState } from "preact/hooks";
import type { SettingsModel } from "./model.ts";
import { SearchResults, SectionBody } from "./settings/body.tsx";
import { Header, RestartBanner, Sidebar } from "./settings/chrome.tsx";
import { SECTIONS, type SectionId, sectionText } from "./settings/sections.ts";
import { useDialog } from "./settings/state.ts";
import { TranslateContext, useText } from "./strings.ts";

export type { SettingsModel } from "./model.ts";

interface SettingsProps {
  model: SettingsModel;
  onClose(): void;
  standalone?: boolean;
}

export function Settings(props: SettingsProps) {
  return (
    <TranslateContext.Provider value={props.model.t}>
      <SettingsDialog {...props} />
    </TranslateContext.Provider>
  );
}

function SettingsDialog({ model, onClose, standalone = false }: SettingsProps) {
  const dialog = useDialog(model);
  const text = useText();
  const [active, setActive] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);

  const trimmed = query.trim();
  const searching = trimmed !== "";
  // Another section, or the search results, starts at the top, not where the last one was scrolled to.
  const body = useRef<HTMLDivElement>(null);
  const view = searching ? "search" : active;
  useEffect(() => body.current?.scrollTo(0, 0), [view]);
  const section = SECTIONS[active];
  const labels = sectionText(text, active);
  const enabled = dialog.plugins.filter((p) => model.state(p.id)?.enabled).map((p) => p.name);
  const showSection = (id: SectionId) => {
    setActive(id);
    setQuery("");
    dialog.collapse();
  };

  return (
    <div
      class="root"
      data-standalone={standalone}
      onMouseDown={(e) => {
        if (!standalone && e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dialog" role="dialog" aria-modal={!standalone} aria-labelledby="pear-title">
        <Sidebar
          dialog={dialog}
          query={query}
          onQuery={setQuery}
          current={searching ? undefined : active}
          onSection={showSection}
          enabledCount={enabled.length}
          searchRef={search}
        />
        <section class="main">
          <Header
            title={searching ? text("settings-ui.search-results") : labels.label}
            sub={searching ? text("settings-ui.search-matching", { query: trimmed }) : labels.sub}
            onClose={standalone ? undefined : onClose}
          />
          <RestartBanner restarts={dialog.restarts} onRestart={() => void model.relaunch()} />
          <div class="body" ref={body}>
            {searching ? (
              <SearchResults dialog={dialog} query={trimmed} />
            ) : (
              <SectionBody dialog={dialog} section={section} enabled={enabled} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
