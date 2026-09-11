import type { PearTheme } from './types';

const themeModules: Record<string, unknown> = import.meta.glob('./*/index.ts', {
  eager: true,
});

export const themes: PearTheme[] = [];

for (const module of Object.values(themeModules)) {
  const theme = (module as { default?: PearTheme }).default;
  if (
    theme &&
    typeof theme.id === 'string' &&
    typeof theme.name === 'string' &&
    typeof theme.css === 'string' &&
    Boolean(theme.palette)
  ) {
    themes.push(theme);
  }
}

export const getTheme = (id?: string): PearTheme | undefined =>
  themes.find((theme) => theme.id === id);
