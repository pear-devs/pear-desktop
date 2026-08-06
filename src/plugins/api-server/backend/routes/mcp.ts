import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getSongControls } from '@/providers/song-controls';

import type { APIServerConfig } from '../../config';
import type { HonoApp } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';

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

const createMcpServer = (
  controls: ReturnType<typeof getSongControls>,
  songInfoGetter: () => SongInfo | undefined,
) => {
  const server = new McpServer({
    name: '\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063',
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
      const songInfo = songInfoGetter();
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
    {
      description: 'Remove every song from the YouTube Music playback queue.',
    },
    () => {
      controls.clearQueue();
      return textResult('Playback queue cleared.');
    },
  );

  return server;
};

export const register = (
  app: HonoApp,
  backendCtx: BackendContext<APIServerConfig>,
  songInfoGetter: () => SongInfo | undefined,
) => {
  const controls = getSongControls(backendCtx.window);
  const server = createMcpServer(controls, songInfoGetter);
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  app.all('/api/mcp', async (ctx) => {
    const config = await backendCtx.getConfig();
    if (!config.mcpEnabled) return ctx.notFound();

    if (!server.isConnected()) await server.connect(transport);
    return transport.handleRequest(ctx);
  });
};
