import { config } from '@/plugins/utils/common/config';

export const captionsSelectorConfig = {
  disableCaptions: config.bool(false, {
    label: 'plugins.captions-selector.menu.disable-captions',
  }),
  autoload: config.bool(false, {
    label: 'plugins.captions-selector.menu.autoload',
  }),
  lastCaptionsCode: config.hidden(''),
};

export type CaptionsSelectorIpc = {
  invoke: {
    /** Asks which caption track to use; the index of the pick, or null if cancelled. */
    pickCaptions(
      captionLabels: Record<string, string>,
      currentIndex: string,
    ): number | null;
  };
};

export interface LanguageOptions {
  displayName: string;
  id: string | null;
  is_default: boolean;
  is_servable: boolean;
  is_translateable: boolean;
  kind: string;
  languageCode: string; // 2 length
  languageName: string;
  name: string | null;
  vss_id: string;
}
