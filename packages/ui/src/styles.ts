// Shadow-DOM styles for the settings dialog (Material 3, dark), validated and
// minified at build time, one part per component. Used by the in-page overlay
// and the standalone window.

import { about } from "./styles/about.ts";
import { base, scrollbars } from "./styles/base.ts";
import { cards, pluginCards } from "./styles/cards.ts";
import { controls, fieldRows } from "./styles/fields.ts";
import { layout } from "./styles/layout.ts";
import { palette } from "./styles/palette.ts";
import { sidebar } from "./styles/sidebar.ts";

// In cascade order: later parts override earlier ones.
export const overlayStyles = [palette, base, layout, sidebar, cards, fieldRows, pluginCards, controls, about, scrollbars].join("");
