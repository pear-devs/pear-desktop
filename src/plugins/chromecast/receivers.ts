// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
/* oxlint-disable eslint/no-control-regex */
export const CHROMECAST_MAX_RECEIVERS = 24;
export const CHROMECAST_NAME_MAX_LENGTH = 80;
export const CHROMECAST_ID_MAX_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export type ChromecastReceiverDescriptor = {
  id: string;
  name: string;
};

export function sanitizeReceiverName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Chromecast';
  return cleaned.slice(0, CHROMECAST_NAME_MAX_LENGTH);
}

export function isValidReceiverId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ID_PATTERN.test(value) &&
    value.length <= CHROMECAST_ID_MAX_LENGTH
  );
}

export function txtRecordString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value instanceof Uint8Array) {
    try {
      const decoded = new TextDecoder().decode(value).replace(/\0+$/g, '');
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Cast TXT `id` is hex, but mDNS fqdn often has spaces (`SHIELD Android TV._googlecast._tcp.local`). */
export function normalizeReceiverId(value: unknown): string | null {
  const raw = txtRecordString(value);
  if (!raw) return null;
  if (ID_PATTERN.test(raw) && raw.length <= CHROMECAST_ID_MAX_LENGTH)
    return raw;
  const slug = raw
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHROMECAST_ID_MAX_LENGTH);
  return ID_PATTERN.test(slug) && slug.length > 0 ? slug : null;
}

export function sanitizeReceiverList(
  input: unknown,
): ChromecastReceiverDescriptor[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ChromecastReceiverDescriptor[] = [];
  for (const item of input) {
    if (out.length >= CHROMECAST_MAX_RECEIVERS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as { id?: unknown; name?: unknown };
    if (!isValidReceiverId(rec.id)) continue;
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push({ id: rec.id, name: sanitizeReceiverName(rec.name) });
  }
  return out;
}

export function findReceiverById(
  receivers: readonly ChromecastReceiverDescriptor[],
  id: string | null | undefined,
): ChromecastReceiverDescriptor | null {
  if (!isValidReceiverId(id)) return null;
  return receivers.find((item) => item.id === id) ?? null;
}
