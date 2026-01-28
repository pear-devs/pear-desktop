import { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { serve, type ServerType } from '@hono/node-server';

import { createBackend } from '@/utils';
import { type AudioStreamConfig } from './config';
import { BroadcastStream } from './BroadcastStream';

const META_INT = 16_000;

let config: AudioStreamConfig;
const broadcast = new BroadcastStream();

export const backend = createBackend<
  {
    app: Hono;
    server?: ServerType;
  },
  AudioStreamConfig
>({
  app: new Hono().get('/stream', (ctx) => {
    const icyMetadata = ctx.req.header('Icy-Metadata');
    if (icyMetadata === '1') {
      ctx.header('icy-metaint', META_INT.toString(10));
      ctx.header('icy-name', 'Pear Desktop');
      ctx.header('icy-url', 'https://github.com/pear-devs/pear-desktop');
      ctx.header(
        'icy-audio-info',
        `ice-channels=2;ice-samplerate=${config.sampleRate.toString(
          10,
        )};ice-bitrate=128`,
      );
      ctx.header('icy-pub', '1');
      ctx.header('icy-sr', config.sampleRate.toString(10));
      ctx.header('Content-Type', 'audio/L16');
      ctx.header('Server', 'Pear Desktop');
    }

    return streamText(ctx, async (stream) => {
      let readable = broadcast.subscribe();
      if (icyMetadata === '1') {
        let bytesUntilMetadata = META_INT;

        readable = readable.pipeThrough(
          new TransformStream({
            transform(
              chunk: Uint8Array,
              controller: TransformStreamDefaultController<Uint8Array>,
            ) {
              console.log({ bytesUntilMetadata });
              let offset = 0;

              while (offset < chunk.byteLength) {
                if (bytesUntilMetadata === 0) {
                  const encoder = new TextEncoder();

                  // TODO: add real metadata
                  const metaBuffer = encoder.encode(
                    ".StreamTitle='My Cool Stream Title';",
                  );

                  const padding = (16 - (metaBuffer.byteLength % 16)) % 16;
                  const metaLength = metaBuffer.byteLength + padding;
                  const lengthByte = metaLength / 16;

                  controller.enqueue(Uint8Array.from([lengthByte]));

                  if (metaLength > 0) {
                    controller.enqueue(Uint8Array.from(metaBuffer));
                  }

                  bytesUntilMetadata = META_INT;
                }

                const chunkRemaining = chunk.byteLength - offset;
                const canSend = Math.min(chunkRemaining, bytesUntilMetadata);
                controller.enqueue(chunk.subarray(offset, offset + canSend));

                bytesUntilMetadata -= canSend;
                offset += canSend;
              }
            },
          }),
        );
      }

      return await stream.pipe(readable);
    });
  }),

  async start({ getConfig, ipc }) {
    config = await getConfig();

    this.server = serve(
      {
        fetch: this.app.fetch.bind(this.app),
        hostname: config.hostname,
        port: config.port,
      },
      ({ address, port }) => console.log('Listening on', { address, port }),
    );

    ipc.on('audio-stream:pcm-binary', (chunk: Uint8Array) => {
      broadcast.write(chunk);
    });
  },
  async stop() {
    let resolve;

    const promise = new Promise((r) => (resolve = r));
    this.server?.close(resolve);

    await promise;
  },
  onConfigChange(newConfig) {
    config = newConfig;
  },
});
