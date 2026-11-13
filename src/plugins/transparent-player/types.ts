import { config } from '@/plugins/utils/common/config';

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

const opacityList = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export const typeLabel = (type: MaterialType) =>
  `plugins.transparent-player.menu.type.submenu.${type}`;

export const transparentPlayerConfig = {
  opacity: config.number(0.5, {
    label: 'plugins.transparent-player.menu.opacity.label',
    options: opacityList.map((opacity) => ({
      value: opacity,
      label: {
        key: 'plugins.transparent-player.menu.opacity.submenu.percent',
        vars: { opacity: opacity * 100 },
      },
    })),
  }),
  // No `label`: the choices depend on the platform, so the radio items are
  // built in `menu` instead of being generated.
  type: config.select(
    MaterialType.NONE as MaterialType,
    Object.values(MaterialType).map((type) => ({
      value: type,
      label: typeLabel(type),
    })),
  ),
};
