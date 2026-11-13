import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { APPLICATION_NAME } from '@/i18n';
import { createRenderer } from '@/utils';

import { IpcContext } from './renderer/ipc';
import { TitleBar } from './renderer/TitleBar';

import type { InAppMenuIpc, inAppMenuConfig } from './types';

const scrollStyle = `
  html::-webkit-scrollbar {
    background-color: red;
  }
`;

const isMacOS = navigator.userAgent.includes('Macintosh');
const isNotWindowsOrMacOS =
  !navigator.userAgent.includes('Windows') && !isMacOS;

export default createRenderer<typeof inAppMenuConfig, InAppMenuIpc>((ctx) => {
  const [config, setConfig] = createSignal(ctx.config);
  ctx.onConfigChange((newConfig) => setConfig(newConfig));

  const previousTitle = document.title;
  document.title = APPLICATION_NAME;
  ctx.onCleanup(() => {
    if (document.title === APPLICATION_NAME) document.title = previousTitle;
  });

  ctx.addStyle(scrollStyle);

  // The title bar must stay a direct child of <body> (its CSS selects it as
  // a sibling of ytmusic-app), so it is rendered elsewhere and moved there.
  const container = document.createElement('div');
  const dispose = render(
    () => (
      <IpcContext.Provider value={ctx.ipc}>
        <TitleBar
          enableController={
            isNotWindowsOrMacOS && !config().hideDOMWindowControls
          }
          initialCollapsed={window.mainConfig.get('options.hideMenu')}
          isMacOS={isMacOS}
        />
      </IpcContext.Provider>
    ),
    container,
  );
  const nodes = [...container.childNodes];
  document.body.append(...nodes);
  ctx.onCleanup(() => {
    dispose();
    for (const node of nodes) node.remove();
  });
});
