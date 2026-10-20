// The dialog's shared state: the model, the expanded plugin card, and the
// changes that wait for a restart.

import type { Field } from "@pear/sdk";
import type { CoreSection } from "@pear/sdk/core-config";
import type { PluginInfo } from "@pear/sdk/protocol";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { SettingsModel } from "../model.ts";
import { localize } from "../strings.ts";
import type { Localizer } from "./groups.ts";

export interface Dialog {
  readonly model: SettingsModel;
  readonly platform: string;
  /** By name. */
  readonly plugins: readonly PluginInfo[];
  /** The plugin whose card is open. */
  readonly expanded: string | undefined;
  toggleExpanded(id: string): void;
  collapse(): void;
  /** Fields with their texts in the active language, for "core" or a plugin id. */
  localizer(owner: string): Localizer;
  setCore(section: CoreSection, key: string, field: Field, value: unknown): void;
  setPluginConfig(plugin: PluginInfo, key: string, field: Field, value: unknown): void;
  setPluginEnabled(plugin: PluginInfo, enabled: boolean): void;
  readonly restarts: PendingRestarts;
}

export function useDialog(model: SettingsModel): Dialog {
  useModel(model);
  const [expanded, setExpanded] = useState<string | undefined>();
  const restarts = usePendingRestarts(model);
  const plugins = useMemo(() => [...model.plugins].sort((a, b) => a.name.localeCompare(b.name)), [model.plugins]);
  return {
    model,
    platform: model.app.platform,
    plugins,
    expanded,
    toggleExpanded: (id) => setExpanded(expanded === id ? undefined : id),
    collapse: () => setExpanded(undefined),
    localizer: (owner) => (key, field) => localize(model.t, owner, key, field),
    setCore(section, key, field, value) {
      void model.setCoreConfig(section, { [key]: value });
      if (field.restart) restarts.flag(`core:${section}.${key}`);
    },
    setPluginConfig(plugin, key, field, value) {
      void model.setConfig(plugin.id, { [key]: value });
      if (field.restart) restarts.flag(`plugin:${plugin.id}.${key}`);
    },
    setPluginEnabled(plugin, enabled) {
      void model.setEnabled(plugin.id, enabled);
      if (model.meta(plugin.id)?.restartRequired) restarts.flag(`plugin:${plugin.id}`);
    },
    restarts,
  };
}

const increment = (n: number) => n + 1;

/** A function that re-renders the component. */
function useRerender() {
  const [, setTick] = useState(0);
  return () => setTick(increment);
}

/** Re-renders whenever the model changes. */
function useModel(model: SettingsModel) {
  const rerender = useRerender();
  useEffect(() => model.subscribe(rerender), [model]);
}

export interface PendingRestarts {
  /** Changes wait for a restart and the banner wasn't dismissed. */
  readonly show: boolean;
  /** Notes a change that applies after a restart (`key` names the setting). */
  flag(key: string): void;
  dismiss(): void;
}

// Restart-pending changes outlive the dialog (closing and reopening it keeps the banner).
const pendingRestarts = new WeakMap<SettingsModel, Set<string>>();

function usePendingRestarts(model: SettingsModel): PendingRestarts {
  const [dismissed, setDismissed] = useState(false);
  const rerender = useRerender();
  const pending = pendingRestarts.get(model) ?? new Set<string>();
  pendingRestarts.set(model, pending);
  return {
    show: pending.size > 0 && !dismissed,
    flag(key) {
      if (pending.has(key)) return;
      pending.add(key);
      setDismissed(false);
      rerender();
    },
    dismiss: () => setDismissed(true),
  };
}
