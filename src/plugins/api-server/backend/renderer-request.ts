import type { IpcMain } from 'electron';

type IpcLike = Pick<IpcMain, 'once' | 'removeListener'>;

// Asks the renderer for a value over IPC. The renderer only answers once the
// player api has loaded, and not while the page reloads, so give up after
// `timeoutMs` and resolve undefined instead of leaving the request hanging.
export const requestFromRenderer = <T>(
  ipc: IpcLike,
  send: () => void,
  responseChannel: string,
  timeoutMs: number,
): Promise<T | undefined> =>
  new Promise((resolve) => {
    const onResponse = (_: unknown, value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      ipc.removeListener(responseChannel, onResponse);
      resolve(undefined);
    }, timeoutMs);

    ipc.once(responseChannel, onResponse);
    send();
  });
