import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { SettingsButton } from './components/SettingsButton';
import { SettingsModal } from './components/SettingsModal';
import { listenStorePush, refreshStore, setIpc } from './state';

const [open, setOpen] = createSignal(false);

const GUIDE_SELECTORS = ['#guide-renderer', '#mini-guide-renderer'];
const ITEMS_SELECTOR = 'ytmusic-guide-section-renderer[is-primary] > #items';

const buttonCleanup: Record<string, () => void> = {};
let modalDispose: (() => void) | undefined;

const injectButton = (guide: HTMLElement) => {
  const items = guide.querySelector(ITEMS_SELECTOR);
  if (!items) return;

  buttonCleanup[guide.id]?.();

  const host = document.createElement('div');
  host.classList.add('ytmd-sui-entry-host');
  host.classList.add(guide.id.startsWith('mini-') ? 'mini' : 'normal');
  items.appendChild(host);

  const dispose = render(
    () => <SettingsButton onClick={() => setOpen(true)} />,
    host,
  );
  buttonCleanup[guide.id] = () => {
    dispose();
    host.remove();
  };
};

const mountModal = () => {
  if (modalDispose) return;
  const host = document.createElement('div');
  host.id = 'ytmd-sui-root';
  document.body.appendChild(host);
  modalDispose = render(
    () => (
      <Show when={open()}>
        <SettingsModal onClose={() => setOpen(false)} />
      </Show>
    ),
    host,
  );
};

export const renderer = createRenderer({
  async start(ctx) {
    setIpc(ctx.ipc);
    await refreshStore();
    listenStorePush();

    mountModal();

    for (const selector of GUIDE_SELECTORS) {
      waitForElement<HTMLElement>(selector).then(injectButton);
    }
  },

  stop() {
    for (const dispose of Object.values(buttonCleanup)) dispose();
    modalDispose?.();
    modalDispose = undefined;
    setOpen(false);
  },
});

const hot = (
  import.meta as ImportMeta & {
    hot?: { dispose: (cb: () => void) => void };
  }
).hot;
if (hot) {
  hot.dispose(() => {
    for (const dispose of Object.values(buttonCleanup)) dispose();
    modalDispose?.();
    modalDispose = undefined;
  });
}
