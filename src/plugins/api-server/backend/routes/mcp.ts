import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ipcMain } from 'electron';
import { z } from 'zod';

import { getSongControls } from '@/providers/song-controls';

import { getQueueItemRenderer, getSelectedQueueIndex } from './queue';

import type { APIServerConfig } from '../../config';
import type { HonoApp } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';
import type { QueueResponse } from '@/types/music-player-desktop-internal';

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

const errorResult = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  isError: true,
});

const getQueue = (controls: ReturnType<typeof getSongControls>) =>
  new Promise<QueueResponse>((resolve, reject) => {
    const event = 'peard:get-queue-response';
    let timeout: NodeJS.Timeout;
    const listener = (_: Electron.IpcMainEvent, queue: QueueResponse) => {
      clearTimeout(timeout);
      resolve(queue);
    };
    timeout = setTimeout(() => {
      ipcMain.removeListener(event, listener);
      reject(new Error('The playback queue did not respond in time.'));
    }, 5_000);

    ipcMain.once(event, listener);
    controls.requestQueueInformation();
  });

const getPreviousQueueIndex = async (
  controls: ReturnType<typeof getSongControls>,
) => {
  const currentIndex = getSelectedQueueIndex(await getQueue(controls));

  if (currentIndex <= 0) {
    throw new Error('There is no previous track in the playback queue.');
  }

  return currentIndex - 1;
};

const getQueueItems = (queue: QueueResponse) =>
  queue.items?.map((item, index) => {
    const renderer = getQueueItemRenderer(item);

    return {
      index,
      selected: renderer?.selected ?? false,
      videoId: renderer?.videoId,
      title: renderer?.title.runs.map((run) => run.text).join(''),
      artist: renderer?.shortBylineText.runs.map((run) => run.text).join(''),
      duration: renderer?.lengthText.runs.map((run) => run.text).join(''),
    };
  }) ?? [];

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
    { description: 'Play the previous song in the playback queue.' },
    async () => {
      try {
        controls.setQueueIndex(await getPreviousQueueIndex(controls));
        return textResult('Playing the previous song.');
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : 'Unable to select the previous song.',
        );
      }
    },
  );

  server.registerTool(
    'music_next',
    { description: 'Play the next song in the playback queue.' },
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
      description: 'Immediately play a video ID.',
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
    'music_toggle_shuffle',
    { description: 'Toggle shuffle playback for the current queue.' },
    () => {
      controls.shuffle();
      return textResult('Shuffle mode toggled.');
    },
  );

  server.registerTool(
    'music_switch_repeat',
    {
      description:
        'Advance the repeat mode. Use one iteration for the next mode or two to skip a mode.',
      inputSchema: {
        iterations: z.number().int().min(1).max(2).default(1),
      },
    },
    ({ iterations }) => {
      controls.switchRepeat(iterations);
      return textResult('Repeat mode changed.');
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
        'Search music. The result includes video IDs for music_enqueue.',
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
        return errorResult(
          error instanceof Error ? error.message : 'Music search failed.',
        );
      }
    },
  );

  server.registerTool(
    'music_enqueue',
    {
      description: 'Add a video ID to the playback queue.',
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
    'music_get_queue',
    {
      description:
        'Get the playback queue. Each item includes a zero-based index for music_remove_from_queue.',
    },
    async () => {
      try {
        return jsonResult({ items: getQueueItems(await getQueue(controls)) });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : 'Unable to retrieve the playback queue.',
        );
      }
    },
  );

  server.registerTool(
    'music_remove_from_queue',
    {
      description:
        'Remove an item from the playback queue by its zero-based index. Use music_get_queue first to find the index.',
      inputSchema: {
        index: z.number().int().nonnegative(),
      },
    },
    ({ index }) => {
      controls.removeSongFromQueue(index);
      return textResult('Removed queue item at index ' + index + '.');
    },
  );

  server.registerTool(
    'music_clear_queue',
    {
      description: 'Remove every song from the playback queue.',
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
