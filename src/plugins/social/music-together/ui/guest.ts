import { ElementFromHtml } from '@/plugins/utils/renderer';

import { t } from '@/i18n';

import { Popup } from '../element';
import { createStatus } from '../ui/status';

import IconOff from '../icons/off.svg?raw';

export type GuestPopupProps = {
  onItemClick: (id: string) => void;
};
export const createGuestPopup = (props: GuestPopupProps) => {
  const status = createStatus();
  status.setStatus('guest');

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
        type: 'item',
        id: 'music-together-disconnect',
        icon: ElementFromHtml(IconOff),
        text: t('plugins.music-together.menu.disconnect'),
        onClick: () => props.onItemClick('music-together-disconnect'),
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
