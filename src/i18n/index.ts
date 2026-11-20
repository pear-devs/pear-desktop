import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { loadLanguageResource } from 'virtual:i18n';

export const APPLICATION_NAME =
  '\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063';

const FALLBACK_LANGUAGE = 'en';

export const loadI18n = async () => {
  const fallback = await loadLanguageResource(FALLBACK_LANGUAGE);

  return await init({
    // Only the fallback is loaded up front; the active language is added by
    // setLanguage. Loading all of them here costs a few hundred ms of startup.
    resources: fallback
      ? { [FALLBACK_LANGUAGE]: { translation: fallback } }
      : {},
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: {
      escapeValue: false,
    },
  });
};

export const setLanguage = async (language: string) => {
  if (!i18next.hasResourceBundle(language, 'translation')) {
    const resource = await loadLanguageResource(language);
    if (resource) {
      i18next.addResourceBundle(language, 'translation', resource);
    }
  }

  return await changeLanguage(language);
};

export const t = i18t.bind(i18next);
