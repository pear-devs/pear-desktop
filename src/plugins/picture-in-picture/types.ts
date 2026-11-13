import { config } from '@/plugins/utils/common/config';

export const pictureInPictureConfig = {
  'alwaysOnTop': config.bool(true, {
    label: 'plugins.picture-in-picture.menu.always-on-top',
  }),
  'savePosition': config.bool(true, {
    label: 'plugins.picture-in-picture.menu.save-window-position',
  }),
  'saveSize': config.bool(false, {
    label: 'plugins.picture-in-picture.menu.save-window-size',
  }),
  'hotkey': config.shortcut('P', {
    label: 'plugins.picture-in-picture.menu.hotkey.label',
  }),
  'useNativePiP': config.bool(true, {
    label: 'plugins.picture-in-picture.menu.use-native-pip',
  }),
  'pip-position': config.hidden<[number, number]>([10, 10]),
  'pip-size': config.hidden<[number, number]>([450, 275]),
  'isInPiP': config.hidden(false),
};

export type PictureInPictureIpc = {
  toBackend: { toggle: [] };
  toRenderer: { pipToggle: [isPip: boolean] };
};
