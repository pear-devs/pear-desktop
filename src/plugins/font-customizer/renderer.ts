import { createRenderer } from '@/utils';

import type { FontCustomizerConfig } from './types';

function injectGoogleFont(doc: Document, family: string) {
  if (
    family === 'System Default' ||
    doc.querySelector<HTMLLinkElement>(
      `link[data-font-family="${CSS.escape(family)}"]`,
    )
  ) {
    return;
  }

  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, '+')}:wght@300;400;500;600;700;800&display=swap`;
  link.setAttribute('data-font-family', family);
  doc.head.appendChild(link);
}

function setCssVar(name: string, value: string | null) {
  const root = document.documentElement;
  if (!value || value === 'System Default') {
    root.style.removeProperty(name);
  } else {
    root.style.setProperty(name, `"${value}", sans-serif`);
  }
}

function clearAllFontVars() {
  const root = document.documentElement;
  root.style.removeProperty('--ytmusic-font-global');
  root.style.removeProperty('--ytmusic-font-primary');
  root.style.removeProperty('--ytmusic-font-header');
  root.style.removeProperty('--ytmusic-font-title');
  root.style.removeProperty('--ytmusic-font-artist');
  root.style.removeProperty('--ytmusic-font-lyrics');
  root.style.removeProperty('--ytmusic-font-menu');
}

function applyConfig(config: FontCustomizerConfig) {
  const doc = document;
  clearAllFontVars();

  if (config.enabled) {
    doc.documentElement.setAttribute('data-font-customizer', 'active');
  } else {
    doc.documentElement.removeAttribute('data-font-customizer');
    return;
  }

  if (config.mode === 'simple') {
    injectGoogleFont(doc, config.globalFont);
    setCssVar('--ytmusic-font-global', config.globalFont);
  } else {
    injectGoogleFont(doc, config.primaryFont);
    injectGoogleFont(doc, config.headerFont);
    injectGoogleFont(doc, config.titleFont);
    injectGoogleFont(doc, config.artistFont);
    injectGoogleFont(doc, config.lyricsFont);
    injectGoogleFont(doc, config.menuFont);

    setCssVar('--ytmusic-font-primary', config.primaryFont);
    setCssVar('--ytmusic-font-header', config.headerFont);
    setCssVar('--ytmusic-font-title', config.titleFont);
    setCssVar('--ytmusic-font-artist', config.artistFont);
    setCssVar('--ytmusic-font-lyrics', config.lyricsFont);
    setCssVar('--ytmusic-font-menu', config.menuFont);
  }
}

export const renderer = createRenderer<unknown, FontCustomizerConfig>({
  start: async ({ getConfig }) => {
    const cfg = await getConfig();
    applyConfig(cfg);
  },
  onConfigChange: (cfg) => {
    applyConfig(cfg);
  },
});
