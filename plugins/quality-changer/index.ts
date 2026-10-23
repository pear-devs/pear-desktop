import { definePlugin, type YTPlayerApi } from "@pear/sdk";
import { picker } from "@pear/sdk/dom";
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
  // White like the video's other buttons. Both classes, since the picker's sheet comes after this one.
  style: css`
    .pear-picker-button.pear-quality-button {
      color: #fff;
    }
    .pear-picker-button.pear-quality-button:hover,
    .pear-picker-button.pear-quality-button[aria-expanded="true"] {
      background: rgb(255 255 255 / 0.15);
    }
    .pear-picker-popover.pear-quality-popover {
      margin: 4px 0;
      max-height: 60vh;
    }
  `,
  page: async (ctx) => {
    const api = (await ctx.player.ready()) as QualityApi;

    const qualities = () => {
      const labels = api.getAvailableQualityLabels?.() ?? [];
      const current = api.getPlaybackQuality();
      return api.getAvailableQualityLevels().map((level, i) => ({
        label: level === "auto" ? ctx.t("plugins.quality-changer.popover.auto", "Auto") : (labels[i] ?? level),
        checked: level === current,
        attributes: { "data-quality": level },
        select() {
          api.setPlaybackQualityRange(level, level);
          api.setPlaybackQuality?.(level);
        },
      }));
    };

    const { button } = picker(ctx, {
      name: "quality",
      // pear-desktop's text and translations.
      label: ctx.t("plugins.quality-changer.renderer.quality-settings-button.label", "Open player quality changer"),
      icon: ICON,
      heading: ctx.t("plugins.quality-changer.popover.heading", "Quality"),
      empty: ctx.t("plugins.quality-changer.popover.unavailable", "Not available for this track"),
      items: qualities,
      position: "bottom span-left",
      width: 160,
      isolateClicks: true,
    });
    ctx.mount(button, "player.top_row_buttons", "prepend");
  },
});
