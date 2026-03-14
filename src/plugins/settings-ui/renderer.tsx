/// <reference types="vite/client" />

import { createSignal, Match, Switch } from 'solid-js';
import { Portal, render } from 'solid-js/web';

import { IconSettings } from '@mdui/icons/settings.js';
import { IconColorLens } from '@mdui/icons/color-lens.js';
import { IconExtension } from '@mdui/icons/extension.js';
import { IconDashboard } from '@mdui/icons/dashboard.js';
import { IconInfo } from '@mdui/icons/info.js';
import { IconClose } from '@mdui/icons/close.js';

import { t } from '@/i18n';

import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';
import { type DefaultConfig } from '@/config/defaults';
import { type Paths, type PathValue } from '@/config';
import { LitElementWrapper } from '@/solit';
import { General } from './components/sections/General';

const SettingsButton = () => {
  let dialog!: HTMLDialogElement;
  const [settingsCategory, setSettingsCategory] = createSignal('general');

  return (
    <div
      class="ytmd-settings-ui-btn-content"
      on:click={() => {
        dialog.open = true;
      }}
    >
      <Portal>
        <mdui-dialog
          class="pear-settings-dialog"
          close-on-esc
          close-on-overlay-click
          ref={dialog}
        >
          <mdui-layout
            style={{
              'height': '100%',
              'min-width': '500px',
            }}
          >
            <mdui-top-app-bar>
              <mdui-top-app-bar-title>Pear Settings</mdui-top-app-bar-title>
              <mdui-button-icon onClick={() => (dialog.open = false)}>
                <LitElementWrapper elementClass={IconClose} />
              </mdui-button-icon>
            </mdui-top-app-bar>

            <mdui-navigation-rail
              on:change={({ target }) => {
                setSettingsCategory((target as HTMLInputElement).value);
              }}
              style={{ position: 'relative' }}
              value="general"
            >
              <mdui-navigation-rail-item value="general">
                General
                <LitElementWrapper
                  elementClass={IconSettings}
                  props={{ slot: 'icon' }}
                />
              </mdui-navigation-rail-item>
              <mdui-navigation-rail-item value="appearance">
                Appearance
                <LitElementWrapper
                  elementClass={IconColorLens}
                  props={{ slot: 'icon' }}
                />
              </mdui-navigation-rail-item>
              <mdui-navigation-rail-item value="plugins">
                Plugins
                <LitElementWrapper
                  elementClass={IconExtension}
                  props={{ slot: 'icon' }}
                />
              </mdui-navigation-rail-item>
              <mdui-navigation-rail-item value="advanced">
                Advanced
                <LitElementWrapper
                  elementClass={IconDashboard}
                  props={{ slot: 'icon' }}
                />
              </mdui-navigation-rail-item>
              <mdui-navigation-rail-item value="about">
                About
                <LitElementWrapper
                  elementClass={IconInfo}
                  props={{ slot: 'icon' }}
                />
              </mdui-navigation-rail-item>
            </mdui-navigation-rail>

            <mdui-layout-main
              style={{
                'overflow-y': 'scroll',
                'height': '100%',
                'width': '100%',
                'display': 'flex',
                'flex-direction': 'column',
                'gap': '24px',
              }}
            >
              <Switch>
                <Match when={settingsCategory() === 'general'}>
                  <General />
                </Match>
                <Match when={settingsCategory() === 'appearance'}>
                  <></>
                </Match>
                <Match when={settingsCategory() === 'plugins'}>
                  <></>
                </Match>
                <Match when={settingsCategory() === 'advanced'}>
                  <></>
                </Match>
                <Match when={settingsCategory() === 'info'}>
                  <></>
                </Match>
              </Switch>
            </mdui-layout-main>

            <mdui-layout-item
              placement="right"
              style={{ 'width': '1rem', 'z-index': '-5' }}
            />
          </mdui-layout>
        </mdui-dialog>
      </Portal>

      <yt-icon icon="yt-icons:settings" tabindex="0" />
      <div class="title-column style-scope ytmusic-guide-entry-renderer">
        <div class="title-group style-scope ytmusic-guide-entry-renderer">
          <yt-formatted-string
            class="title style-scope ytmusic-guide-entry-renderer"
            text={{ runs: [{ text: t('plugins.settings-ui.button') }] }}
          />
        </div>
      </div>
    </div>
  );
};

const cleanup: Record<string, () => void> = {};
const dispose = () => {
  for (const key in cleanup) {
    cleanup[key]();
    waitForElement<HTMLElement>(`#${key}`).then(injectButton);
  }
};

// prettier-ignore
const injectButton = (guide: HTMLElement) => {
  const items = guide.querySelector(
    'ytmusic-guide-section-renderer[is-primary] > #items',
  );
  if (!items) return;

  // dispose of the previous button
  cleanup[guide.id]?.();

  const entry = document.createElement('div');
  {
    const isMini = guide.id.startsWith('mini-');

    entry.classList.add('ytmd-settings-ui-btn');
    entry.classList.add(isMini ? 'mini' : 'normal');

    items.appendChild(entry);
  }

  const dispose = render(SettingsButton, entry);
  cleanup[guide.id] = () => {
    dispose();
    entry.remove();
  };
};

export let getAppVersion = () => Promise.resolve('');
export let getPlatform = () => Promise.resolve('');
export let getVersions = () => Promise.resolve({});

// stubs
export const plugins = {
  enable: (_id: string) => {},
  disable: (_id: string) => {},
};

const [_config, setConfig] = createSignal<DefaultConfig>({} as DefaultConfig);

// prettier-ignore
export const Config = {
  signal: _config,
  get: <Key extends Paths<DefaultConfig>>(_key: Key) => undefined as unknown as Promise<PathValue<DefaultConfig, typeof _key>>,
  set: <Key extends Paths<DefaultConfig>>(_key: Key, _value: PathValue<DefaultConfig, typeof _key>) => Promise.resolve(),
};

export const renderer = createRenderer({
  start(ctx) {
    // ctx.ipc.invoke('ytmd-sui:load-settings').then(setConfig);

    // TODO: Find a better way to do this
    setInterval(() => {
      ctx.ipc.invoke('ytmd-sui:load-settings').then(setConfig);
    }, 500);

    getAppVersion = () => ctx.ipc.invoke('ytmd-sui:app-version');
    getPlatform = () => ctx.ipc.invoke('ytmd-sui:platform');
    getVersions = () => ctx.ipc.invoke('ytmd-sui:versions');

    // prettier-ignore
    {
      Config.get = (key: string) => ctx.ipc.invoke('ytmd-sui:config-get', key);
      Config.set = (key: string, value: unknown) => ctx.ipc.invoke('ytmd-sui:config-set', key, value);
    }

    // prettier-ignore
    {
      plugins.enable = (id: string) => ctx.ipc.invoke('ytmd-sui:plugins-enable', id);
      plugins.disable = (id: string) => ctx.ipc.invoke('ytmd-sui:plugins-disable', id);
    }

    waitForElement<HTMLElement>('#guide-renderer').then(injectButton);
    waitForElement<HTMLElement>('#mini-guide-renderer').then(injectButton);
  },
  stop() {
    for (const key in cleanup) {
      cleanup[key]?.();
      delete cleanup[key];
    }
  },
});

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
}
