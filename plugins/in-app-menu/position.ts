// Where menu panels open, kept on screen.

/** Between the trigger and the top-level menu. */
const TRIGGER_GAP = 6;
/** Between a submenu and the item that opened it. */
const SUBMENU_GAP = 4;
/** A panel's padding plus border: a submenu moves up by it so its first item lines up with its owner. */
const PANEL_INSET = 7;
/** The closest a panel comes to the window's edges. */
const SCREEN_MARGIN = 8;

export interface Point {
  left: number;
  top: number;
}

export function belowTrigger(trigger: Element): Point {
  const rect = trigger.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + TRIGGER_GAP };
}

export function besideItem(item: Element): Point {
  const rect = item.getBoundingClientRect();
  return { left: rect.right + SUBMENU_GAP, top: rect.top - PANEL_INSET };
}

/** Moves the (already rendered) `panel` to `at`, keeping it on screen; a submenu flips left of its `owner` when it doesn't fit. */
export function placePanel(panel: HTMLElement, at: Point, owner?: Element) {
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const overflowsRight = at.left + width > innerWidth - SCREEN_MARGIN;
  const left = owner && overflowsRight ? owner.getBoundingClientRect().left - width - SUBMENU_GAP : at.left;
  panel.style.left = `${keepWithin(left, innerWidth - width)}px`;
  panel.style.top = `${keepWithin(at.top, innerHeight - height)}px`;
}

/** `value`, at least SCREEN_MARGIN and at most `end` minus SCREEN_MARGIN (the start wins if both can't hold). */
function keepWithin(value: number, end: number) {
  return Math.max(SCREEN_MARGIN, Math.min(value, end - SCREEN_MARGIN));
}
