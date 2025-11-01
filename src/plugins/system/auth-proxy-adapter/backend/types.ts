import type net from 'net';
import type { AuthProxyConfig } from '../config';
import type { Server } from 'http';

export type BackendType = {
  server?: Server | net.Server;
  oldConfig?: AuthProxyConfig;
  startServer: (serverConfig: AuthProxyConfig) => void;
  stopServer: () => void;
  handleSocks5: (
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string,
  ) => void;
  processSocks5Request: (
    clientSocket: net.Socket,
    data: Buffer,
    upstreamProxyUrl: string,
  ) => void;
};
