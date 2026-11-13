import Bonjour from 'bonjour-service';

// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
import { isSafeCastHost } from './endpoint';
import {
  normalizeReceiverId,
  sanitizeReceiverName,
  txtRecordString,
} from './receivers';

const log = console;
const QUERY_BURST_MS = [0, 150, 400, 1000];

export type DiscoveredReceiver = {
  id: string;
  name: string;
  host: string;
  port: number;
};

type CastService = {
  name?: string;
  fqdn?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  referer?: { address?: string };
  txt?: Record<string, unknown>;
};

type CastBrowser = {
  on: (event: 'up' | 'down', listener: (service: CastService) => void) => void;
  start?: () => void;
  stop: () => void;
  update?: () => void;
};

function txtField(
  txt: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!txt) return null;
  const direct = txtRecordString(txt[key]);
  if (direct) return direct;
  const want = key.toLowerCase();
  for (const [k, v] of Object.entries(txt)) {
    if (k.toLowerCase() === want) return txtRecordString(v);
  }
  return null;
}

function pickHost(service: CastService): string | null {
  const candidates = [
    ...(service.addresses ?? []),
    service.referer?.address,
    service.host,
  ];
  for (const value of candidates) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const host = value.replace(/\.$/, '');
    if (isSafeCastHost(host)) return host;
  }
  return null;
}

function receiverId(service: CastService, host: string): string | null {
  return (
    normalizeReceiverId(txtField(service.txt, 'id')) ??
    normalizeReceiverId(service.fqdn) ??
    normalizeReceiverId(host.replace(/\./g, '-'))
  );
}

export function startCastDiscovery(
  onChange: (list: DiscoveredReceiver[]) => void,
): () => void {
  const bonjour = new Bonjour();
  const byId = new Map<string, DiscoveredReceiver>();
  const browser = bonjour.find({ type: 'googlecast' }) as CastBrowser;
  const queryTimers: ReturnType<typeof setTimeout>[] = [];

  const emit = () => {
    onChange([...byId.values()]);
  };

  const query = () => {
    try {
      browser.update?.();
    } catch {
      /* ignore */
    }
  };

  browser.on('up', (service: CastService) => {
    try {
      const host = pickHost(service);
      if (!host) return;
      const id = receiverId(service, host);
      if (!id) return;
      const name = sanitizeReceiverName(
        txtField(service.txt, 'fn') ||
          txtField(service.txt, 'md') ||
          service.name,
      );
      const port = Number(service.port) || 8009;
      byId.set(id, { id, name, host, port });
      emit();
    } catch (err) {
      log.warn('discovery up failed', err);
    }
  });

  browser.on('down', (service: CastService) => {
    const id =
      normalizeReceiverId(txtField(service.txt, 'id')) ??
      normalizeReceiverId(service.fqdn);
    if (id) byId.delete(id);
    emit();
  });

  try {
    browser.start?.();
  } catch (err) {
    log.warn('discovery start failed', err);
  }

  for (const delay of QUERY_BURST_MS) {
    queryTimers.push(setTimeout(query, delay));
  }

  return () => {
    for (const timer of queryTimers) clearTimeout(timer);
    try {
      browser.stop();
    } catch {
      /* ignore */
    }
    try {
      bonjour.destroy();
    } catch {
      /* ignore */
    }
    byId.clear();
  };
}
