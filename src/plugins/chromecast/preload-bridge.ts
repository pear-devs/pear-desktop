import { contextBridge, ipcRenderer, webFrame } from 'electron';

import pageApiSource from './page-api.js?raw';

import type { CastSessionEvent, CastSessionSnapshot } from './session-types';

const CAST_SELECT = 'peard:cast:select';
const CAST_RESUME = 'peard:cast:resume';
const CAST_CONFIRM_STOP = 'peard:cast:confirm-stop';
const CAST_SESSION = 'peard:cast:session';
const CAST_EVENT = 'peard:cast:event';

export function setupCastBridge(): void {
  const listeners = new Set<(event: CastSessionEvent) => void>();
  let appId = '';

  ipcRenderer.on(CAST_EVENT, (_event, event: CastSessionEvent) => {
    for (const listener of listeners) listener(event);
  });

  const sessionOp = (payload: object) =>
    ipcRenderer.invoke(
      CAST_SESSION,
      payload,
    ) as Promise<CastSessionSnapshot | void>;

  contextBridge.exposeInMainWorld('__ytmdCastBridge', {
    initialize: (options: { appId?: string }) => {
      appId = typeof options?.appId === 'string' ? options.appId : appId;
      return Promise.resolve();
    },
    requestSession: async (): Promise<CastSessionSnapshot | null> => {
      const selection = (await ipcRenderer.invoke(CAST_SELECT)) as {
        id: string | null;
      };
      if (!selection.id) return null;
      const snapshot = await sessionOp({
        op: 'connect',
        receiverId: selection.id,
        appId: appId || 'CC1AD845',
      });
      return (snapshot as CastSessionSnapshot | undefined) ?? null;
    },
    resumeSession: () =>
      ipcRenderer.invoke(CAST_RESUME) as Promise<{
        snapshot: CastSessionSnapshot | null;
        fallbackUrl: string | null;
      }>,
    sendMessage: async (handle: string, namespace: string, data: string) => {
      await sessionOp({ op: 'send', handle, namespace, data });
    },
    setVolume: async (handle: string, level: number) => {
      await sessionOp({ op: 'volume', handle, level });
    },
    setMuted: async (handle: string, muted: boolean) => {
      await sessionOp({ op: 'mute', handle, muted });
    },
    stop: async (handle: string) => {
      await sessionOp({ op: 'stop', handle });
    },
    leave: async (handle: string) => {
      await sessionOp({ op: 'leave', handle });
    },
    confirmStop: (handle: string): Promise<boolean> =>
      ipcRenderer.invoke(CAST_CONFIRM_STOP, handle) as Promise<boolean>,
    loadMedia: async (handle: string, request: unknown) => {
      await sessionOp({ op: 'load', handle, request });
    },
    queueLoad: async (handle: string, request: unknown) => {
      await sessionOp({ op: 'queue-load', handle, request });
    },
    onEvent: (listener: (event: CastSessionEvent) => void) => {
      listeners.add(listener);
    },
  });

  // Run in page world, before YouTube Music initializes its Cast API.
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: pageApiSource }]);
}
