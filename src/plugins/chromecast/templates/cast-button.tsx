import { For, Show } from 'solid-js';

import { t } from '@/i18n';

import type { CastDevice } from '../types';

export interface CastButtonProps {
  casting: boolean;
  open: boolean;
  devices: CastDevice[];
  activeId: string | null;
  onToggle: (event: MouseEvent) => void;
  onPick: (id: string) => void;
}

/**
 * A native-looking Cast button for the YTM player bar plus a dropdown device
 * picker. Mirrors the markup/classes used by `captions-selector` so it sits
 * naturally next to YTM's own controls.
 */
export const CastButton = (props: CastButtonProps) => (
  <div
    class="chromecast-button-container"
    classList={{ casting: props.casting }}
  >
    <button
      aria-controls="chromecast-popup"
      aria-expanded={props.open}
      aria-haspopup="menu"
      aria-label={t('plugins.chromecast.name')}
      class="chromecast-button style-scope ytmusic-player-bar"
      on:click={(event) => props.onToggle(event)}
      title={t('plugins.chromecast.name')}
    >
      <svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24">
        <Show
          fallback={
            <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
          }
          when={props.casting}
        >
          <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm18.5-9h-15c-.55 0-1 .45-1 1v1.5h17V6c0-.55-.45-1-1-1zM21 7.5H3V9h.5c4.97 0 9 4.03 9 9H21c.55 0 1-.45 1-1V8.5c0-.55-.45-1-1-1z" />
        </Show>
      </svg>
    </button>

    <Show when={props.open}>
      <div class="chromecast-popup" id="chromecast-popup" role="menu">
        <div class="chromecast-popup-header">
          {t('plugins.chromecast.menu.devices')}
        </div>
        <Show
          fallback={
            <div class="chromecast-empty">
              {t('plugins.chromecast.menu.no-devices')}
            </div>
          }
          when={props.devices.length > 0}
        >
          <For each={props.devices}>
            {(device) => (
              <button
                class="chromecast-device"
                classList={{ active: device.id === props.activeId }}
                on:click={() => props.onPick(device.id)}
                role="menuitem"
              >
                <span class="chromecast-device-name">{device.name}</span>
                <Show when={device.model}>
                  <span class="chromecast-device-model">{device.model}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Show>
  </div>
);
