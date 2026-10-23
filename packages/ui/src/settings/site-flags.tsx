// The site's feature flags as YTM served them this session, to find the
// ones worth overriding. Switching an on/off flag edits the "Feature flag
// overrides" list; like that list, it applies after a restart.

import { type FlagValue, type Flags, flagOverrides, SITE, withFlagOverride } from "@pear/sdk/core-config";
import { useState } from "preact/hooks";
import { Switch } from "../fields.tsx";
import { useText } from "../strings.ts";
import { CardGroup } from "./cards.tsx";
import type { Dialog } from "./state.ts";

/** Rows rendered at once; the filter narrows the rest down. */
const MAX_ROWS = 60;

export function SiteFlagsCard({ dialog, served }: { dialog: Dialog; served: Readonly<Flags> }) {
  const text = useText();
  const [filter, setFilter] = useState("");
  const entries = siteFlagEntries(dialog);
  const overrides = flagOverrides(entries);

  const needle = filter.trim().toLowerCase();
  const names = [...new Set([...Object.keys(served), ...Object.keys(overrides)])]
    .filter((name) => name.includes(needle))
    .sort();
  const shown = names.slice(0, MAX_ROWS);

  const setOverride = (name: string, value: FlagValue | undefined) =>
    dialog.setCore("site", "siteFlags", SITE.siteFlags, withFlagOverride(entries, name, value));

  return (
    <CardGroup title={text("settings-ui.blocks.site-flags")} data-core="site-flags">
      <div class="field">
        <div class="field-desc">{text("settings-ui.site-flags.hint")}</div>
        <div class="field-control">
          <input
            type="search"
            class="text"
            placeholder={text("settings-ui.site-flags.filter")}
            aria-label={text("settings-ui.site-flags.filter")}
            value={filter}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </div>
      </div>
      {shown.map((name) => (
        <FlagRow
          key={name}
          name={name}
          served={served[name]}
          override={overrides[name]}
          onChange={(value) => setOverride(name, value === served[name] ? undefined : value)}
          onReset={() => setOverride(name, undefined)}
        />
      ))}
      {names.length === 0 && <div class="field field-desc">{text("settings-ui.site-flags.empty")}</div>}
      {names.length > shown.length && (
        <div class="field field-desc">{text("settings-ui.site-flags.more", { count: names.length - shown.length })}</div>
      )}
    </CardGroup>
  );
}

function FlagRow(props: {
  name: string;
  served: FlagValue | undefined;
  override: FlagValue | undefined;
  onChange(value: FlagValue): void;
  onReset(): void;
}) {
  const text = useText();
  const overridden = props.override !== undefined;
  const value = overridden ? props.override : props.served;
  // Flags YTM leaves out are off.
  const isSwitch = value === undefined || typeof value === "boolean";
  return (
    <div class="field site-flag" data-flag={props.name}>
      <div class="field-row">
        <div class="field-text">
          <div class="label-line">
            <span class="field-label">{props.name}</span>
            {overridden && (
              <button type="button" class="pill" aria-label={text("settings-ui.site-flags.reset", { name: props.name })} onClick={props.onReset}>
                {text("settings-ui.site-flags.overridden")}
              </button>
            )}
          </div>
          {!isSwitch && <div class="field-desc">{JSON.stringify(value)}</div>}
        </div>
        {isSwitch && <Switch checked={value === true} label={props.name} onChange={props.onChange} />}
      </div>
    </div>
  );
}

const siteFlagEntries = (dialog: Dialog): string[] => {
  const stored = dialog.model.core("site")?.config.siteFlags;
  return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : [];
};
