import { t } from '@/i18n';
import { ElementFromHtml } from '@/plugins/utils/renderer';

import { Popup } from '../element';
import { createStatus } from '../ui/status';

import IconKey from '../icons/key.svg?raw';
import IconOff from '../icons/off.svg?raw';
import IconTune from '../icons/tune.svg?raw';

export type HostPopupProps = {
  onItemClick: (id: string) => void;
};
export const createHostPopup = (props: HostPopupProps) => {
  const status = createStatus();
  status.setStatus('host');

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
        id: 'music-together-copy-id',
        type: 'item',
        icon: ElementFromHtml(IconKey),
        text: t('plugins.music-together.menu.click-to-copy-id'),
        onClick: () => props.onItemClick('music-together-copy-id'),
      },
      {
        id: 'music-together-permission',
        type: 'item',
        icon: ElementFromHtml(IconTune),
        text: t('plugins.music-together.menu.set-permission', {
          permission: t('plugins.music-together.menu.permission.host-only'),
        }),
        onClick: () => props.onItemClick('music-together-permission'),
      },
      {
        type: 'divider',
      },
      {
        type: 'item',
        id: 'music-together-close',
        icon: ElementFromHtml(IconOff),
        text: t('plugins.music-together.menu.close'),
        onClick: () => props.onItemClick('music-together-close'),
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
