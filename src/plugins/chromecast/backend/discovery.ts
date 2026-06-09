import { isIPv4 } from 'node:net';

import Bonjour from 'bonjour-service';

import { LoggerPrefix } from '@/utils';

import type { CastDevice } from '../types';

type Service = InstanceType<typeof Bonjour.Service>;
type Browser = InstanceType<typeof Bonjour.Browser>;

/**
 * Discovers Google Cast devices on the LAN via mDNS (`_googlecast._tcp`)
 * and keeps a live registry. Pure-JS (bonjour-service) — no native build.
 */
export class CastDiscovery {
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private browser: Browser | null = null;
  private readonly devices = new Map<string, CastDevice>();
  private onChange?: (devices: CastDevice[]) => void;

  start(onChange?: (devices: CastDevice[]) => void) {
    this.onChange = onChange;
    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find(
      { type: 'googlecast', protocol: 'tcp' },
      (service: Service) => this.onService(service),
    );
    // Devices that go away fire `down` on the underlying browser.
    this.browser.on('down', (service: Service) => {
      const id = this.idFor(service);
      if (id && this.devices.delete(id)) this.emit();
    });
    console.log(LoggerPrefix, '[chromecast] mDNS discovery started');
  }

  /** Re-issue an mDNS query so newly powered-on devices show up quickly. */
  refresh() {
    this.browser?.update();
  }

  stop() {
    try {
      this.browser?.stop();
      this.bonjour?.destroy();
    } catch (err) {
      console.error(LoggerPrefix, '[chromecast] discovery stop error', err);
    }
    this.browser = null;
    this.bonjour = null;
    this.devices.clear();
  }

  list(): CastDevice[] {
    return [...this.devices.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  get(id: string): CastDevice | undefined {
    return this.devices.get(id);
  }

  private idFor(service: Service): string | undefined {
    const txt = (service.txt ?? {}) as Record<string, string>;
    return txt.id || service.name;
  }

  private onService(service: Service) {
    const txt = (service.txt ?? {}) as Record<string, string>;
    // Prefer an advertised IPv4 address; only fall back to the referer when it
    // too is IPv4, so we never store an IPv6 host the Cast client can't use.
    const referer = service.referer?.address;
    const host =
      (service.addresses ?? []).find((addr) => isIPv4(addr)) ??
      (referer && isIPv4(referer) ? referer : undefined);
    const id = this.idFor(service);
    if (!host || !id) return;

    this.devices.set(id, {
      id,
      name: txt.fn || service.name,
      host,
      port: service.port || 8009,
      model: txt.md,
    });
    this.emit();
  }

  private emit() {
    this.onChange?.(this.list());
  }
}
