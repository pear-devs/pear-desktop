import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
/** Authenticated localhost PCM diagnostic; never exposes the player's account. */
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';

export async function startAudioServer(
  profile: string,
  setGain: (gain: number) => void,
) {
  const token = randomBytes(32).toString('hex');
  const path = join(profile, 'independent-audio.json');
  const sockets = new Set<Socket>();
  let active: Socket | undefined;
  let lastControl = 0;
  let stopped = false;
  const server = createServer((socket) => {
    if (sockets.size >= 4) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let pending = '';
    let authenticated = false;
    socket.setNoDelay(true);
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      if (active === socket) {
        active = undefined;
        setGain(1);
      }
    });
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      if (pending.length > 4096) {
        socket.destroy();
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const parsed: unknown = JSON.parse(line);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            socket.destroy();
            return;
          }
          const message = parsed as Record<string, unknown>;
          if (!authenticated) {
            const supplied = Buffer.from(
              typeof message.token === 'string' ? message.token : '',
            );
            const expected = Buffer.from(token);
            if (
              active ||
              supplied.length !== expected.length ||
              !timingSafeEqual(supplied, expected)
            ) {
              socket.destroy();
              return;
            }
            authenticated = true;
            active = socket;
            lastControl = Date.now();
            socket.write(
              JSON.stringify({
                protocol: 1,
                rate: 48000,
                channels: 2,
                frame_bytes: 3840,
              }) + '\n',
            );
          } else {
            if (
              typeof message.gain !== 'number' ||
              !Number.isFinite(message.gain) ||
              message.gain < 0 ||
              message.gain > 1
            ) {
              socket.destroy();
              return;
            }
            lastControl = Date.now();
            setGain(message.gain);
          }
        } catch {
          socket.destroy();
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No audio server address.');
  try {
    await mkdir(profile, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        protocol: 1,
        host: '127.0.0.1',
        port: address.port,
        token,
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    server.close();
    throw error;
  }
  const watchdog = setInterval(() => {
    if (active && Date.now() - lastControl > 1500) {
      setGain(1);
      active.destroy();
    }
  }, 100);
  return {
    publish(frame: ArrayBuffer) {
      if (!(frame instanceof ArrayBuffer) || frame.byteLength !== 3840) return;
      if (!active || active.destroyed || active.writableLength > 3840 * 8)
        return;
      const header = Buffer.alloc(4);
      header.writeUInt32LE(frame.byteLength);
      active.write(Buffer.concat([header, Buffer.from(frame)]));
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(watchdog);
      setGain(1);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(path).catch(() => {});
    },
  };
}
