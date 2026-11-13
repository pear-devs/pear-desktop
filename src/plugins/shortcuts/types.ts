import { config } from '@/plugins/utils/common/config';

const keybind = (label?: string) => config.shortcut('', label ? { label } : {});

export const shortcutsConfig = {
  global: config.group(
    {
      previous: keybind(
        'plugins.shortcuts.prompt.keybind.keybind-options.previous',
      ),
      playPause: keybind(
        'plugins.shortcuts.prompt.keybind.keybind-options.play-pause',
      ),
      next: keybind('plugins.shortcuts.prompt.keybind.keybind-options.next'),
    },
    { label: 'plugins.shortcuts.menu.set-keybinds' },
  ),
  overrideMediaKeys: config.bool(false, {
    label: 'plugins.shortcuts.menu.override-media-keys',
  }),
  // Not in the menu (as before): set in the config file.
  local: config.group({
    previous: keybind(),
    playPause: keybind(),
    next: keybind(),
  }),
};
