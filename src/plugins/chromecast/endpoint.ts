// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
const HOST_MAX = 253;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DNS = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const APP_ID = /^[A-Za-z0-9]{1,32}$/;
const HANDLE = /^cast-\d+-\d+$/;

export function isSafeCastHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.length === 0 || host.length > HOST_MAX)
    return false;
  if (host.includes('\0')) return false;
  if (IPV4.test(host)) {
    return host.split('.').every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      if (octet.length > 1 && octet.startsWith('0')) return false;
      const n = Number(octet);
      return n >= 0 && n <= 255;
    });
  }
  return DNS.test(host) && !host.includes('..');
}

export function isSafeCastPort(port: unknown): port is number {
  return (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  );
}

export function isSafeCastAppId(appId: unknown): appId is string {
  return typeof appId === 'string' && APP_ID.test(appId);
}

export function isSafeCastHandle(handle: unknown): handle is string {
  return (
    typeof handle === 'string' && HANDLE.test(handle) && handle.length <= 64
  );
}
