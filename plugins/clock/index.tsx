/** @jsxImportSource @pear/sdk */
import { config, definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const SECOND = 1000;

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
  page: (ctx) => {
    const clock = (<time class="pear-clock" />) as HTMLTimeElement;

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
    const schedule = () => {
      ctx.setTimeout(() => {
        tick();
        schedule();
      }, SECOND - (Date.now() % SECOND));
    };
    schedule();

    // YTM re-renders the nav bar on some navigations.
    ctx.mount(clock, "nav_bar.right", "prepend");
  },
});
