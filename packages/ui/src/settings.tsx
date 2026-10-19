import type { AnyPlugin, ConfigShape } from "@pear/sdk";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import type { PluginMeta, PluginState } from "@pear/sdk/protocol";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FieldEditor, Switch } from "./fields.tsx";

/** What the overlay needs from the page runtime. */
export interface SettingsModel {
  readonly version: string;
  readonly plugins: readonly AnyPlugin[];
  state(id: string): PluginState | undefined;
  error(id: string): string | undefined;
  meta(id: string): PluginMeta | undefined;
  subscribe(listener: () => void): () => void;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  setConfig(id: string, patch: Record<string, unknown>): Promise<unknown>;
  relaunch(): Promise<unknown>;
}

type Filter = "all" | "enabled" | "disabled";

function useModel(model: SettingsModel) {
  const [, setTick] = useState(0);
  useEffect(() => model.subscribe(() => setTick((t) => t + 1)), [model]);
}

export function Settings({ model, onClose }: { model: SettingsModel; onClose(): void }) {
  useModel(model);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | undefined>();
  const search = useRef<HTMLInputElement>(null);
  // Plugins whose enabled state differs from launch and that only fully apply after a restart.
  const initial = useRef(new Map(model.plugins.map((p) => [p.id, model.state(p.id)?.enabled ?? false])));

  useEffect(() => search.current?.focus(), []);

  const plugins = useMemo(() => [...model.plugins].sort((a, b) => a.name.localeCompare(b.name)), [model.plugins]);
  const needle = query.trim().toLowerCase();
  const visible = plugins.filter((plugin) => {
    const enabled = model.state(plugin.id)?.enabled ?? false;
    if (filter === "enabled" && !enabled) return false;
    if (filter === "disabled" && enabled) return false;
    return !needle || `${plugin.name} ${plugin.description ?? ""} ${plugin.id}`.toLowerCase().includes(needle);
  });
  const enabledCount = plugins.filter((p) => model.state(p.id)?.enabled).length;
  const restartPending = plugins.some(
    (p) => model.meta(p.id)?.restartRequired && initial.current.get(p.id) !== (model.state(p.id)?.enabled ?? false),
  );

  return (
    <div
      class="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pear-title">
        <header>
          <div class="brand">
            <PearIcon />
            <h1 id="pear-title">Pear Desktop</h1>
            <span>Settings</span>
          </div>
          <input
            ref={search}
            class="search"
            type="search"
            placeholder="Search plugins"
            aria-label="Search plugins"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button type="button" class="icon-button" aria-label="Close settings" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        {restartPending && (
          <div class="banner" role="status">
            Some changes take full effect after a restart.
            <button type="button" class="button primary" onClick={() => void model.relaunch()}>
              Restart now
            </button>
          </div>
        )}

        <div class="toolbar" role="group" aria-label="Filter plugins">
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button key={f} type="button" class="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
          <span class="count">
            {enabledCount} of {plugins.length} enabled
          </span>
        </div>

        <div class="list">
          {visible.length === 0 && <div class="empty">No plugins match “{query}”.</div>}
          {visible.map((plugin) => (
            <PluginItem
              key={plugin.id}
              plugin={plugin}
              model={model}
              open={open === plugin.id}
              onToggleOpen={() => setOpen(open === plugin.id ? undefined : plugin.id)}
            />
          ))}
        </div>

        <footer>
          <span>Pear Desktop {model.version}</span>
          <span>
            <kbd>Ctrl</kbd> <kbd>,</kbd> toggles this window
          </span>
        </footer>
      </div>
    </div>
  );
}

function PluginItem(props: { plugin: AnyPlugin; model: SettingsModel; open: boolean; onToggleOpen(): void }) {
  const { plugin, model, open } = props;
  const state = model.state(plugin.id);
  const enabled = state?.enabled ?? false;
  const error = model.error(plugin.id);
  const fields = Object.entries((plugin.config ?? {}) as ConfigShape);
  const configurable = fields.length > 0;

  return (
    <section class="plugin" data-open={open} data-plugin={plugin.id}>
      <div class="plugin-row">
        <div class="plugin-main">
          <div class="plugin-name">
            {plugin.name}
            {model.meta(plugin.id)?.restartRequired && <span class="badge">restart to apply</span>}
            {error && enabled && <span class="badge error">error</span>}
          </div>
          {plugin.description && <div class="plugin-description">{plugin.description}</div>}
        </div>
        {configurable && (
          <button
            type="button"
            class="icon-button expand"
            aria-expanded={open}
            aria-label={`Configure ${plugin.name}`}
            onClick={props.onToggleOpen}
          >
            <ChevronIcon />
          </button>
        )}
        <Switch
          checked={enabled}
          label={`Enable ${plugin.name}`}
          onChange={(next) => void model.setEnabled(plugin.id, next)}
        />
      </div>
      {error && enabled && <p class="error-text">{error}</p>}
      {open && configurable && state && (
        <div class="fields">
          {fields.map(([key, field]) => (
            <FieldEditor
              key={key}
              name={`${plugin.id}-${key}`}
              field={field}
              value={state.config[key]}
              onChange={(value) => void model.setConfig(plugin.id, { [key]: value })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const APP_ICON = embed("generated/icons/png/128x128.png");

export function PearIcon({ size = 22 }: { size?: number }) {
  return <img src={`data:image/png;base64,${APP_ICON}`} width={size} height={size} alt="" aria-hidden="true" />;
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" />
    </svg>
  );
}
