/** @jsxImportSource @pear/sdk */
// The downloader's own toast: YTM's can't hold a "Show" button.

import type { Ctx, MenuOption } from "./types.ts";

const TOAST_DURATION_MS = 6000;

export type ShowToast = (message: string, action?: MenuOption) => void;

export function createToast(ctx: Ctx): ShowToast {
  const toast = <div class="pear-dl-toast" role="status" hidden />;
  document.body.append(toast);
  ctx.onCleanup(() => toast.remove());
  const hide = () => {
    toast.hidden = true;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message, action) => {
    toast.replaceChildren(<span title={message}>{message}</span>);
    if (action) {
      const run = () => {
        action.run();
        hide();
      };
      toast.append(<button onClick={run}>{action.label}</button>);
    }
    toast.hidden = false;
    ctx.clearTimeout(timer);
    timer = ctx.setTimeout(hide, TOAST_DURATION_MS);
  };
}
