import prompt from 'custom-electron-prompt';

import { popularFonts } from './types';

import promptOptions from '@/providers/prompt-options';

import type { MenuItemConstructorOptions } from 'electron';

import type { MenuContext } from '@/types/contexts';

import type { FontCustomizerConfig } from './types';

const toRadio = (
  current: string,
  label: string,
  click: (value: string) => void,
): MenuItemConstructorOptions => ({
  label,
  type: 'radio',
  checked: current === label,
  click: () => click(label),
});

export const menu = async ({
  getConfig,
  setConfig,
  window,
  refresh,
}: MenuContext<FontCustomizerConfig>): Promise<
  MenuItemConstructorOptions[]
> => {
  const cfg = await getConfig();

  const allFonts = [
    ...new Set([
      'System Default',
      ...popularFonts.filter((f) => f !== 'System Default'),
      ...(cfg.customFonts || []),
    ]),
  ];

  const section = (
    title: string,
    current: string,
    onPick: (value: string) => void,
  ): MenuItemConstructorOptions => ({
    label: title,
    submenu: allFonts.map((f) => toRadio(current, f, onPick)),
  });

  const createFontPicker = (
    label: string,
    fontType: keyof FontCustomizerConfig,
  ): MenuItemConstructorOptions => ({
    label,
    type: 'normal',
    enabled: cfg.enabled,
    click: async () => {
      const currentConfig = await getConfig();
      const newFont = await prompt(
        {
          title: `${label.replace('Pick ', '').replace('…', '')}`,
          label: 'Enter a Google Font family name:',
          type: 'input',
          value: currentConfig[fontType],
          ...promptOptions(),
        },
        window,
      );

      if (newFont && newFont.trim()) {
        const trimmedFont = newFont.trim();
        const customFonts = currentConfig.customFonts || [];
        const isNew =
          !popularFonts.includes(trimmedFont) &&
          !customFonts.includes(trimmedFont);

        const newConfig: Partial<FontCustomizerConfig> = {
          [fontType]: trimmedFont,
        };
        if (isNew) {
          newConfig.customFonts = [...customFonts, trimmedFont];
        }

        await setConfig(newConfig);
        refresh?.();
      }
    },
  });

  const modeItems: MenuItemConstructorOptions[] = [
    {
      label: 'Simple (Global)',
      type: 'radio',
      checked: cfg.mode === 'simple',
      click: async () => {
        await setConfig({ mode: 'simple' });
        try {
          window?.webContents.send('close-all-in-app-menu-panel');
        } catch {}
        setTimeout(() => refresh?.(), 100);
      },
    },
    {
      label: 'Advanced (Per section)',
      type: 'radio',
      checked: cfg.mode === 'advanced',
      click: async () => {
        await setConfig({ mode: 'advanced' });
        try {
          window?.webContents.send('close-all-in-app-menu-panel');
        } catch {}
        setTimeout(() => refresh?.(), 100);
      },
    },
  ];

  const simpleModeItems: MenuItemConstructorOptions[] = [
    createFontPicker('Pick global font…', 'globalFont'),
    section('Global font', cfg.globalFont, (value) =>
      setConfig({ globalFont: value }),
    ),
  ];

  const advancedModeItems: MenuItemConstructorOptions[] = [
    createFontPicker('Pick primary UI font…', 'primaryFont'),
    section('Primary UI font', cfg.primaryFont, (value) =>
      setConfig({ primaryFont: value }),
    ),
    createFontPicker('Pick header font…', 'headerFont'),
    section('Header font', cfg.headerFont, (value) =>
      setConfig({ headerFont: value }),
    ),
    createFontPicker('Pick title font…', 'titleFont'),
    section('Title font', cfg.titleFont, (value) =>
      setConfig({ titleFont: value }),
    ),
    createFontPicker('Pick artist font…', 'artistFont'),
    section('Artist font', cfg.artistFont, (value) =>
      setConfig({ artistFont: value }),
    ),
    createFontPicker('Pick lyrics font…', 'lyricsFont'),
    section('Lyrics font', cfg.lyricsFont, (value) =>
      setConfig({ lyricsFont: value }),
    ),
    createFontPicker('Pick menu font…', 'menuFont'),
    section('Menu font', cfg.menuFont, (value) =>
      setConfig({ menuFont: value }),
    ),
  ];

  const simpleModeMenuItems = simpleModeItems.map((item) => ({
    ...item,
    visible: cfg.mode === 'simple',
  }));

  const advancedModeMenuItems = advancedModeItems.map((item) => ({
    ...item,
    visible: cfg.mode === 'advanced',
  }));

  return [
    {
      label: 'Mode',
      submenu: modeItems,
    },
    { type: 'separator' },
    ...simpleModeMenuItems,
    ...advancedModeMenuItems,
  ];
};
