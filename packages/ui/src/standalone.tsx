// Entry of the standalone settings window (pear://settings): the settings
// dialog full-window, over the bridge the preload exposes. No page runtime.

import { shadowHost } from "@pear/sdk/dom";
import type { Bridge } from "@pear/sdk/protocol";
import { render } from "preact";
import { bridgeModel } from "./model.ts";
import { Settings } from "./settings.tsx";
import { overlayStyles } from "./styles.ts";

const bridge = (window as Window & { __pear?: Bridge }).__pear;
if (!bridge) throw new Error("[pear] settings window: bridge missing");

const { host, root } = shadowHost("pear-settings", overlayStyles);
document.body.append(host);
render(<Settings model={bridgeModel(bridge)} onClose={() => window.close()} standalone />, root);
