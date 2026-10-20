// Matches keydown events (or Electron's before-input-event inputs, see
// `fromInput`) against Electron accelerators ("CmdOrCtrl+Shift+P").

/** The parts of a keydown the match needs. */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** Electron's `before-input-event` input as a KeyLike. */
export const fromInput = (input: { key: string; code: string; control: boolean; alt: boolean; shift: boolean; meta: boolean }): KeyLike => ({
  key: input.key,
  code: input.code,
  ctrlKey: input.control,
  altKey: input.alt,
  shiftKey: input.shift,
  metaKey: input.meta,
});

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
  // Accelerator names of media keys, as keydown names them.
  medianexttrack: "mediatracknext",
  mediaprevioustrack: "mediatrackprevious",
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

export function matchesAccelerator(event: KeyLike, accelerator: string, isMac = false) {
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
