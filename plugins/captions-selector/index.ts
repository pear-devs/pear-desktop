import { config, definePlugin, type YTPlayerApi } from "@pear/sdk";
import { picker } from "@pear/sdk/dom";
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
const UNLOAD_DELAY_MS = 100;

export default definePlugin({
  id: "captions-selector",
  name: "Captions selector",
  description: "Pick the captions language from the player bar, and optionally load it automatically.",
  config: {
    autoload: config.bool(false, { label: "Load captions automatically", description: "Turns on the preferred language for every track that has it." }),
    disableCaptions: config.bool(false, { label: "Never show captions" }),
    lastCaptionsCode: config.string("", { label: "Preferred language", description: "Language code, remembered when you pick captions.", placeholder: "en" }),
  },
  // Only what differs from the shared picker; both classes, since the picker's sheet comes after this one.
  style: css`
    .pear-picker-popover.pear-captions-popover {
      position-try-fallbacks: flip-block;
    }
  `,
  page: async (ctx) => {
    const api = (await ctx.player.ready()) as CaptionsApi;
    let tracks: CaptionTrack[] = [];

    const languageName = (track: CaptionTrack) => track.displayName ?? track.languageName ?? track.languageCode;

    // As pear-desktop: the choice is remembered (None forgets it) and confirmed in a toast.
    const select = (track: CaptionTrack) => {
      ctx.setConfig({ lastCaptionsCode: track.languageCode });
      api.setOption("captions", "track", { languageCode: track.languageCode });
      ctx.toast(
        ctx.t("plugins.captions-selector.toast.caption-changed", "Caption changed to {{language}}", {
          language: languageName(track),
        }),
      );
    };
    const selectNone = () => {
      ctx.setConfig({ lastCaptionsCode: "" });
      api.setOption("captions", "track", {});
      ctx.toast(ctx.t("plugins.captions-selector.toast.caption-disabled", "Captions disabled"));
    };

    const choices = () => {
      const current = api.getOption("captions", "track")?.languageCode;
      const none = { label: ctx.t("plugins.captions-selector.prompt.selector.none", "None"), checked: !current, select: selectNone };
      const languages = tracks.map((track) => ({
        label: languageName(track),
        checked: track.languageCode === current,
        select: () => select(track),
      }));
      return [none, ...languages];
    };

    const { button } = picker(ctx, {
      name: "captions",
      label: ctx.t("plugins.captions-selector.templates.title", "Open captions selector"),
      icon: ICON,
      heading: ctx.t("plugins.captions-selector.heading", "Captions"),
      items: choices,
    });
    button.hidden = true;
    // The button only shows when there are captions; say so if they vanished meanwhile.
    ctx.listen(button, "click", () => {
      if (tracks.length === 0) ctx.toast(ctx.t("plugins.captions-selector.toast.no-captions", "No captions available for this song"));
    });

    const loadTracks = () => {
      tracks = api.getOption("captions", "tracklist") ?? [];
      const preferred = ctx.config.lastCaptionsCode;
      const hasPreferred = !!preferred && tracks.some((track) => track.languageCode === preferred);
      if (ctx.config.autoload && hasPreferred) api.setOption("captions", "track", { languageCode: preferred });
      button.hidden = tracks.length === 0;
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTrack = () => {
      ctx.clearTimeout(timer);
      if (ctx.config.disableCaptions) {
        timer = ctx.setTimeout(() => api.unloadModule("captions"), UNLOAD_DELAY_MS);
        button.hidden = true;
        return;
      }
      api.loadModule("captions");
      timer = ctx.setTimeout(loadTracks, TRACKLIST_DELAY_MS);
    };
    ctx.player.on("trackChange", onTrack);
    ctx.onCleanup(() => api.unloadModule("captions"));
    // The tracks can come later than the delay (at startup, for one); the player says when its modules change.
    const onApiChange = () => {
      if (!ctx.config.disableCaptions && tracks.length === 0) loadTracks();
    };
    api.addEventListener("onApiChange", onApiChange);
    ctx.onCleanup(() => api.removeEventListener("onApiChange", onApiChange));

    ctx.mount(button, (element) => {
      const container = ctx.$("player_bar.right_controls_buttons");
      if (!container) return;
      // Next to YTM's own captions toggle when it has one.
      const native = ctx.$("player_bar.captions", container);
      if (native) native.after(element);
      else container.prepend(element);
    });
    if (ctx.player.state.track) onTrack();
  },
});
