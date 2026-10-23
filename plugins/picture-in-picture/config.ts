import { config } from "@pear/sdk";

export const pipConfig = {
  hotkey: config.shortcut("P", { label: "Hotkey", description: "Works while the window is focused." }),
  useNativePiP: config.bool(true, {
    label: "Use the browser's picture-in-picture",
    description: "Pops out just the video. Turn off to shrink the whole window, controls included.",
  }),
  alwaysOnTop: config.bool(true, { label: "Keep the small window on top" }),
  savePosition: config.bool(true, { label: "Remember the small window's position" }),
  saveSize: config.bool(false, { label: "Remember the small window's size" }),
};

/** The host commands the page part calls. */
export interface PipCommands {
  toggle(): boolean;
  exit(): void;
  active(): boolean;
}
