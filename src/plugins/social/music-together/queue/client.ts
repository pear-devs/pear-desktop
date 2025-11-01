import { SHA1Hash } from './sha1hash';

export const extractToken = (cookie = document.cookie) =>
  cookie.match(/SAPISID=([^;]+);/)?.[1] ??
  cookie.match(/__Secure-3PAPISID=([^;]+);/)?.[1];

export const getHash = async (
  papisid: string,
  millis = Date.now(),
  origin: string = 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
) => (await SHA1Hash(`${millis} ${papisid} ${origin}`)).toLowerCase();

export const getAuthorizationHeader = async (
  papisid: string,
  millis = Date.now(),
  origin: string = 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
) => {
  return `SAPISIDHASH ${millis}_${await getHash(papisid, millis, origin)}`;
};

export const getClient = () => {
  return {
    hl: navigator.language.split('-')[0] ?? 'en',
    gl: navigator.language.split('-')[1] ?? 'US',
    deviceMake: '',
    deviceModel: '',
    userAgent: navigator.userAgent,
    clientName: 'WEB_REMIX',
    clientVersion: '1.20231208.05.02',
    osName: '',
    osVersion: '',
    platform: 'DESKTOP',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locationInfo: {
      locationPermissionAuthorizationStatus:
        'LOCATION_PERMISSION_AUTHORIZATION_STATUS_UNSUPPORTED',
    },
    musicAppInfo: {
      pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
      webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
      storeDigitalGoodsApiSupportStatus: {
        playStoreDigitalGoodsApiSupportStatus:
          'DIGITAL_GOODS_API_SUPPORT_STATUS_UNSUPPORTED',
      },
    },
    utcOffsetMinutes: -1 * new Date().getTimezoneOffset(),
  };
};
