// The dialog's frame: the sidebar (search, sections), the header and the restart banner.

import type { Ref } from "preact";
import { Icon, PearIcon } from "../icons.tsx";
import { useText } from "../strings.ts";
import { SECTIONS, type SectionId, sectionText } from "./sections.ts";
import type { Dialog, PendingRestarts } from "./state.ts";

export function Sidebar(props: {
  dialog: Dialog;
  query: string;
  onQuery(query: string): void;
  /** The section shown, or undefined while searching. */
  current: SectionId | undefined;
  onSection(id: SectionId): void;
  enabledCount: number;
  searchRef: Ref<HTMLInputElement>;
}) {
  const { dialog } = props;
  const text = useText();
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="sidebar-title" id="pear-title">
          {text("settings-ui.title")}
        </div>
        <div class="sidebar-subtitle">
          <PearIcon size={14} /> Pear Desktop
        </div>
      </div>
      <label class="search">
        <Icon name="search" />
        <input
          ref={props.searchRef}
          type="search"
          placeholder={text("settings-ui.search-placeholder")}
          aria-label={text("settings-ui.search-placeholder")}
          value={props.query}
          onInput={(e) => props.onQuery(e.currentTarget.value)}
        />
      </label>
      <nav class="nav" aria-label={text("settings-ui.sections-label")}>
        {Object.values(SECTIONS).map((s) => (
          <button
            key={s.id}
            type="button"
            class="nav-item"
            aria-current={props.current === s.id ? "page" : undefined}
            onClick={() => props.onSection(s.id)}
          >
            <Icon name={s.icon} />
            <span class="nav-label">{sectionText(text, s.id).label}</span>
            {s.id === "plugins" && (
              <span class="nav-count">
                {props.enabledCount}/{dialog.plugins.length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div class="sidebar-foot">
        <span>v{dialog.model.app.version}</span>
        <button type="button" class="link" onClick={() => void dialog.model.showSettingsFile()}>
          {text("settings-ui.show-config")}
        </button>
      </div>
    </aside>
  );
}

/** The section's (or the search's) title; a close button unless the dialog is a window of its own. */
export function Header(props: { title: string; sub: string; onClose: (() => void) | undefined }) {
  const text = useText();
  return (
    <header class="header">
      <div class="header-text">
        <div class="header-title">{props.title}</div>
        <div class="header-sub">{props.sub}</div>
      </div>
      {props.onClose && (
        <button type="button" class="icon-button" aria-label={text("settings-ui.close")} onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
      )}
    </header>
  );
}

export function RestartBanner({ restarts, onRestart }: { restarts: PendingRestarts; onRestart(): void }) {
  const text = useText();
  if (!restarts.show) return null;
  return (
    <div class="restart" role="status">
      <Icon name="schedule" />
      <span class="restart-text">{text("settings-ui.restart-banner")}</span>
      <button type="button" class="restart-later" onClick={restarts.dismiss}>
        {text("settings-ui.later")}
      </button>
      <button type="button" class="restart-now" onClick={onRestart}>
        {text("settings-ui.restart-now")}
      </button>
    </div>
  );
}
