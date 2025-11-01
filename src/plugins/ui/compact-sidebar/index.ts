import { createPlugin } from '@/utils';
import { t } from '@/i18n';

export default createPlugin<
  unknown,
  unknown,
  {
    getCompactSidebar: () => HTMLElement | null;
    isCompactSidebarDisabled: () => boolean;
  }
>({
  name: () => t('plugins.compact-sidebar.name'),
  description: () => t('plugins.compact-sidebar.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    getCompactSidebar: () => document.querySelector('#mini-guide'),
    isCompactSidebarDisabled() {
      const compactSidebar = this.getCompactSidebar();
      return (
        compactSidebar === null ||
        window.getComputedStyle(compactSidebar).display === 'none'
      );
    },
    start() {
      if (this.isCompactSidebarDisabled()) {
        document.querySelector<HTMLButtonElement>('#button')?.click();
      }
    },
    stop() {
      if (this.isCompactSidebarDisabled()) {
        document.querySelector<HTMLButtonElement>('#button')?.click();
      }
    },
    onConfigChange() {
      if (this.isCompactSidebarDisabled()) {
        document.querySelector<HTMLButtonElement>('#button')?.click();
      }
    },
  },
});
