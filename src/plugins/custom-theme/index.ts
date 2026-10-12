import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import style from './style.css?inline';
import { getTheme, themes } from './themes';
import {
  defaultColors,
  defaultConfig,
  type CustomThemeConfig,
  type PearTheme,
  type ThemePalette,
} from './types';

import type { MenuTemplate } from '@/menu';
import type { MenuContext, RendererContext } from '@/types/contexts';

export type { CustomThemeConfig } from './types';

const CSS_VARIABLES = {
  accent: '--pear-theme-accent',
  background: '--pear-theme-bg',
  surface: '--pear-theme-surface',
  text: '--pear-theme-text',
} as const;

type RendererProperties = {
  themeCssElement: HTMLStyleElement | null;
  activeTheme: string | null;
  themeCleanup: (() => void) | null;
  context: RendererContext<CustomThemeConfig> | null;
  applyColors(colors: ThemePalette): void;
  applyConfig(config: CustomThemeConfig): void;
  applyTheme(theme: PearTheme | undefined, config: CustomThemeConfig): void;
  clearTheme(): void;
};

const isHexColor = (value: string): value is `#${string}` =>
  /^#[0-9a-f]{6}$/i.test(value);

const promptColor = async (
  window: Electron.BrowserWindow,
  title: string,
  label: string,
  current: string,
) => {
  const result = await prompt(
    {
      title,
      label,
      value: current,
      type: 'input',
      inputAttrs: {
        type: 'text',
        placeholder: '#rrggbb',
        required: true,
        maxLength: 7,
      },
      width: 380,
      ...promptOptions(),
    },
    window,
  );

  return typeof result === 'string' && isHexColor(result) ? result : null;
};

export default createPlugin<
  unknown,
  unknown,
  RendererProperties,
  CustomThemeConfig
>({
  name: () => t('plugins.custom-theme.name'),
  description: () => t('plugins.custom-theme.description'),
  restartNeeded: false,
  addedVersion: '3.13.X',
  config: defaultConfig,
  stylesheets: [style],
  menu: async ({
    getConfig,
    setConfig,
    window,
  }: MenuContext<CustomThemeConfig>): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.custom-theme.menu.theme.label'),
        submenu: [
          {
            label: t('plugins.custom-theme.menu.theme.submenu.custom.label'),
            type: 'radio',
            checked: config.theme === 'custom',
            click() {
              setConfig({ ...config, theme: 'custom' });
            },
          },
          ...themes.map<MenuTemplate[number]>((theme) => ({
            label: theme.name,
            type: 'radio',
            checked: config.theme === theme.id,
            click() {
              setConfig({ ...config, theme: theme.id });
            },
          })),
        ],
      },
      {
        label: t('plugins.custom-theme.menu.colors.label'),
        submenu: [
          {
            label: t('plugins.custom-theme.menu.colors.submenu.accent-color'),
            type: 'normal',
            async click() {
              const current = await getConfig();
              const value = await promptColor(
                window,
                t('plugins.custom-theme.prompt.accent-color.title'),
                t('plugins.custom-theme.prompt.accent-color.label'),
                current.accentColor,
              );
              if (value) {
                setConfig({ ...current, accentColor: value });
              }
            },
          },
          {
            label: t(
              'plugins.custom-theme.menu.colors.submenu.background-color',
            ),
            type: 'normal',
            async click() {
              const current = await getConfig();
              const value = await promptColor(
                window,
                t('plugins.custom-theme.prompt.background-color.title'),
                t('plugins.custom-theme.prompt.background-color.label'),
                current.backgroundColor,
              );
              if (value) {
                setConfig({ ...current, backgroundColor: value });
              }
            },
          },
          {
            label: t('plugins.custom-theme.menu.colors.submenu.surface-color'),
            type: 'normal',
            async click() {
              const current = await getConfig();
              const value = await promptColor(
                window,
                t('plugins.custom-theme.prompt.surface-color.title'),
                t('plugins.custom-theme.prompt.surface-color.label'),
                current.surfaceColor,
              );
              if (value) {
                setConfig({ ...current, surfaceColor: value });
              }
            },
          },
          {
            label: t('plugins.custom-theme.menu.colors.submenu.text-color'),
            type: 'normal',
            async click() {
              const current = await getConfig();
              const value = await promptColor(
                window,
                t('plugins.custom-theme.prompt.text-color.title'),
                t('plugins.custom-theme.prompt.text-color.label'),
                current.textColor,
              );
              if (value) {
                setConfig({ ...current, textColor: value });
              }
            },
          },
        ],
      },
      {
        label: t('plugins.custom-theme.menu.reset.label'),
        type: 'normal',
        click() {
          setConfig({ ...defaultColors });
        },
      },
    ];
  },
  renderer: {
    themeCssElement: null,
    activeTheme: null,
    themeCleanup: null,
    context: null,
    applyColors(colors) {
      const root = document.documentElement;
      root.style.setProperty(
        CSS_VARIABLES.accent,
        colors.accentColor,
        'important',
      );
      root.style.setProperty(
        CSS_VARIABLES.background,
        colors.backgroundColor,
        'important',
      );
      root.style.setProperty(
        CSS_VARIABLES.surface,
        colors.surfaceColor,
        'important',
      );
      root.style.setProperty(CSS_VARIABLES.text, colors.textColor, 'important');
    },
    applyTheme(theme, config) {
      const previous = this.activeTheme
        ? getTheme(this.activeTheme)
        : undefined;
      previous?.unmount?.();
      this.themeCleanup?.();
      this.themeCleanup = null;
      this.themeCssElement?.remove();
      this.themeCssElement = null;

      if (theme) {
        this.applyColors(theme.palette);
        this.activeTheme = theme.id;

        if (theme.css) {
          const element = document.createElement('style');
          element.setAttribute('data-pear-theme-css', theme.id);
          element.textContent = theme.css;
          document.head.appendChild(element);
          this.themeCssElement = element;
        }

        const cleanup = theme.mount?.({
          ...(this.context as RendererContext<CustomThemeConfig>),
          applyPalette: (palette) => this.applyColors(palette),
        });
        this.themeCleanup = typeof cleanup === 'function' ? cleanup : null;
      } else {
        this.applyColors(config);
        this.activeTheme = null;
      }
    },
    applyConfig(config) {
      const theme =
        config.theme === 'custom' ? undefined : getTheme(config.theme);

      this.applyTheme(theme, config);
    },
    clearTheme() {
      const previous = this.activeTheme
        ? getTheme(this.activeTheme)
        : undefined;
      previous?.unmount?.();
      this.themeCleanup?.();
      this.themeCleanup = null;
      this.themeCssElement?.remove();
      this.themeCssElement = null;
      this.activeTheme = null;

      const root = document.documentElement;
      root.style.removeProperty(CSS_VARIABLES.accent);
      root.style.removeProperty(CSS_VARIABLES.background);
      root.style.removeProperty(CSS_VARIABLES.surface);
      root.style.removeProperty(CSS_VARIABLES.text);
    },
    async start(context: RendererContext<CustomThemeConfig>) {
      this.context = context;
      this.applyConfig(await context.getConfig());
    },
    onConfigChange(config: CustomThemeConfig) {
      this.applyConfig(config);
    },
    stop() {
      this.clearTheme();
    },
  },
});
