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

export type TransparentPlayerConfig = {
  enabled: boolean;
  opacity: number;
  type: MaterialType;
};
