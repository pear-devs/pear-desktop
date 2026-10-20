// Entry of the standalone settings window (pear://settings): the settings
// dialog full-window, over the bridge the preload exposes. No page runtime.

import type { Bridge } from "@pear/sdk/protocol";
import { render } from "preact";
import { bridgeModel } from "./model.ts";
import { Settings } from "./settings.tsx";
import { overlayStyles } from "./styles.ts";

const bridge = (window as Window & { __pear?: Bridge }).__pear;
if (!bridge) throw new Error("[pear] settings window: bridge missing");

const host = document.createElement("pear-settings");
const shadow = host.attachShadow({ mode: "open" });
const style = new CSSStyleSheet();
style.replaceSync(overlayStyles);
shadow.adoptedStyleSheets = [style];
document.body.append(host);
render(<Settings model={bridgeModel(bridge)} onClose={() => window.close()} standalone />, shadow);
