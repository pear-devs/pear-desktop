import { createPlugin } from '@/utils';

import { t } from '@/i18n';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.blur-nav-bar.name'),
  description: () => t('plugins.blur-nav-bar.description'),
  restartNeeded: false,
  renderer: {
    styleSheet: null as CSSStyleSheet | null,

    async start() {
      this.styleSheet = new CSSStyleSheet();
      await this.styleSheet.replace(style);

      document.adoptedStyleSheets = [
        ...document.adoptedStyleSheets,
        this.styleSheet,
      ];
    },
    async stop() {
      await this.styleSheet?.replace('');
    },
  },
});
