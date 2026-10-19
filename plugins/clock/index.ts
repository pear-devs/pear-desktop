import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "clock",
  name: "Clock",
  description: "Shows the current time in the top bar.",
  config: {
    displaySeconds: config.bool(false, { label: "Show seconds" }),
    hour12: config.bool(false, { label: "12-hour format" }),
  },
  // The original centered the clock, but the search box lives there now.
  style: css`
    .pear-clock {
      align-self: center;
      margin: 0 12px 0 4px;
      color: var(--ytmusic-text-secondary, #aaa);
      font: 500 15px/1 "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Sans", Roboto, sans-serif;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      user-select: none;
    }
  `,
  page: async (ctx) => {
    const clock = document.createElement("time");
    clock.className = "pear-clock";
    ctx.onCleanup(() => clock.remove());

    // Config changes restart the page part, which rebuilds the format.
    const format = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(ctx.config.displaySeconds ? { second: "2-digit" } : {}),
      hour12: ctx.config.hour12,
    });
    const tick = () => {
      const now = new Date();
      clock.textContent = format.format(now);
      clock.dateTime = now.toISOString();
    };
    tick();
    // Tick on second boundaries so the display never lags behind the system clock.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        tick();
        schedule();
      }, 1000 - (Date.now() % 1000));
    };
    schedule();
    ctx.onCleanup(() => clearTimeout(timer));

    const mount = (right: Element) => right.prepend(clock);
    mount(await ctx.waitFor("nav_bar.right"));
    // YTM re-renders the nav bar on some navigations.
    const observer = new MutationObserver(() => {
      const right = ctx.$("nav_bar.right");
      if (!clock.isConnected && right) mount(right);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onCleanup(() => observer.disconnect());
  },
});
