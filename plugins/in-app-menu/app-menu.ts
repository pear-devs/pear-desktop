// Host side: the application menu, serialized for the page to draw.

import type { Menu, MenuItem } from "electron";
import type { MenuNode } from "./types.ts";

const ITEM_KINDS: Partial<Record<MenuItem["type"], MenuNode["kind"]>> = { checkbox: "checkbox", radio: "radio" };

const SEPARATOR: Omit<MenuNode, "index"> = {
  kind: "separator",
  label: "",
  sublabel: "",
  toolTip: "",
  accelerator: "",
  enabled: true,
  checked: false,
};

export function serialize(menu: Menu, isMac: boolean): MenuNode[] {
  return menu.items.flatMap((item, index): MenuNode[] => {
    if (!item.visible) return [];
    if (item.type === "separator") return [{ index, ...SEPARATOR }];
    return [serializeItem(item, index, isMac)];
  });
}

function serializeItem(item: MenuItem, index: number, isMac: boolean): MenuNode {
  const node: MenuNode = {
    index,
    kind: ITEM_KINDS[item.type] ?? "normal",
    label: item.label.replace(/&(?=\S)/g, ""),
    sublabel: item.sublabel ?? "",
    toolTip: item.toolTip ?? "",
    accelerator: item.accelerator ? displayAccelerator(String(item.accelerator), isMac) : "",
    enabled: item.enabled,
    checked: item.checked,
  };
  if (item.submenu) {
    node.kind = "submenu";
    node.children = serialize(item.submenu, isMac);
  }
  return node;
}

const MAC_KEYS: Partial<Record<string, string>> = {
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  ctrl: "⌃",
  control: "⌃",
  cmd: "⌘",
  command: "⌘",
};

/** "CmdOrCtrl+Shift+I" as shown in menus. */
function displayAccelerator(accelerator: string, isMac: boolean) {
  const parts = accelerator.split(/\+(?!$)/).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "cmdorctrl" || lower === "commandorcontrol") return isMac ? "⌘" : "Ctrl";
    if (lower === "plus") return "+";
    if (isMac) return MAC_KEYS[lower] ?? part;
    return part;
  });
  return parts.join(isMac ? "" : "+");
}

/** The item at `path` (indices from the top-level menu down), if it can be clicked. */
export function clickableItem(menu: Menu | null, path: number[]) {
  let items = menu?.items;
  let item: MenuItem | undefined;
  for (const index of path) {
    item = items?.[index];
    items = item?.submenu?.items;
  }
  if (!item || !item.enabled || item.submenu) return;
  return item;
}
