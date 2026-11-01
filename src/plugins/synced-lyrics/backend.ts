import { net } from 'electron';

import { createBackend } from '@/utils';

import { ElectronLyricsRequests } from './search/electron-requests';

const requests = new ElectronLyricsRequests((url, init) =>
  net.fetch(url, init),
);

export const backend = createBackend({
  start(ctx) {
    // Privileged transport retained only for providers requiring forbidden headers.
    ctx.ipc.handle(
      'synced-lyrics:fetch',
      (id: string, url: string, init: RequestInit) =>
        requests.fetch(id, url, init),
    );
    ctx.ipc.handle('synced-lyrics:cancel', (id: string) => {
      requests.cancel(id);
    });
  },
  stop(ctx) {
    requests.dispose();
    ctx.ipc.removeHandler('synced-lyrics:fetch');
    ctx.ipc.removeHandler('synced-lyrics:cancel');
  },
});
