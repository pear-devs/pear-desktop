import { definePlugin, type YTPlayerApi } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

interface QualityApi extends YTPlayerApi {
  getAvailableQualityLabels?(): string[];
  setPlaybackQuality?(quality: string): void;
}

// Material "settings" icon, like YTM's own.
const ICON =
  "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.1-1.65c.2-.15.25-.42.13-.64l-2-3.46c-.12-.22-.4-.3-.6-.22l-2.5 1c-.52-.4-1.08-.73-1.7-.98l-.37-2.65c-.06-.24-.27-.42-.5-.42h-4c-.27 0-.48.18-.5.42l-.4 2.65c-.6.25-1.17.6-1.7.98l-2.48-1c-.23-.1-.5 0-.6.22l-2 3.46c-.14.22-.08.5.1.64l2.12 1.65c-.04.32-.07.65-.07.98s.02.66.06.98l-2.1 1.65c-.2.15-.25.42-.13.64l2 3.46c.12.22.4.3.6.22l2.5-1c.52.4 1.08.73 1.7.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.6-.25 1.17-.6 1.7-.98l2.48 1c.23.1.5 0 .6-.22l2-3.46c.13-.22.08-.5-.1-.64l-2.12-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z";

export default definePlugin({
  id: "quality-changer",
  name: "Video quality changer",
  description: "Adds a quality picker to the top of the video player.",
  style: css`
    .pear-quality-button {
      anchor-name: --pear-quality;
      width: 40px;
      height: 40px;
      padding: 8px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: #fff;
      cursor: pointer;
    }
    .pear-quality-button:hover,
    .pear-quality-button[aria-expanded="true"] {
      background: rgb(255 255 255 / 0.15);
    }
    .pear-quality-button svg {
      display: block;
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    .pear-quality-popover {
      position-anchor: --pear-quality;
      position-area: bottom span-left;
      position-try-fallbacks: flip-block, flip-inline;
      inset: auto;
      margin: 4px 0;
      min-width: 160px;
      max-height: 60vh;
      overflow-y: auto;
      padding: 8px 0;
      border: 0;
      border-radius: 8px;
      background: #212121;
      color: #fff;
      font: 400 14px Roboto, sans-serif;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
    }
    .pear-quality-popover h2 {
      margin: 0;
      padding: 4px 16px 8px;
      color: #aaa;
      font: inherit;
      font-size: 12px;
    }
    .pear-quality-popover button {
      display: block;
      width: 100%;
      padding: 8px 16px 8px 36px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .pear-quality-popover button:hover {
      background: rgb(255 255 255 / 0.1);
    }
    .pear-quality-popover button[aria-checked="true"]::before {
      content: "✓";
      position: absolute;
      margin-left: -22px;
    }
    .pear-quality-popover p {
      margin: 0;
      padding: 4px 16px;
      color: #aaa;
    }
  `,
  page: async (ctx) => {
    const api = (await ctx.player.ready()) as QualityApi;

    const button = document.createElement("button");
    button.className = "pear-quality-button";
    // pear-desktop's text and translations.
    const buttonLabel = ctx.t("plugins.quality-changer.renderer.quality-settings-button.label", "Open player quality changer");
    button.title = buttonLabel;
    button.setAttribute("aria-label", buttonLabel);
    button.append(icon(ICON));
    const popover = document.createElement("div");
    popover.className = "pear-quality-popover";
    popover.popover = "auto";
    popover.setAttribute("role", "menu");
    button.popoverTargetElement = popover;
    // The top row sits inside YTM's player, which treats clicks as play/pause.
    button.addEventListener("click", (event) => event.stopPropagation());

    const render = () => {
      const levels = api.getAvailableQualityLevels();
      const labels = api.getAvailableQualityLabels?.() ?? [];
      const current = api.getPlaybackQuality();
      const heading = document.createElement("h2");
      heading.textContent = ctx.t("plugins.quality-changer.popover.heading", "Quality");
      const items = levels.map((level, i) => {
        const item = document.createElement("button");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", String(level === current));
        item.dataset.quality = level;
        item.textContent = level === "auto" ? ctx.t("plugins.quality-changer.popover.auto", "Auto") : (labels[i] ?? level);
        item.addEventListener("click", () => {
          api.setPlaybackQualityRange(level, level);
          api.setPlaybackQuality?.(level);
          popover.hidePopover();
        });
        return item;
      });
      if (items.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = ctx.t("plugins.quality-changer.popover.unavailable", "Not available for this track");
        popover.replaceChildren(heading, empty);
      } else {
        popover.replaceChildren(heading, ...items);
      }
    };
    popover.addEventListener("beforetoggle", (event) => {
      const open = (event as ToggleEvent).newState === "open";
      if (open) render();
      button.setAttribute("aria-expanded", String(open));
    });

    ctx.onCleanup(() => {
      button.remove();
      popover.remove();
    });
    document.body.append(popover);
    const row = await ctx.waitFor("player.top_row_buttons");
    row.prepend(button);
  },
});

function icon(path: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}
