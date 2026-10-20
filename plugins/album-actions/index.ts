import { definePlugin, type SelectorName } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const THUMB_UP =
  "M3 11h3v10H3V11zm15.77 0h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11v10h10.43c1.06 0 1.98-.67 2.19-1.61l1.34-6C21.23 12.15 20.18 11 18.77 11z";
const THUMB_DOWN =
  "M18 4h3v10h-3V4zM5.23 14h4.23l-1.52 4.94C7.62 19.97 8.46 21 9.62 21c.58 0 1.14-.24 1.52-.65L17 14V4H6.57c-1.06 0-1.98.67-2.19 1.61l-1.34 6C2.77 12.85 3.82 14 5.23 14z";
const STRIKE = "M3.3 2 2 3.3 20.7 22l1.3-1.3z";

// Loading a long playlist's remaining rows: wait this long per batch, give up after this many.
const CONTINUATION_WAIT_MS = 1500;
const MAX_CONTINUATIONS = 100;

type Translate = (key: string, fallback?: string, vars?: Readonly<Record<string, unknown>>) => string;

interface Action {
  id: string;
  label: (t: Translate) => string;
  icon: string[];
  /** The rows' buttons this action clicks, and whether they must be pressed already. */
  button: SelectorName;
  pressed: boolean;
}

const ACTIONS: readonly Action[] = [
  { id: "like", label: (t) => t("plugins.album-actions.like", "Like all"), icon: [THUMB_UP], button: "browse.track_like", pressed: false },
  { id: "unlike", label: (t) => t("plugins.album-actions.unlike", "Remove all likes"), icon: [THUMB_UP, STRIKE], button: "browse.track_like", pressed: true },
  { id: "dislike", label: (t) => t("plugins.album-actions.dislike", "Dislike all"), icon: [THUMB_DOWN], button: "browse.track_dislike", pressed: false },
  { id: "undislike", label: (t) => t("plugins.album-actions.undislike", "Remove all dislikes"), icon: [THUMB_DOWN, STRIKE], button: "browse.track_dislike", pressed: true },
];

export default definePlugin({
  id: "album-actions",
  name: "Album actions",
  description: "Like or dislike every track of an album or playlist at once.",
  style: css`
    .pear-album-actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 12px;
    }
    .pear-album-actions button {
      position: relative;
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgb(255 255 255 / 0.1);
      color: #fff;
      cursor: pointer;
      transition: background-color 120ms;
    }
    .pear-album-actions button:hover {
      background: rgb(255 255 255 / 0.2);
    }
    .pear-album-actions button[hidden] {
      display: none;
    }
    .pear-album-actions button:disabled {
      cursor: progress;
      opacity: 0.5;
    }
    .pear-album-actions svg {
      grid-area: 1 / 1;
      width: 22px;
      height: 22px;
      fill: rgb(255 255 255 / 0.45);
    }
    .pear-album-actions svg + svg {
      fill: #fff;
      clip-path: inset(calc(100% - var(--pear-done, 0%)) 0 0 0);
    }
  `,
  page: (ctx) => {
    const bar = document.createElement("div");
    bar.className = "pear-album-actions";
    ctx.onCleanup(() => bar.remove());
    const buttons = new Map<Action, HTMLButtonElement>();
    for (const action of ACTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action.id;
      button.append(icon(action.icon), icon(action.icon));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void run(action);
      });
      buttons.set(action, button);
      bar.append(button);
    }

    const rows = (action: Action) => {
      const list = ctx.$("browse.tracklist");
      return list ? ctx.$$<HTMLButtonElement>(action.button, list) : [];
    };
    const matching = (action: Action) =>
      rows(action).filter((button) => (button.getAttribute("aria-pressed") === "true") === action.pressed);

    let busy = false;
    const update = () => {
      const header = ctx.$("browse.action_buttons");
      if (!header || !ctx.$("browse.tracklist")) {
        bar.remove();
        return;
      }
      if (bar.previousElementSibling !== header) header.after(bar);
      for (const [action, button] of buttons) {
        const total = rows(action).length;
        const pending = matching(action).length;
        button.hidden = pending === 0;
        button.disabled = busy;
        // The icon fills up with the share of tracks that are liked (or disliked).
        const pressed = action.pressed ? pending : total - pending;
        button.style.setProperty("--pear-done", `${total === 0 ? 0 : Math.round((pressed / total) * 100)}%`);
        const label = ctx.t("plugins.album-actions.progress", "{{action}} ({{pending}} of {{total}})", {
          action: action.label(ctx.t),
          pending,
          total,
        });
        button.title = label;
        button.setAttribute("aria-label", label);
      }
    };

    const run = async (action: Action) => {
      busy = true;
      update();
      try {
        await loadAllRows();
        for (const button of matching(action)) button.click();
      } finally {
        busy = false;
        update();
      }
    };

    // Long playlists load in batches as you scroll; pull them all in before acting.
    const loadAllRows = async () => {
      for (let i = 0; i < MAX_CONTINUATIONS; i++) {
        const loader = ctx.$("browse.continuations")?.firstElementChild;
        if (!loader || ctx.signal.aborted) return;
        loader.scrollIntoView({ block: "end" });
        const before = rows(ACTIONS[0]!).length;
        await new Promise((resolve) => setTimeout(resolve, CONTINUATION_WAIT_MS));
        if (rows(ACTIONS[0]!).length === before && ctx.$("browse.continuations")?.firstElementChild === loader) return;
      }
    };

    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        update();
      });
    };
    ctx.onCleanup(() => cancelAnimationFrame(scheduled));
    void ctx.waitFor("browse.page").then((page) => {
      const observer = new MutationObserver(schedule);
      observer.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
      ctx.onCleanup(() => observer.disconnect());
      update();
    }, () => {});
  },
});

function icon(paths: string[]) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
