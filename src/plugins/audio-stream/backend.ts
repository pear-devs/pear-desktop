import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { ipcMain } from 'electron';

import { createBackend, LoggerPrefix } from '@/utils';

import type { BackendContext } from '@/types/contexts';

import type { AudioStreamConfig } from './config';

type ClientInfo = {
  response: ServerResponse;
  ip: string;
  lastActivity: number;
};

type BackendType = {
  server?: ReturnType<typeof createServer>;
  clients: Map<string, ClientInfo>;
  context?: BackendContext<AudioStreamConfig>;
  oldConfig?: AudioStreamConfig;
  audioConfig?: {
    sampleRate: number;
    bitDepth: number;
    channels: number;
  };
  pcmBuffer: Array<{
    metadata: {
      timestamp: number;
      sampleRate: number;
      bitDepth: number;
      channels: number;
    };
    data: Buffer;
  }>;
  maxBufferSize: number;
  startServer: (config: AudioStreamConfig) => void;
  stopServer: () => void;
};

export const backend = createBackend<BackendType, AudioStreamConfig>({
  clients: new Map<string, ClientInfo>(),
  audioConfig: undefined,
  pcmBuffer: [],
  maxBufferSize: 10, // Keep last 10 chunks for new clients

  async start(ctx: BackendContext<AudioStreamConfig>) {
    this.context = ctx;
    const config = await ctx.getConfig();
    this.oldConfig = config;

    // Listen for audio configuration
    ctx.ipc.on(
      'audio-stream:config',
      (config: { sampleRate: number; bitDepth: number; channels: number }) => {
        const oldConfig = this.audioConfig;
        this.audioConfig = config;
        console.log(
          LoggerPrefix,
          `[Audio Stream] Received audio config:`,
        config,
      );

      // If config changed and we have clients, broadcast the new config to all existing clients
      if (oldConfig && this.clients.size > 0) {
        const configJson = JSON.stringify({
          type: 'config',
          sampleRate: config.sampleRate,
          bitDepth: config.bitDepth,
          channels: config.channels,
        });
        const configBuffer = Buffer.from(configJson, 'utf-8');
        const configLength = Buffer.allocUnsafe(4);
        configLength.writeUInt32BE(configBuffer.length, 0);

        this.clients.forEach((client, clientId) => {
          try {
            if (client.response.writable && !client.response.destroyed) {
                client.response.write(configLength);
                client.response.write(configBuffer);
                console.log(
                  LoggerPrefix,
                  `[Audio Stream] Sent updated config to client ${client.ip}`,
                );
            }
            } catch (error) {
              console.error(
              LoggerPrefix,
              `[Audio Stream] Error sending updated config to client ${client.ip}:`,
                error,
            );
          }
        });
      }
    });

    // Listen for PCM audio data from renderer
    ctx.ipc.on('audio-stream:pcm-data', (data: { metadata: any; data: string }) => {
      if (!this.audioConfig) return;

      try {
        // Decode base64 to buffer
        const pcmBuffer = Buffer.from(data.data, 'base64');

        const chunk = {
          metadata: {
            timestamp: data.metadata.timestamp || Date.now(),
            sampleRate: this.audioConfig.sampleRate,
            bitDepth: this.audioConfig.bitDepth,
            channels: this.audioConfig.channels,
          },
          data: pcmBuffer,
          };

          // Add to buffer for new clients
        this.pcmBuffer.push(chunk);
        if (this.pcmBuffer.length > this.maxBufferSize) {
          this.pcmBuffer.shift();
        }

        // Send to all connected clients
        const clientsToRemove: string[] = [];

        // Pre-compute metadata to avoid repeated JSON.stringify
        const metadataJson = JSON.stringify(chunk.metadata);
        const metadataBuffer = Buffer.from(metadataJson, 'utf-8');
        const metadataLength = Buffer.allocUnsafe(4);
        metadataLength.writeUInt32BE(metadataBuffer.length, 0);
        
        // Combine all data into single buffer for efficient write (reduces syscalls)
        const combinedBuffer = Buffer.concat([metadataLength, metadataBuffer, pcmBuffer]);
        
        this.clients.forEach((client, clientId) => {
          try {
            // Check if response is writable to prevent blocking
            if (client.response.writable && !client.response.destroyed) {
              // Single write call is more efficient than multiple writes
              const canWrite = client.response.write(combinedBuffer);
              client.lastActivity = Date.now();

              // Handle backpressure - if write returns false, buffer is full
              // Don't remove client, just skip this write to prevent blocking
              if (!canWrite) {
                // Set up drain handler if not already set
                if (!client.response.listenerCount('drain')) {
                  client.response.once('drain', () => {
                    // Buffer drained, can continue writing
                  });
                }
              }
            } else {
              // Response is not writable, mark for removal
              clientsToRemove.push(clientId);
            }
          } catch (error) {
            console.error(
              LoggerPrefix,
              `[Audio Stream] Error sending PCM data to client ${client.ip}:`,
              error,
            );
            clientsToRemove.push(clientId);
          }
        });

        // Remove failed clients
        clientsToRemove.forEach((clientId) => {
          const client = this.clients.get(clientId);
          if (client) {
            try {
              client.response.end();
            } catch {
              // Ignore errors when closing
            }
          }
          this.clients.delete(clientId);
        });
      } catch (error) {
        console.error(
          LoggerPrefix,
          '[Audio Stream] Error processing PCM data:',
          error,
        );
      }
    });

    if (config.enabled) {
      this.startServer(config);
    }
  },

  stop() {
    // Remove IPC listeners
    ipcMain.removeAllListeners('audio-stream:config');
    ipcMain.removeAllListeners('audio-stream:pcm-data');

    this.stopServer();
  },

  onConfigChange(config: AudioStreamConfig) {
    const wasEnabled = this.oldConfig?.enabled ?? false;
    const portChanged = this.oldConfig?.port !== config.port;
    const hostnameChanged = this.oldConfig?.hostname !== config.hostname;

    // If port or hostname changed and server is enabled, restart it
    if (config.enabled && (portChanged || hostnameChanged || !wasEnabled)) {
      this.stopServer();
      this.startServer(config);
    } else if (!config.enabled && wasEnabled) {
      // If disabled, stop the server
      this.stopServer();
    }

    this.oldConfig = config;
  },

  startServer(config: AudioStreamConfig) {
    if (this.server) {
      this.stopServer();
    }

    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Handle CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'GET' || req.url !== '/stream') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const clientIp = req.socket.remoteAddress || 'unknown';
      const clientId = `${clientIp}-${Date.now()}`;

      // Optimize socket for low latency
      const socket = req.socket;
      if (socket) {
        socket.setNoDelay(true); // Disable Nagle's algorithm for lower latency
        socket.setKeepAlive(true, 60000); // Keep connection alive
        // Increase socket buffer sizes for better throughput (if available)
        if ('setReceiveBufferSize' in socket && typeof socket.setReceiveBufferSize === 'function') {
          try {
            (socket as any).setReceiveBufferSize(1024 * 1024); // 1MB receive buffer
          } catch {
            // Ignore if not supported
          }
        }
        if ('setSendBufferSize' in socket && typeof socket.setSendBufferSize === 'function') {
          try {
            (socket as any).setSendBufferSize(1024 * 1024); // 1MB send buffer
          } catch {
            // Ignore if not supported
          }
        }
      }

      // Set up streaming response
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no', // Disable buffering for nginx (if used)
      });

      const clientInfo: ClientInfo = {
        response: res,
        ip: clientIp,
        lastActivity: Date.now(),
      };

      this.clients.set(clientId, clientInfo);

      console.log(
        LoggerPrefix,
        `[Audio Stream] Client connected from ${clientIp}. Total clients: ${this.clients.size}`,
      );

      // Send audio configuration first
      if (this.audioConfig) {
        const configJson = JSON.stringify({
          type: 'config',
          sampleRate: this.audioConfig.sampleRate,
          bitDepth: this.audioConfig.bitDepth,
          channels: this.audioConfig.channels,
        });
        const configBuffer = Buffer.from(configJson, 'utf-8');
        const configLength = Buffer.allocUnsafe(4);
        configLength.writeUInt32BE(configBuffer.length, 0);

        try {
          res.write(configLength);
          res.write(configBuffer);
        } catch (error) {
          console.error(
            LoggerPrefix,
            `[Audio Stream] Error sending config to client ${clientIp}:`,
            error,
          );
        }
      }

      // Send buffered chunks to new client
      this.pcmBuffer.forEach((chunk) => {
        try {
          const metadataJson = JSON.stringify(chunk.metadata);
          const metadataBuffer = Buffer.from(metadataJson, 'utf-8');
          const metadataLength = Buffer.allocUnsafe(4);
          metadataLength.writeUInt32BE(metadataBuffer.length, 0);

          res.write(metadataLength);
          res.write(metadataBuffer);
          res.write(chunk.data);
        } catch (error) {
          console.error(
            LoggerPrefix,
            `[Audio Stream] Error sending buffered chunk to client ${clientIp}:`,
            error,
          );
        }
      });

      // Handle client disconnect
      req.on('close', () => {
        this.clients.delete(clientId);
        console.log(
          LoggerPrefix,
          `[Audio Stream] Client disconnected from ${clientIp}. Total clients: ${this.clients.size}`,
        );
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        // Ignore ECONNRESET and EPIPE errors (common when client disconnects)
        if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') {
          console.error(
            LoggerPrefix,
            `[Audio Stream] Error from client ${clientIp}:`,
            error,
          );
        }
        this.clients.delete(clientId);
      });

      res.on('error', (error: NodeJS.ErrnoException) => {
        // Ignore ECONNRESET and EPIPE errors
        if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') {
          console.error(
            LoggerPrefix,
            `[Audio Stream] Response error from client ${clientIp}:`,
            error,
          );
        }
        this.clients.delete(clientId);
      });
    });

    httpServer.listen(config.port, config.hostname, () => {
      console.log(
        LoggerPrefix,
        `[Audio Stream] PCM streaming server listening on http://${config.hostname}:${config.port}/stream`,
      );
    });

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      console.error(
        LoggerPrefix,
        `[Audio Stream] Server error on ${config.hostname}:${config.port}:`,
        error.message,
      );
      // If port is in use, log a helpful message
      if (error.code === 'EADDRINUSE') {
        console.error(
          LoggerPrefix,
          `[Audio Stream] Port ${config.port} is already in use. Please choose a different port.`,
        );
      }
    });

    this.server = httpServer;
  },

  stopServer() {
    // Close all client connections
    if (this.clients.size > 0) {
      this.clients.forEach((client) => {
        try {
          client.response.end();
        } catch (error) {
          // Ignore errors when closing
        }
      });
      this.clients.clear();
    }

    if (this.server) {
      this.server.close((error) => {
        if (error) {
          console.error(
            LoggerPrefix,
            '[Audio Stream] Error closing server:',
            error,
          );
        } else {
          console.log(LoggerPrefix, '[Audio Stream] HTTP server stopped');
        }
      });
      this.server = undefined;
    }

    // Clear buffers
    this.pcmBuffer = [];
    this.audioConfig = undefined;
  },
});
