// Keyboard navigation inside the menu panels.

/** Keys that open a submenu from its item. */
const OPEN_SUBMENU_KEYS = new Set(["ArrowRight", "Enter", " "]);

export const opensSubmenu = (event: KeyboardEvent) => OPEN_SUBMENU_KEYS.has(event.key);

/** F10 alone toggles the menu, as in most desktop apps. */
export function isMenuKey(event: KeyboardEvent) {
  const hasModifier = event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
  return event.key === "F10" && !hasModifier;
}

export interface PanelKeys {
  items: HTMLButtonElement[];
  /** The focused element (in the menu's shadow root). */
  active: Element | null;
  /** Back to the parent menu; submenus only. */
  back?: (() => void) | undefined;
  /** Closes the whole menu. */
  close(): void;
}

/** Moves focus within a panel or leaves it; returns whether the key was one of its keys. */
export function handlePanelKey(key: string, panel: PanelKeys) {
  const enabled = panel.items.filter((item) => !item.disabled);
  const step = (delta: number) => {
    const from = enabled.indexOf(panel.active as HTMLButtonElement);
    enabled[(from + delta + enabled.length) % enabled.length]?.focus();
  };
  switch (key) {
    case "ArrowDown":
      step(1);
      return true;
    case "ArrowUp":
      step(-1);
      return true;
    case "Home":
      enabled[0]?.focus();
      return true;
    case "End":
      enabled.at(-1)?.focus();
      return true;
    case "ArrowLeft":
      if (!panel.back) return false;
      panel.back();
      return true;
    case "Escape":
    case "Tab":
      panel.close();
      return true;
  }
  return false;
}
