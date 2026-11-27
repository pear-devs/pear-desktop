import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { installPrefetch } from './prefetch';
import style from './style.css?inline';

export type SnappyPluginConfig = {
  enabled: boolean;
  /**
   * Start loading a page as soon as the pointer rests on a link to it,
   * so it's often already downloaded by the time the click lands.
   *
   * @default true
   */
  prefetchOnHover: boolean;
  /**
   * Shorten the 500ms fade-in on thumbnails and page header art.
   *
   * @default true
   */
  fasterImages: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    styleSheet: CSSStyleSheet | null;
    removePrefetch: (() => void) | null;
    apply(config: SnappyPluginConfig): void;
  },
  SnappyPluginConfig
>({
  name: () => t('plugins.snappy.name'),
  description: () => t('plugins.snappy.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    prefetchOnHover: true,
    fasterImages: true,
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.snappy.menu.prefetch-on-hover'),
        type: 'checkbox',
        checked: config.prefetchOnHover,
        async click() {
          const now = await getConfig();
          setConfig({ prefetchOnHover: !now.prefetchOnHover });
        },
      },
      {
        label: t('plugins.snappy.menu.faster-images'),
        type: 'checkbox',
        checked: config.fasterImages,
        async click() {
          const now = await getConfig();
          setConfig({ fasterImages: !now.fasterImages });
        },
      },
    ];
  },
  renderer: {
    styleSheet: null,
    removePrefetch: null,

    apply(config) {
      if (config.prefetchOnHover && !this.removePrefetch) {
        this.removePrefetch = installPrefetch();
      } else if (!config.prefetchOnHover && this.removePrefetch) {
        this.removePrefetch();
        this.removePrefetch = null;
      }

      if (!this.styleSheet) {
        this.styleSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [
          ...document.adoptedStyleSheets,
          this.styleSheet,
        ];
      }
      // replaceSync, not replace(): a second async replace() issued while
      // one is still pending is rejected, which could leave the faster fades
      // applied after they were switched off. The CSS has no @import, so
      // the synchronous form is enough.
      this.styleSheet.replaceSync(config.fasterImages ? style : '');
    },

    async start({ getConfig }) {
      this.apply(await getConfig());
    },
    onConfigChange(newConfig) {
      this.apply(newConfig);
    },
    stop() {
      this.removePrefetch?.();
      this.removePrefetch = null;
      this.styleSheet?.replaceSync('');
    },
  },
});
