export enum MaterialType {
  MICA = 'mica',
  ACRYLIC = 'acrylic',
  TABBED = 'tabbed',
  NONE = 'none',
}

export type TransparentPlayerConfig = {
  enabled: boolean;
  opacity: number;
  type: MaterialType;
};
