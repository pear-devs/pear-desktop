import { Platform } from '@/types/plugins';

import type { SettingField, SettingsGroup } from '@/types/settings';

/** Current platform as a `Platform` bit, resolved via the preload-exposed electron-is. */
const currentPlatformBit = (): number => {
  const is = window.electronIs;
  if (is.windows()) return Platform.Windows;
  if (is.macOS()) return Platform.macOS;
  if (is.linux()) return Platform.Linux;
  if (is.freebsd?.()) return Platform.Freebsd;
  return 0;
};

/** Whether a field applies to the current platform (mirrors the build-time plugin filter). */
export const fieldSupportsPlatform = (field: SettingField): boolean =>
  typeof field.platform !== 'number' ||
  (field.platform & currentPlatformBit()) !== 0;

/** Drop platform-mismatched fields, then any group left with no fields. */
export const filterGroupsByPlatform = (
  groups: SettingsGroup[],
): SettingsGroup[] =>
  groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter(fieldSupportsPlatform),
    }))
    .filter((group) => group.fields.length > 0);
