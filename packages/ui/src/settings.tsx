// The settings dialog: a sidebar with search and sections (General, Window &
// Tray, Advanced, Plugins, About) and the selected section's cards. Shared by
// the in-page overlay and the standalone settings window.

import type { ConfigShape, Field } from "@pear/sdk";
import { CORE_SECTIONS, type CoreSection } from "@pear/sdk/core-config";
import type { PluginInfo } from "@pear/sdk/protocol";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SettingsField, Switch } from "./fields.tsx";
import { Icon, type IconName, PearIcon } from "./icons.tsx";
import type { SettingsModel } from "./model.ts";
import { localize, type Text, TranslateContext, type UiKey, useText } from "./strings.ts";

export type { SettingsModel } from "./model.ts";

type Block =
  /** A core settings section, one card per field group. */
  | { kind: "core"; section: CoreSection; title?: UiKey }
  /** A plugin's card, embedded where it belongs thematically. */
  | { kind: "plugin"; id: string; title: UiKey }
  | { kind: "developer" };

type SectionId = "general" | "appearance" | "window" | "advanced" | "plugins" | "about";

interface Section {
  id: SectionId;
  icon: IconName;
  blocks: Block[];
}

const sectionText = (text: Text, id: SectionId) => ({
  label: text(`settings-ui.sections.${id}.label`),
  sub: text(`settings-ui.sections.${id}.sub`),
});

const SECTIONS: Section[] = [
  {
    id: "general",
    icon: "settings",
    blocks: [{ kind: "core", section: "general" }],
  },
  {
    id: "appearance",
    icon: "palette",
    blocks: [{ kind: "core", section: "appearance" }],
  },
  {
    id: "window",
    icon: "window",
    blocks: [
      { kind: "core", section: "window" },
      { kind: "plugin", id: "tray", title: "settings-ui.blocks.tray" },
      { kind: "plugin", id: "in-app-menu", title: "settings-ui.blocks.title-bar" },
    ],
  },
  {
    id: "advanced",
    icon: "tune",
    blocks: [
      { kind: "core", section: "advanced" },
      { kind: "core", section: "apiServer", title: "settings-ui.blocks.api-server" },
      { kind: "developer" },
    ],
  },
  { id: "plugins", icon: "puzzle", blocks: [] },
  { id: "about", icon: "info", blocks: [] },
];

interface Group {
  title: string | undefined;
  fields: [key: string, field: Field][];
}

/** Consecutive fields with the same `group` form a card; fields for other platforms are left out. */
function groupFields(
  shape: ConfigShape,
  platform: string,
  filter?: (key: string, field: Field) => boolean,
  localized?: (key: string, field: Field) => Field,
): Group[] {
  const groups: Group[] = [];
  for (const [key, original] of Object.entries(shape)) {
    const field = localized ? localized(key, original) : original;
    if (field.platforms && !(field.platforms as readonly string[]).includes(platform)) continue;
    if (filter && !filter(key, field)) continue;
    const last = groups.at(-1);
    if (last && last.title === field.group) last.fields.push([key, field]);
    else groups.push({ title: field.group, fields: [[key, field]] });
  }
  return groups;
}

const matches = (needle: string, ...parts: (string | undefined)[]) =>
  parts.some((part) => part?.toLowerCase().includes(needle));

const fieldMatches = (needle: string) => (_: string, field: Field) => matches(needle, field.label, field.description);

// Restart-pending changes outlive the dialog (closing and reopening it keeps the banner).
const pendingRestarts = new WeakMap<SettingsModel, Set<string>>();

function useModel(model: SettingsModel) {
  const [, setTick] = useState(0);
  useEffect(() => model.subscribe(() => setTick((t) => t + 1)), [model]);
}

export function Settings(props: { model: SettingsModel; onClose(): void; standalone?: boolean }) {
  return (
    <TranslateContext.Provider value={props.model.t}>
      <Dialog {...props} />
    </TranslateContext.Provider>
  );
}

