import i18next, { init, t as i18t, changeLanguage } from 'i18next';

import { languageResources } from 'virtual:i18n';

export const APPLICATION_NAME =
  '\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063';

export const loadI18n = async () =>
  await init({
    resources: await languageResources(),
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export const setLanguage = async (language: string) =>
  await changeLanguage(language);

export const t = i18t.bind(i18next);
