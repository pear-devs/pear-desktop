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
    !!theme.palette &&
    typeof theme.palette.accentColor === 'string' &&
    typeof theme.palette.backgroundColor === 'string' &&
    typeof theme.palette.surfaceColor === 'string' &&
    typeof theme.palette.textColor === 'string'
  ) {
    themes.push(theme);
  }
}

export const getTheme = (id?: string): PearTheme | undefined =>
  themes.find((theme) => theme.id === id);
