// Converts a keydown into an Electron accelerator string ("Ctrl+Shift+P").

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
  Enter: "Return",
  "+": "Plus",
  MediaPlayPause: "MediaPlayPause",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  MediaStop: "MediaStop",
  AudioVolumeUp: "VolumeUp",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS"]);

/** Returns undefined while only modifiers are held. */
export function toAccelerator(event: KeyboardEvent): string | undefined {
  if (MODIFIER_KEYS.has(event.key)) return;
  const key = NAMED_KEYS[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}
