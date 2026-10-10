import type { RendererContext } from '@/types/contexts';

export type CustomThemeConfig = {
  enabled: boolean;
  theme: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
};

export type ThemePalette = Pick<
  CustomThemeConfig,
  'accentColor' | 'backgroundColor' | 'surfaceColor' | 'textColor'
>;

export type ThemeMountContext = RendererContext<CustomThemeConfig> & {
  applyPalette: (palette: ThemePalette) => void;
};

export type PearTheme = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  palette: ThemePalette;
  css: string;
  mount?: (context: ThemeMountContext) => (() => void) | void;
  unmount?: () => void;
};

export const defaultColors: ThemePalette = {
  accentColor: '#ff0000',
  backgroundColor: '#030303',
  surfaceColor: '#1f1f1f',
  textColor: '#ffffff',
};

export const defaultConfig: CustomThemeConfig = {
  enabled: false,
  theme: 'custom',
  ...defaultColors,
};
