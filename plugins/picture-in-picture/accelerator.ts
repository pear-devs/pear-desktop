// Matches keydown events against Electron accelerators ("CmdOrCtrl+Shift+P").

const ALIASES: Record<string, string> = {
  cmdorctrl: "ctrl",
  commandorcontrol: "ctrl",
  control: "ctrl",
  command: "meta",
  cmd: "meta",
  super: "meta",
  option: "alt",
  altgr: "alt",
  esc: "escape",
  return: "enter",
  space: " ",
  plus: "+",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

const MODIFIERS = ["ctrl", "alt", "shift", "meta"] as const;

function normalize(accelerator: string) {
  const parts = accelerator
    .split(/\+(?!$)/)
    .map((part) => part.trim().toLowerCase())
    .map((part) => ALIASES[part] ?? part);
  const key = parts.pop() ?? "";
  return { key, modifiers: new Set(parts) };
}

export function matchesAccelerator(event: KeyboardEvent, accelerator: string, isMac = false) {
  if (!accelerator) return false;
  const { key, modifiers } = normalize(accelerator);
  // CmdOrCtrl means Cmd on macOS.
  if (isMac && /cmdorctrl|commandorcontrol/i.test(accelerator)) {
    modifiers.delete("ctrl");
    modifiers.add("meta");
  }
  const pressed = { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  if (MODIFIERS.some((modifier) => pressed[modifier] !== modifiers.has(modifier))) return false;
  const eventKey = event.key.toLowerCase();
  const codeKey = event.code.replace(/^(Key|Digit)/, "").toLowerCase();
  return eventKey === key || codeKey === key;
}
