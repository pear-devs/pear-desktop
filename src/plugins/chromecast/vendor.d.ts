// Adapted from Venipa/ytmdesktop2; see THIRD_PARTY_CAST.md.
/* oxlint-disable eslint/no-undef -- EventEmitter is imported as a declaration base. */
declare module 'castv2' {
  import type { EventEmitter } from 'node:events';
  export class Client extends EventEmitter {
    connect(
      options: { host: string; port?: number },
      callback?: () => void,
    ): void;
    createChannel(
      sourceId: string,
      destinationId: string,
      namespace: string,
      encoding: 'JSON' | 'BINARY',
    ): Castv2Channel;
    close(): void;
  }
  export interface Castv2Channel extends EventEmitter {
    send(data: unknown): void;
    on(
      event: 'message',
      listener: (data: unknown, broadcast: boolean) => void,
    ): this;
  }
}

declare module 'bonjour-service' {
  import { type EventEmitter } from 'node:events';
  export type BonjourServiceRecord = {
    name: string;
    fqdn?: string;
    host: string;
    port: number;
    addresses?: string[];
    referer?: { address?: string };
    txt?: Record<string, string>;
  };
  export interface BonjourBrowser extends EventEmitter {
    start(): void;
    stop(): void;
    on(
      event: 'up' | 'down',
      listener: (service: BonjourServiceRecord) => void,
    ): this;
  }
  class Bonjour {
    constructor();
    find(options: { type: string }): BonjourBrowser;
    destroy(): void;
  }
  export default Bonjour;
}
