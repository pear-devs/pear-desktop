import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';

import { getSongControls } from '@/providers/song-controls';
import { registerCallback, type SongInfo } from '@/providers/song-info';
import { createBackend, LoggerPrefix } from '@/utils';

import type { McpServerConfig } from './config';

const LOCAL_HOST = '127.0.0.1';

const textResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
});

const jsonResult = (value: unknown) =>
  textResult(JSON.stringify(value, null, 2));

const noSongResult = () => ({
  content: [
    {
      type: 'text' as const,
      text: 'No song information is available yet. Start playing a track and try again.',
    },
  ],
  isError: true,
});

const allowedHosts = (port: number) => [
  LOCAL_HOST,
  `${LOCAL_HOST}:${port}`,
  'localhost',
  `localhost:${port}`,
  '[::1]',
  `[::1]:${port}`,
];

const createMcpServer = (
  window: Electron.BrowserWindow,
  getSongInfo: () => SongInfo | undefined,
) => {
  const controls = getSongControls(window);
  const server = new McpServer({
    name: 'youtube-music-desktop',
    version: '1.0.0',
  });

  server.registerTool(
    'music_previous',
    { description: 'Play the previous song in the YouTube Music queue.' },
    () => {
      controls.previous();
      return textResult('Playing the previous song.');
    },
  );

  server.registerTool(
    'music_next',
    { description: 'Play the next song in the YouTube Music queue.' },
    () => {
      controls.next();
      return textResult('Playing the next song.');
    },
  );

  server.registerTool('music_play', { description: 'Resume playback.' }, () => {
    controls.play();
    return textResult('Playback started.');
  });

  server.registerTool(
    'music_play_video',
    {
      description: 'Immediately play a YouTube Music video ID.',
      inputSchema: {
        videoId: z.string().trim().min(1),
      },
    },
    ({ videoId }) => {
      controls.playVideo(videoId);
      return textResult('Video playback started.');
    },
  );

  server.registerTool('music_pause', { description: 'Pause playback.' }, () => {
    controls.pause();
    return textResult('Playback paused.');
  });

  server.registerTool(
    'music_toggle_playback',
    { description: 'Toggle between playing and paused.' },
    () => {
      controls.playPause();
      return textResult('Playback toggled.');
    },
  );

  server.registerTool(
    'music_seek',
    {
      description: 'Seek to an absolute position in the current song.',
      inputSchema: {
        seconds: z.number().finite().nonnegative(),
      },
    },
    ({ seconds }) => {
      controls.seekTo(seconds);
      return textResult(`Seeked to ${seconds} seconds.`);
    },
  );

  server.registerTool(
    'music_set_volume',
    {
      description: 'Set playback volume as a percentage between 0 and 100.',
      inputSchema: {
        volume: z.number().finite().min(0).max(100),
      },
    },
    ({ volume }) => {
      controls.setVolume(volume);
      return textResult(`Volume set to ${volume}%.`);
    },
  );

  server.registerTool(
    'music_now_playing',
    { description: 'Get information about the currently playing song.' },
    () => {
      const songInfo = getSongInfo();
      if (!songInfo) return noSongResult();

      const response = { ...songInfo };
      delete response.image;
      return jsonResult(response);
    },
  );

  server.registerTool(
    'music_search',
    {
      description:
        'Search YouTube Music. The result includes video IDs for music_enqueue.',
      inputSchema: {
        query: z.string().trim().min(1),
        params: z.string().optional(),
        continuation: z.string().optional(),
      },
    },
    async ({ query, params, continuation }) => {
      try {
        const result = await controls.search(query, params, continuation);
        return jsonResult(result);
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                error instanceof Error
                  ? error.message
                  : 'YouTube Music search failed.',
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'music_enqueue',
    {
      description: 'Add a YouTube Music video ID to the playback queue.',
      inputSchema: {
        videoId: z.string().trim().min(1),
        insertPosition: z
          .enum(['INSERT_AT_END', 'INSERT_AFTER_CURRENT_VIDEO'])
          .default('INSERT_AT_END'),
      },
    },
    ({ videoId, insertPosition }) => {
      controls.addSongToQueue(videoId, insertPosition);
      return textResult('Song added to the queue.');
    },
  );

  server.registerTool(
    'music_clear_queue',
    { description: 'Remove every song from the YouTube Music playback queue.' },
    () => {
      controls.clearQueue();
      return textResult('Playback queue cleared.');
    },
  );

  return server;
};

type McpServerBackend = {
  server?: ReturnType<typeof serve>;
  window?: Electron.BrowserWindow;
  songInfo?: SongInfo;
  songInfoCallbackRegistered: boolean;

  run: (config: McpServerConfig) => void;
  end: () => void;
};

export const backend = createBackend<McpServerBackend, McpServerConfig>({
  songInfoCallbackRegistered: false,
  async start(ctx) {
    this.window = ctx.window;

    if (!this.songInfoCallbackRegistered) {
      registerCallback((songInfo) => {
        this.songInfo = songInfo;
      });
      this.songInfoCallbackRegistered = true;
    }

    this.run(await ctx.getConfig());
  },
  stop() {
    this.end();
  },
  onConfigChange(config) {
    this.end();
    this.run(config);
  },
  run(config) {
    if (!this.window) return;

    const app = new Hono();
    app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
    app.all('/mcp', async (ctx) => {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: allowedHosts(config.port),
      });
      const server = createMcpServer(this.window!, () => this.songInfo);

      await server.connect(transport);
      return transport.handleRequest(ctx.req.raw);
    });

    this.server = serve({
      fetch: app.fetch,
      hostname: LOCAL_HOST,
      port: config.port,
    });
    this.server.once('error', (error) => {
      console.error(LoggerPrefix, 'MCP server failed to start:', error);
    });
    console.log(
      LoggerPrefix,
      `MCP server listening at http://${LOCAL_HOST}:${config.port}/mcp`,
    );
  },
  end() {
    this.server?.close();
    this.server = undefined;
  },
});
