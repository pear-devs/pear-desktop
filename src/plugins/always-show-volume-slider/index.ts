import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.always-show-volume-slider.name'),
  description: () => t('plugins.always-show-volume-slider.description'),
  addedVersion: '3.12.X',
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
      if (this.styleSheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (it) => it !== this.styleSheet,
        );
        this.styleSheet = null;
      }
    },
  },
});
