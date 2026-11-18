import type { DefaultIconClass } from '@/types/datahost-get-state';

export interface MenuNavigationItemElement extends HTMLElement {
  data?: {
    icon?: DefaultIconClass;
  };
}
