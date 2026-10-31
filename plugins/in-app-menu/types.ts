export type WindowAction = "minimize" | "toggleMaximize" | "close";

export interface WindowState {
  platform: string;
  /** The window was created without the system title bar (needs a restart after enabling). */
  frameless: boolean;
  maximized: boolean;
  fullscreen: boolean;
  alwaysOnTop: boolean;
}

/** An item of the application menu, as the page draws it. */
export interface MenuNode {
  /** Index among its menu's items (invisible ones included), for clicking it. */
  index: number;
  kind: "normal" | "checkbox" | "radio" | "submenu" | "separator";
  label: string;
  sublabel: string;
  toolTip: string;
  accelerator: string;
  enabled: boolean;
  checked: boolean;
  children?: MenuNode[];
}

/** The host commands the page part calls. */
export interface MenuCommands {
  state(): WindowState;
  menu(): MenuNode[];
  clickMenu(path: number[]): void;
  run(action: WindowAction): void;
}

export const ICONS = {
  menu: "M4 8h4V4H4zm6 12h4v-4h-4zm-6 0h4v-4H4zm0-6h4v-4H4zm6 0h4v-4h-4zm6-10v4h4V4zm-6 4h4V4h-4zm6 6h4v-4h-4zm0 6h4v-4h-4z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  submenu: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  minimize: "M4 11h16v2H4z",
  maximize: "M5 5h14v14H5zm2 2v10h10V7z",
  restore: "M8 4h12v12h-3v-2h1V6H10v1H8zM4 8h12v12H4zm2 2v8h8v-8z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};
