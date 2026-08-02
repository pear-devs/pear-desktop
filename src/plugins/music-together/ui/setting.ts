import { t } from '@/i18n';
import { Popup } from '@/plugins/music-together/element';
import { ElementFromHtml } from '@/plugins/utils/renderer';

import { createStatus } from './status';

import IconConnect from '../icons/connect.svg?raw';
import IconMusicCast from '../icons/music-cast.svg?raw';

export type SettingPopupProps = {
  onItemClick: (id: string) => void;
};
export const createSettingPopup = (props: SettingPopupProps) => {
  const status = createStatus();
  status.setStatus('disconnected');

  const result = Popup({
    data: [
      {
        type: 'custom',
        element: status.element,
      },
      {
        type: 'divider',
      },
      {
        id: 'music-together-host',
        type: 'item',
        icon: ElementFromHtml(IconMusicCast),
        text: t('plugins.music-together.menu.host'),
        onClick: () => props.onItemClick('music-together-host'),
      },
      {
        type: 'item',
        icon: ElementFromHtml(IconConnect),
        text: t('plugins.music-together.menu.join'),
        onClick: () => props.onItemClick('music-together-join'),
      },
    ],
    anchorAt: 'bottom-right',
    popupAt: 'top-right',
  });

  return {
    ...status,
    ...result,
  };
};
