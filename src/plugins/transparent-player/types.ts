export enum MaterialType {
  NONE = 'none',

  // Windows materials
  MICA = 'mica',
  ACRYLIC = 'acrylic',
  TABBED = 'tabbed',

  // macOS materials
  WINDOW = 'window',
  FULLSCREEN_UI = 'fullscreen-ui',
  CONTENT = 'content',
  UNDER_WINDOW = 'under-window',
  UNDER_PAGE = 'under-page',
}

export const WINDOWS_MATERIALS = [
  MaterialType.MICA,
  MaterialType.ACRYLIC,
  MaterialType.TABBED,
];

export const MACOS_MATERIALS = [
  MaterialType.WINDOW,
  MaterialType.FULLSCREEN_UI,
  MaterialType.CONTENT,
  MaterialType.UNDER_WINDOW,
  MaterialType.UNDER_PAGE,
];

export type TransparentPlayerConfig = {
  enabled: boolean;
  opacity: number;
  type: MaterialType;
};
