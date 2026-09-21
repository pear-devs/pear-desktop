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
    apply(config: SnappyPluginConfig): Promise<void>;
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

    async apply(config) {
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
      await this.styleSheet.replace(config.fasterImages ? style : '');
    },

    async start({ getConfig }) {
      await this.apply(await getConfig());
    },
    async onConfigChange(newConfig) {
      await this.apply(newConfig);
    },
    async stop() {
      this.removePrefetch?.();
      this.removePrefetch = null;
      await this.styleSheet?.replace('');
    },
  },
});
