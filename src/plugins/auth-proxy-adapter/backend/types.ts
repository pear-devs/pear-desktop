import type { AuthProxyConfig } from '../config';
import type { Server } from 'http';
import type { Server as NodeServer, Socket as NodeSocket } from 'node:net';

export type BackendType = {
  server?: Server | NodeServer;
  oldConfig?: AuthProxyConfig;
  startServer: (serverConfig: AuthProxyConfig) => void;
  stopServer: () => void;
  handleSocks5: (
    clientSocket: NodeSocket,
    chunk: Buffer,
    upstreamProxyUrl: string,
  ) => void;
  processSocks5Request: (
    clientSocket: NodeSocket,
    data: Buffer,
    upstreamProxyUrl: string,
  ) => void;
};
