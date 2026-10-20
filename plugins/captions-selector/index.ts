import { config, definePlugin, type YTPlayerApi } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

interface CaptionTrack {
  languageCode: string;
  languageName?: string;
  displayName?: string;
  kind?: string;
}

interface CaptionsApi extends YTPlayerApi {
  loadModule(name: "captions"): void;
  unloadModule(name: "captions"): void;
  getOption(module: "captions", option: "tracklist"): CaptionTrack[] | undefined;
  getOption(module: "captions", option: "track"): Partial<CaptionTrack> | undefined;
  setOption(module: "captions", option: "track", value: Partial<CaptionTrack>): void;
}

const ICON =
  "M20 4H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zm-9 6H8v4h3v2H8c-1.103 0-2-.897-2-2v-4c0-1.103.897-2 2-2h3v2zm7 0h-3v4h3v2h-3c-1.103 0-2-.897-2-2v-4c0-1.103.897-2 2-2h3v2z";

// The captions module needs a moment after a track loads to know its tracks.
const TRACKLIST_DELAY_MS = 250;

export default definePlugin({
  id: "captions-selector",
  name: "Captions selector",
  description: "Pick the captions language from the player bar, and optionally load it automatically.",
  config: {
    autoload: config.bool(false, { label: "Load captions automatically", description: "Turns on the preferred language for every track that has it." }),
    disableCaptions: config.bool(false, { label: "Never show captions" }),
    lastCaptionsCode: config.string("", { label: "Preferred language", description: "Language code, remembered when you pick captions.", placeholder: "en" }),
  },
  style: css`
    .pear-captions-button {
      anchor-name: --pear-captions;
      width: 40px;
      height: 40px;
      padding: 8px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--ytmusic-text-secondary, #aaa);
      cursor: pointer;
    }
    .pear-captions-button[hidden] {
      display: none;
    }
    .pear-captions-button:hover,
    .pear-captions-button[aria-expanded="true"] {
      background: rgb(255 255 255 / 0.1);
      color: #fff;
    }
    .pear-captions-button svg {
      display: block;
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    .pear-captions-popover {
      position-anchor: --pear-captions;
      position-area: top span-left;
      position-try-fallbacks: flip-block;
      inset: auto;
      margin: 8px 0;
      min-width: 180px;
      max-height: 50vh;
      overflow-y: auto;
      padding: 8px 0;
      border: 0;
      border-radius: 8px;
      background: #212121;
      color: #fff;
      font: 400 14px Roboto, sans-serif;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
    }
    .pear-captions-popover h2 {
      margin: 0;
      padding: 4px 16px 8px;
      color: #aaa;
      font: inherit;
      font-size: 12px;
    }
    .pear-captions-popover button {
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
    .pear-captions-popover button:hover {
      background: rgb(255 255 255 / 0.1);
    }
    .pear-captions-popover button[aria-checked="true"]::before {
      content: "✓";
      position: absolute;
      margin-left: -22px;
    }
  `,
  page: async (ctx) => {
    const api = (await ctx.player.ready()) as CaptionsApi;
    let tracks: CaptionTrack[] = [];

    const button = document.createElement("button");
    button.className = "pear-captions-button";
    const buttonLabel = ctx.t("plugins.captions-selector.templates.title", "Open captions selector");
    button.title = buttonLabel;
    button.setAttribute("aria-label", buttonLabel);
    button.hidden = true;
    button.append(icon(ICON));
    const popover = document.createElement("div");
    popover.className = "pear-captions-popover";
    popover.popover = "auto";
    popover.setAttribute("role", "menu");
    button.popoverTargetElement = popover;

    // As pear-desktop: the choice is remembered (None forgets it) and confirmed in a toast.
    const select = (track: CaptionTrack | undefined) => {
      if (track) {
        ctx.setConfig({ lastCaptionsCode: track.languageCode });
        api.setOption("captions", "track", { languageCode: track.languageCode });
        ctx.toast(
          ctx.t("plugins.captions-selector.toast.caption-changed", "Caption changed to {{language}}", {
            language: track.displayName ?? track.languageName ?? track.languageCode,
          }),
        );
      } else {
        ctx.setConfig({ lastCaptionsCode: "" });
        api.setOption("captions", "track", {});
        ctx.toast(ctx.t("plugins.captions-selector.toast.caption-disabled", "Captions disabled"));
      }
      popover.hidePopover();
    };
    const render = () => {
      const current = api.getOption("captions", "track")?.languageCode;
      const heading = document.createElement("h2");
      heading.textContent = ctx.t("plugins.captions-selector.heading", "Captions");
      const item = (label: string, checked: boolean, track: CaptionTrack | undefined) => {
        const element = document.createElement("button");
        element.setAttribute("role", "menuitemradio");
        element.setAttribute("aria-checked", String(checked));
        element.textContent = label;
        element.addEventListener("click", () => select(track));
        return element;
      };
      popover.replaceChildren(
        heading,
        item(ctx.t("plugins.captions-selector.prompt.selector.none", "None"), !current, undefined),
        ...tracks.map((track) =>
          item(track.displayName ?? track.languageName ?? track.languageCode, track.languageCode === current, track),
        ),
      );
    };
    popover.addEventListener("beforetoggle", (event) => {
      const open = (event as ToggleEvent).newState === "open";
      if (open) render();
      button.setAttribute("aria-expanded", String(open));
    });
    // The button only shows when there are captions; say so if they vanished meanwhile.
    button.addEventListener("click", () => {
      if (tracks.length === 0) ctx.toast(ctx.t("plugins.captions-selector.toast.no-captions", "No captions available for this song"));
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTrack = () => {
      clearTimeout(timer);
      if (ctx.config.disableCaptions) {
        timer = setTimeout(() => api.unloadModule("captions"), 100);
        button.hidden = true;
        return;
      }
      api.loadModule("captions");
      timer = setTimeout(() => {
        tracks = api.getOption("captions", "tracklist") ?? [];
        const preferred = ctx.config.lastCaptionsCode;
        if (ctx.config.autoload && preferred && tracks.some((t) => t.languageCode === preferred)) {
          api.setOption("captions", "track", { languageCode: preferred });
        }
        button.hidden = tracks.length === 0;
      }, TRACKLIST_DELAY_MS);
    };
    ctx.player.on("trackChange", onTrack);

    ctx.onCleanup(() => {
      clearTimeout(timer);
      api.unloadModule("captions");
      button.remove();
      popover.remove();
    });
    document.body.append(popover);
    const container = await ctx.waitFor("player_bar.right_controls_buttons");
    // Next to YTM's own captions toggle when it has one.
    const native = ctx.$("player_bar.captions", container);
    if (native) native.after(button);
    else container.prepend(button);
    if (ctx.player.state.track) onTrack();
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
