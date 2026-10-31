/** @jsxImportSource @pear/sdk */
import { definePlugin, type SelectorName } from "@pear/sdk";
import { Icon } from "@pear/sdk/dom";
import type { Translate } from "@pear/sdk/i18n";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { sleep } from "@pear/sdk/util";

const THUMB_UP =
  "M3 11h3v10H3V11zm15.77 0h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11v10h10.43c1.06 0 1.98-.67 2.19-1.61l1.34-6C21.23 12.15 20.18 11 18.77 11z";
const THUMB_DOWN =
  "M18 4h3v10h-3V4zM5.23 14h4.23l-1.52 4.94C7.62 19.97 8.46 21 9.62 21c.58 0 1.14-.24 1.52-.65L17 14V4H6.57c-1.06 0-1.98.67-2.19 1.61l-1.34 6C2.77 12.85 3.82 14 5.23 14z";
const STRIKE = "M3.3 2 2 3.3 20.7 22l1.3-1.3z";

// Loading a long playlist's remaining rows: wait this long per batch, give up after this many.
const CONTINUATION_WAIT_MS = 1500;
const MAX_CONTINUATIONS = 100;

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
    let running = false;
    const buttons = new Map<Action, HTMLButtonElement>();
    for (const action of ACTIONS) {
      const button = (
        <button
          type="button"
          data-action={action.id}
          onClick={(event) => {
            event.stopPropagation();
            void run(action);
          }}
        >
          {/* The second copy is the fill, clipped to the share already done. */}
          <Icon path={action.icon} />
          <Icon path={action.icon} />
        </button>
      );
      buttons.set(action, button as HTMLButtonElement);
    }
    const bar = <div class="pear-album-actions">{[...buttons.values()]}</div>;
    ctx.onCleanup(() => bar.remove());

    const rows = (action: Action) => {
      const list = ctx.$("browse.tracklist");
      return list ? ctx.$$<HTMLButtonElement>(action.button, list) : [];
    };
    const matching = (action: Action) =>
      rows(action).filter((button) => (button.getAttribute("aria-pressed") === "true") === action.pressed);
    const loader = () => ctx.$("browse.continuations")?.firstElementChild;

    const label = (action: Action, complete: boolean, pending: number, total: number) => {
      if (!complete) return action.label(ctx.t);
      return ctx.t("plugins.album-actions.progress", "{{action}} ({{pending}} of {{total}})", {
        action: action.label(ctx.t),
        pending,
        total,
      });
    };

    const update = () => {
      const header = ctx.$("browse.action_buttons");
      if (!header || !ctx.$("browse.tracklist")) {
        bar.remove();
        return;
      }
      if (bar.previousElementSibling !== header) header.after(bar);
      // Until a long list has loaded completely the counts are partial: like
      // pear-desktop, offer every action, half filled.
      const complete = !loader();
      for (const [action, button] of buttons) {
        const total = rows(action).length;
        const pending = matching(action).length;
        button.hidden = complete && pending === 0;
        button.disabled = running;
        // The icon fills up with the share of tracks that are liked (or disliked).
        const pressed = action.pressed ? pending : total - pending;
        button.style.setProperty("--pear-done", `${donePercent(complete, pressed, total)}%`);
        const text = label(action, complete, pending, total);
        button.title = text;
        button.setAttribute("aria-label", text);
      }
    };

    const run = async (action: Action) => {
      running = true;
      update();
      try {
        await loadAllRows();
        for (const button of matching(action)) button.click();
      } finally {
        running = false;
        update();
      }
    };

    // Long playlists load in batches as you scroll; pull them all in before acting.
    const loadAllRows = async () => {
      for (let i = 0; i < MAX_CONTINUATIONS; i++) {
        const current = loader();
        if (!current || ctx.signal.aborted) return;
        current.scrollIntoView({ block: "end" });
        const before = rows(ACTIONS[0]!).length;
        await sleep(CONTINUATION_WAIT_MS);
        const stalled = rows(ACTIONS[0]!).length === before && loader() === current;
        if (stalled) return;
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
    ctx.observe("browse.page", { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] }, schedule);
    void ctx.waitFor("browse.page").then(update, () => {});
  },
});

/** How full an action's icon is: half while the list is still loading. */
function donePercent(complete: boolean, pressed: number, total: number) {
  if (!complete) return 50;
  if (total === 0) return 0;
  return Math.round((pressed / total) * 100);
}
