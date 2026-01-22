import * as net from 'node:net';

import { SocksClient, type SocksClientOptions } from 'socks';
import is from 'electron-is';

import { createBackend, LoggerPrefix } from '@/utils';

import * as config from '@/config';

import { type AuthProxyConfig, defaultAuthProxyConfig } from '../config';

import type { BackendType } from './types';
import type { BackendContext } from '@/types/contexts';

// Parsing the upstream authentication SOCK proxy URL
const parseSocksUrl = (socksUrl: string) => {
  // Format: socks5://username:password@your_server_ip:port

  const url = new URL(socksUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port, 10),
    type: url.protocol === 'socks5:' ? 5 : 4,
    username: url.username,
    password: url.password,
  };
};

export const backend = createBackend<BackendType, AuthProxyConfig>({
  async start(ctx: BackendContext<AuthProxyConfig>) {
    const pluginConfig = await ctx.getConfig();
    this.startServer(pluginConfig);
  },
  stop() {
    this.stopServer();
  },
  onConfigChange(config: AuthProxyConfig) {
    if (
      this.oldConfig?.hostname === config.hostname &&
      this.oldConfig?.port === config.port
    ) {
      this.oldConfig = config;
      return;
    }
    this.stopServer();
    this.startServer(config);

    this.oldConfig = config;
  },

  // Custom
  // Start proxy server - SOCKS5
  startServer(serverConfig: AuthProxyConfig) {
    if (this.server) {
      this.stopServer();
    }

    const { port, hostname } = serverConfig;
    // Upstream proxy from system settings
    const upstreamProxyUrl = config.get('options.proxy');
    // Create SOCKS proxy server
    const socksServer = net.createServer((socket) => {
      socket.once('data', (chunk) => {
        if (chunk[0] === 0x05) {
          // SOCKS5
          this.handleSocks5(socket, chunk, upstreamProxyUrl);
        } else {
          socket.end();
        }
      });

      socket.on('error', (err) => {
        console.error(LoggerPrefix, '[SOCKS] Socket error:', err.message);
      });
    });

    // Listen for errors
    socksServer.on('error', (err) => {
      console.error(LoggerPrefix, '[SOCKS Server Error]', err.message);
    });

    // Start server
    socksServer.listen(port, hostname, () => {
      console.log(LoggerPrefix, '===========================================');
      console.log(
        LoggerPrefix,
        `[Auth-Proxy-Adapter] Enable SOCKS proxy at socks5://${hostname}:${port}`,
      );
      console.log(
        LoggerPrefix,
        `[Auth-Proxy-Adapter] Using upstream proxy: ${upstreamProxyUrl}`,
      );
      console.log(LoggerPrefix, '===========================================');
    });

    this.server = socksServer;
  },

  // Handle SOCKS5 request
  handleSocks5(
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string,
  ) {
    // Handshake phase
    const numMethods = chunk[1];
    const methods = chunk.subarray(2, 2 + numMethods);

    // Check if client supports no authentication method (0x00)
    if (methods.includes(0x00)) {
      // Reply to client, choose no authentication method
      clientSocket.write(Buffer.from([0x05, 0x00]));

      // Wait for client's connection request
      clientSocket.once('data', (data) => {
        this.processSocks5Request(clientSocket, data, upstreamProxyUrl);
      });
    } else {
      // Authentication methods not supported by the client
      clientSocket.write(Buffer.from([0x05, 0xff]));
      clientSocket.end();
    }
  },

  // Handle SOCKS5 connection request
  processSocks5Request(
    clientSocket: net.Socket,
    data: Buffer,
    upstreamProxyUrl: string,
  ) {
    // Parse target address and port
    let targetHost, targetPort;
    const cmd = data[1]; // Command: 0x01=CONNECT, 0x02=BIND, 0x03=UDP
    const atyp = data[3]; // Address type: 0x01=IPv4, 0x03=Domain, 0x04=IPv6

    if (cmd !== 0x01) {
      // Currently only support CONNECT command
      clientSocket.write(
        Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }

    if (atyp === 0x01) {
      // IPv4
      targetHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
      targetPort = data.readUInt16BE(8);
    } else if (atyp === 0x03) {
      // Domain
      const hostLen = data[4];
      targetHost = data.subarray(5, 5 + hostLen).toString();
      targetPort = data.readUInt16BE(5 + hostLen);
    } else if (atyp === 0x04) {
      // IPv6
      const ipv6Buffer = data.subarray(4, 20);
      targetHost = Array.from(new Array(8), (_, i) =>
        ipv6Buffer.readUInt16BE(i * 2).toString(16),
      ).join(':');
      targetPort = data.readUInt16BE(20);
    }
    if (is.dev()) {
      console.debug(
        LoggerPrefix,
        `[SOCKS5] Request to connect to ${targetHost}:${targetPort}`,
      );
    }

    const socksProxy = parseSocksUrl(upstreamProxyUrl);

    if (!socksProxy) {
      // Failed to parse proxy URL
      clientSocket.write(
        Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }

    const options: SocksClientOptions = {
      proxy: {
        host: socksProxy.host,
        port: socksProxy.port,
        type: socksProxy.type as 4 | 5,
        userId: socksProxy.username,
        password: socksProxy.password,
      },
      command: 'connect',
      destination: {
        host: targetHost || defaultAuthProxyConfig.hostname,
        port: targetPort || defaultAuthProxyConfig.port,
      },
    };
    SocksClient.createConnection(options)
      .then((info) => {
        const { socket: proxySocket } = info;

        // Connection successful, send success response to client
        const responseBuffer = Buffer.from([
          0x05, // VER: SOCKS5
          0x00, // REP: Success
          0x00, // RSV: Reserved field
          0x01, // ATYP: IPv4
          0,
          0,
          0,
          0, // BND.ADDR: 0.0.0.0 (Bound address, usually not important)
          0,
          0, // BND.PORT: 0 (Bound port, usually not important)
        ]);
        clientSocket.write(responseBuffer);

        // Establish bidirectional data stream
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);

        proxySocket.on('error', (error) => {
          console.error(LoggerPrefix, '[SOCKS5] Proxy socket error:', error);
          if (clientSocket.writable) clientSocket.end();
        });

        clientSocket.on('error', (error) => {
          console.error(LoggerPrefix, '[SOCKS5] Client socket error:', error);
          if (proxySocket.writable) proxySocket.end();
        });
      })
      .catch((error) => {
        console.error(LoggerPrefix, '[SOCKS5] Connection error:', error);
        // Send failure response to client
        clientSocket.write(
          Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientSocket.end();
      });
  },

  // Stop proxy server
  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  },
});
