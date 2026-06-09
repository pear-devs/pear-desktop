import { getCastController } from './controller';

import type { BackendContext } from '@/types/contexts';
import type { ChromecastPluginConfig } from '../types';

// NOTE: exported as plain functions (no top-level `createBackend(...)` call) so
// this module stays side-effect-free. That lets the renderer build drop the
// unused import, keeping the electron-importing backend chain out of the
// renderer bundle (otherwise the renderer crashes on `import ... from 'electron'`).

export const onBackendStart = async ({
  getConfig,
  setConfig,
  ipc,
}: BackendContext<ChromecastPluginConfig>) => {
  const config = await getConfig();
  const castController = getCastController();

  // IPC surface for the renderer cast button / device picker.
  ipc.handle('chromecast:get-devices', () => castController.listDevices());
  ipc.handle('chromecast:get-active', () => castController.activeDeviceId);
  ipc.handle('chromecast:connect', (id: string) =>
    castController.connectTo(id),
  );
  ipc.handle('chromecast:disconnect', () => castController.disconnect());
  ipc.handle('chromecast:refresh', () => castController.refreshDevices());

  // The YTM volume slider drives the speaker volume while casting. Modelled as
  // `handle` (not `on`) so it can be removed on stop — the framework's `ipc.on`
  // wraps the listener anonymously and exposes no way to unsubscribe.
  ipc.handle('chromecast:set-volume', (level: number) =>
    castController.setDeviceVolume(level),
  );

  // The renderer tells us when an ad is on the local player so we can suppress
  // mirroring (belt-and-suspenders alongside the adblocker plugin).
  ipc.handle('chromecast:ad-state', (showing: boolean) =>
    castController.setAdShowing(showing),
  );

  // Push live updates so the button stays in sync.
  castController.onDevices((devices) =>
    ipc.send('chromecast:devices-changed', devices),
  );
  castController.onState((activeId) =>
    ipc.send('chromecast:state-changed', activeId),
  );
  // One-shot request to align the local (muted) player to the speaker's clock.
  castController.onSyncLocalTime((seconds) =>
    ipc.send('chromecast:sync-local-time', seconds),
  );
  // External play/pause made on the speaker (e.g. the Google Home phone app).
  castController.onRemotePlaybackChange((action) =>
    ipc.send('chromecast:remote-playback', action),
  );

  await castController.start(config, (partial) => {
    Promise.resolve(setConfig(partial)).catch(console.error);
  });
};

export const onBackendStop = ({
  ipc,
}: BackendContext<ChromecastPluginConfig>) => {
  // Remove the invoke handlers so re-enabling the plugin in the same session
  // doesn't throw on duplicate `ipcMain.handle` registration.
  for (const channel of [
    'chromecast:get-devices',
    'chromecast:get-active',
    'chromecast:connect',
    'chromecast:disconnect',
    'chromecast:refresh',
    'chromecast:set-volume',
    'chromecast:ad-state',
  ]) {
    ipc.removeHandler(channel);
  }
  getCastController().stop();
};

export const onBackendConfigChange = (newConfig: ChromecastPluginConfig) => {
  getCastController().updateConfig(newConfig);
};