function Dialog({ model, onClose, standalone = false }: { model: SettingsModel; onClose(): void; standalone?: boolean }) {
  useModel(model);
  const text = useText();
  const coreField = (key: string, field: Field) => localize(model.t, "core", key, field);
  const [active, setActive] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState(false);
  const [, setPendingTick] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);

  let pending = pendingRestarts.get(model);
  if (!pending) pendingRestarts.set(model, (pending = new Set()));
  const flagRestart = (key: string) => {
    if (pending.has(key)) return;
    pending.add(key);
    setDismissed(false);
    setPendingTick((t) => t + 1);
  };

  const plugins = useMemo(() => [...model.plugins].sort((a, b) => a.name.localeCompare(b.name)), [model.plugins]);
  const platform = model.app.platform;
  const needle = query.trim().toLowerCase();
  const section = SECTIONS.find((s) => s.id === active)!;
  const sectionLabels = sectionText(text, active);
  const enabledCount = plugins.filter((p) => model.state(p.id)?.enabled).length;

  const setCore = (sectionId: CoreSection, key: string, field: Field, value: unknown) => {
    void model.setCoreConfig(sectionId, { [key]: value });
    if (field.restart) flagRestart(`core:${sectionId}.${key}`);
  };
  const setPluginConfig = (plugin: PluginInfo, key: string, field: Field, value: unknown) => {
    void model.setConfig(plugin.id, { [key]: value });
    if (field.restart) flagRestart(`plugin:${plugin.id}.${key}`);
  };
  const setPluginEnabled = (plugin: PluginInfo, enabled: boolean) => {
    void model.setEnabled(plugin.id, enabled);
    if (model.meta(plugin.id)?.restartRequired) flagRestart(`plugin:${plugin.id}`);
  };

  const coreCards = (sectionId: CoreSection, title?: string, filter?: (key: string, field: Field) => boolean) => {
    const state = model.core(sectionId);
    if (!state) return null;
    const groups = groupFields(CORE_SECTIONS[sectionId] as ConfigShape, platform, filter, coreField);
    return groups.map((group, index) => (
      <CardGroup
        key={`${sectionId}-${index}`}
        title={[title, group.title].filter(Boolean).join(" · ") || undefined}
        data-core={sectionId}
      >
        {group.fields.map(([key, field]) => (
          <SettingsField
            key={key}
            name={`core-${sectionId}-${key}`}
            field={field}
            value={state.config[key]}
            onChange={(value) => setCore(sectionId, key, field, value)}
          />
        ))}
        {index === 0 && (state.status || state.error) && (
          <div class="card-status" data-status={state.status ? "" : undefined} data-error={state.error ? "" : undefined}>
            {state.error ?? text("settings-ui.api-server-status", { address: state.status })}
          </div>
        )}
      </CardGroup>
    ));
  };

  const pluginCard = (plugin: PluginInfo, options: { forceOpen?: boolean; filter?: (key: string, field: Field) => boolean } = {}) => (
    <PluginCard
      key={plugin.id}
      plugin={plugin}
      model={model}
      platform={platform}
      open={options.forceOpen ?? expanded === plugin.id}
      {...(options.filter ? { filter: options.filter } : {})}
      onToggleOpen={() => setExpanded(expanded === plugin.id ? undefined : plugin.id)}
      onEnabled={(enabled) => setPluginEnabled(plugin, enabled)}
      onConfig={(key, field, value) => setPluginConfig(plugin, key, field, value)}
    />
  );

  const renderBlock = (block: Block) => {
    switch (block.kind) {
      case "core":
        return coreCards(block.section, block.title && text(block.title));
      case "plugin": {
        const plugin = plugins.find((p) => p.id === block.id);
        return plugin && (
          <div class="group" key={block.id}>
            <div class="group-title">{text(block.title)}</div>
            {pluginCard(plugin)}
          </div>
        );
      }
      case "developer":
        return (
          <CardGroup key="developer" title={text("settings-ui.blocks.developer")}>
            <div class="field actions">
              <button type="button" class="outlined" onClick={() => void model.toggleDevTools()}>
                {text("settings-ui.toggle-devtools")}
              </button>
              <button type="button" class="outlined" onClick={() => void model.showSettingsFile()}>
                {text("settings-ui.show-config")}
              </button>
            </div>
          </CardGroup>
        );
    }
  };

  const searchResults = () => {
    const blocks: ComponentChildren[] = [];
    for (const s of SECTIONS) {
      for (const block of s.blocks) {
        if (block.kind !== "core") continue;
        const label = sectionText(text, s.id).label;
        blocks.push(coreCards(block.section, [label, block.title && text(block.title)].filter(Boolean).join(" · "), fieldMatches(needle)));
      }
    }
    for (const plugin of plugins) {
      if (matches(needle, plugin.name, plugin.description, plugin.id)) {
        blocks.push(pluginCard(plugin));
        continue;
      }
      const filter = fieldMatches(needle);
      const localized = (key: string, field: Field) => localize(model.t, plugin.id, key, field);
      if (groupFields(plugin.config, platform, filter, localized).length > 0) blocks.push(pluginCard(plugin, { forceOpen: true, filter }));
    }
    const any = blocks.flat().some(Boolean);
    return any ? blocks : <div class="empty">{text("settings-ui.no-match", { query: query.trim() })}</div>;
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
              ref={search}
              type="search"
              placeholder={text("settings-ui.search-placeholder")}
              aria-label={text("settings-ui.search-placeholder")}
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </label>
          <nav class="nav" aria-label={text("settings-ui.sections-label")}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                class="nav-item"
                aria-current={!needle && active === s.id ? "page" : undefined}
                onClick={() => {
                  setActive(s.id);
                  setQuery("");
                  setExpanded(undefined);
                }}
              >
                <Icon name={s.icon} />
                <span class="nav-label">{sectionText(text, s.id).label}</span>
                {s.id === "plugins" && (
                  <span class="nav-count">
                    {enabledCount}/{plugins.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div class="sidebar-foot">
            <span>v{model.app.version}</span>
            <button type="button" class="link" onClick={() => void model.showSettingsFile()}>
              {text("settings-ui.show-config")}
            </button>
          </div>
        </aside>

        <section class="main">
          <header class="header">
            <div class="header-text">
              <div class="header-title">{needle ? text("settings-ui.search-results") : sectionLabels.label}</div>
              <div class="header-sub">{needle ? text("settings-ui.search-matching", { query: query.trim() }) : sectionLabels.sub}</div>
            </div>
            {!standalone && (
              <button type="button" class="icon-button" aria-label={text("settings-ui.close")} onClick={onClose}>
                <Icon name="close" size={22} />
              </button>
            )}
          </header>

          {pending.size > 0 && !dismissed && (
            <div class="restart" role="status">
              <Icon name="schedule" />
              <span class="restart-text">{text("settings-ui.restart-banner")}</span>
              <button type="button" class="restart-later" onClick={() => setDismissed(true)}>
                {text("settings-ui.later")}
              </button>
              <button type="button" class="restart-now" onClick={() => void model.relaunch()}>
                {text("settings-ui.restart-now")}
              </button>
            </div>
          )}

          <div class="body">
            {needle ? (
              searchResults()
            ) : active === "plugins" ? (
              plugins.map((plugin) => pluginCard(plugin))
            ) : active === "about" ? (
              <About model={model} enabled={plugins.filter((p) => model.state(p.id)?.enabled).map((p) => p.name)} />
            ) : (
              section.blocks.map(renderBlock)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CardGroup(props: { title: string | undefined; children: ComponentChildren; "data-core"?: string }) {
  return (
    <div class="group" data-core={props["data-core"]}>
      {props.title && <div class="group-title">{props.title}</div>}
      <div class="card">{props.children}</div>
    </div>
  );
}

function PluginCard(props: {
  plugin: PluginInfo;
  model: SettingsModel;
  platform: string;
  open: boolean;
  filter?: (key: string, field: Field) => boolean;
  onToggleOpen(): void;
  onEnabled(enabled: boolean): void;
  onConfig(key: string, field: Field, value: unknown): void;
}) {
  const { plugin, model, open } = props;
  const text = useText();
  const localized = (key: string, field: Field) => localize(model.t, plugin.id, key, field);
  const state = model.state(plugin.id);
  const enabled = state?.enabled ?? false;
  const error = model.error(plugin.id);
  const status = model.status(plugin.id);
  const groups = groupFields(plugin.config, props.platform, props.filter, localized);
  const actions = plugin.actions ?? [];
  const configurable = groupFields(plugin.config, props.platform).length > 0 || actions.length > 0;

  return (
    <section class="card plugin" data-plugin={plugin.id} data-open={open}>
      <div class="plugin-head">
        <button
          type="button"
          class="plugin-toggle"
          disabled={!configurable}
          aria-expanded={configurable ? open : undefined}
          aria-label={text("settings-ui.configure", { name: plugin.name })}
          onClick={props.onToggleOpen}
        >
          <span class="field-text">
            <span class="label-line">
              <span class="field-label">{plugin.name}</span>
              {model.meta(plugin.id)?.restartRequired && (
                <span class="pill" title={text("settings-ui.restart-plugin-hint")}>
                  {text("settings-ui.restart-pill")}
                </span>
              )}
              {error && enabled && <span class="pill error">{text("settings-ui.error-pill")}</span>}
            </span>
            {plugin.description && <span class="field-desc">{plugin.description}</span>}
          </span>
          {configurable && <Icon name={open ? "chevronDown" : "chevronRight"} />}
        </button>
        <Switch checked={enabled} label={text("settings-ui.enable", { name: plugin.name })} onChange={props.onEnabled} />
      </div>
      {error && enabled && <p class="error-text">{error}</p>}
      {status && enabled && !error && <p class="status-text" role="status">{status}</p>}
      {open && state && (groups.length > 0 || (enabled && actions.length > 0)) && (
        <div class="plugin-body">
          {enabled && actions.length > 0 && <PluginActions id={plugin.id} actions={actions} model={model} />}
          {groups.map((group, index) => (
            <div key={index} class="plugin-group">
              {group.title && <div class="plugin-group-title">{group.title}</div>}
              {group.fields.map(([key, field]) => (
                <SettingsField
                  key={key}
                  name={`${plugin.id}-${key}`}
                  field={field}
                  value={state.config[key]}
                  onChange={(value) => props.onConfig(key, field, value)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function About({ model, enabled }: { model: SettingsModel; enabled: string[] }) {
  const { app } = model;
  const text = useText();
  const [copied, setCopied] = useState(false);
  const rows: [string, string][] = [
    ["Pear Desktop", `v${app.version}`],
    ["Electron", app.electron],
    ["Chromium", app.chrome],
    ["Node.js", app.node],
    [text("settings-ui.about.platform"), `${app.platform} (${app.arch})`],
  ];
  const debugInfo = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    text("settings-ui.about.enabled-plugins", { plugins: enabled.join(", ") || text("settings-ui.about.none") }),
  ].join("\n");
  return (
    <div class="about">
      <div class="about-header">
        <PearIcon size={88} />
        <div class="about-name">Pear Desktop</div>
        <div class="about-version">v{app.version}</div>
        <div class="about-tagline">{text("settings-ui.about.tagline")}</div>
      </div>
      <CardGroup title={text("settings-ui.about.versions")}>
        <dl class="about-grid">
          {rows.map(([label, value]) => (
            <div key={label} class="about-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </CardGroup>
      <CardGroup title={text("settings-ui.about.actions")}>
        <div class="field actions">
          <button
            type="button"
            class="outlined"
            onClick={() =>
              void navigator.clipboard.writeText(debugInfo).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? text("settings-ui.about.copied") : text("settings-ui.about.copy-debug")}
          </button>
          <button type="button" class="outlined" onClick={() => void model.showSettingsFile()}>
            {text("settings-ui.show-config")}
          </button>
        </div>
      </CardGroup>
    </div>
  );
}

/** The plugin's settings buttons (e.g. "Connect"); each runs its host command. */
function PluginActions(props: { id: string; actions: NonNullable<PluginInfo["actions"]>; model: SettingsModel }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const run = async (name: string) => {
    setBusy(name);
    setFailed(null);
    try {
      await props.model.runAction(props.id, name);
    } catch (error) {
      setFailed(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="plugin-group plugin-actions">
      {props.actions.map((action) => (
        <div key={action.name} class="field" data-action={action.name}>
          <div class="field-row">
            <div class="field-text">{action.description && <div class="field-desc">{action.description}</div>}</div>
            <button type="button" class="outlined" disabled={busy !== null} onClick={() => void run(action.name)}>
              {action.label}
            </button>
          </div>
        </div>
      ))}
      {failed && <p class="error-text">{failed}</p>}
    </div>
  );
}
