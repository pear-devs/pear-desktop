// The About section: versions and debug info.

import { useState } from "preact/hooks";
import { PearIcon } from "../icons.tsx";
import type { SettingsModel } from "../model.ts";
import { useText } from "../strings.ts";
import { CardGroup } from "./cards.tsx";

/** How long "Copied!" replaces the button's label. */
const COPIED_MS = 1500;

export function About({ model, enabled }: { model: SettingsModel; enabled: string[] }) {
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
  const enabledList = enabled.join(", ") || text("settings-ui.about.none");
  const debugInfo = [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    text("settings-ui.about.enabled-plugins", { plugins: enabledList }),
  ].join("\n");
  const copyDebugInfo = async () => {
    await navigator.clipboard.writeText(debugInfo);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
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
          <button type="button" class="outlined" onClick={() => void copyDebugInfo()}>
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
