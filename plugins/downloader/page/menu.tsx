/** @jsxImportSource @pear/sdk */
// The button's menu of choices (song, album or playlist, cancel), opening above it.

import type { Ctx, MenuOption } from "./types.ts";

export function buttonMenu(ctx: Ctx, button: HTMLElement) {
  const menu = <div class="pear-dl-menu" role="menu" hidden />;
  const root = (
    <div class="pear-dl">
      {button}
      {menu}
    </div>
  );

  const isOpen = () => !menu.hidden;
  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const entry = (option: MenuOption) => {
    const choose = (event: MouseEvent) => {
      event.stopPropagation();
      close();
      option.run();
    };
    return (
      <button role="menuitem" onClick={choose}>
        {option.label}
      </button>
    );
  };
  const open = (options: MenuOption[]) => {
    // A heading where a section starts.
    const children = options.flatMap((option, index) => {
      const starts = option.section && option.section !== options[index - 1]?.section;
      return starts ? [<div class="pear-dl-menu-heading">{option.section}</div>, entry(option)] : [entry(option)];
    });
    menu.replaceChildren(...children);
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
  };

  // Clicks elsewhere and Escape close it, as with YTM's menus.
  ctx.listen(document, "click", (event: MouseEvent) => {
    if (isOpen() && !root.contains(event.target as Node)) close();
  });
  ctx.listen(document, "keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !isOpen()) return;
    close();
    button.focus();
  });
  ctx.onCleanup(() => root.remove());
  return { root, isOpen, open, close };
}
