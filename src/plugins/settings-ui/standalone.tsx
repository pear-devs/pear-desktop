import { render } from 'solid-js/web';

import { loadI18n, setLanguage } from '@/i18n';

import { SettingsModal } from './components/SettingsModal';
import { listenStorePush, refreshStore, setIpc } from './state';
import style from './styles.css?inline';

export const bootStandaloneSettings = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get('options.language') ?? 'en');

  // The plugin's stylesheet is normally injected by the plugin loader, which does
  // not run in standalone mode — inject it here.
  const styleEl = document.createElement('style');
  styleEl.textContent = style;
  document.head.appendChild(styleEl);

  // Ipc shim of the shape `state.ts` expects, mirroring loader/renderer.ts.
  setIpc({
    send: (event: string, ...args: unknown[]) => {
      window.ipcRenderer.send(event, ...args);
    },
    invoke: (event: string, ...args: unknown[]) =>
      window.ipcRenderer.invoke(event, ...args),
    on: (event: string, listener: CallableFunction) => {
      window.ipcRenderer.on(event, (_, ...args: unknown[]) => {
        // oxlint-disable-next-line typescript/no-unsafe-call
        listener(...args);
      });
    },
    removeAllListeners: (event: string) => {
      window.ipcRenderer.removeAllListeners(event);
    },
  });

  await refreshStore();
  listenStorePush();

  const host = document.createElement('div');
  host.id = 'ytmd-sui-standalone-root';
  document.body.appendChild(host);

  render(
    () => <SettingsModal onClose={() => window.close()} standalone />,
    host,
  );
};
