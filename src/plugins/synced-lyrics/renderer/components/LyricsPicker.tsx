/* eslint-disable stylistic/no-mixed-operators */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Switch,
} from 'solid-js';

import * as z from 'zod';

import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { IconCheckCircle } from '@mdui/icons/check-circle.js';
import { IconWarning } from '@mdui/icons/warning.js';
import { IconError } from '@mdui/icons/error.js';
import { IconStar } from '@mdui/icons/star.js';
import { IconStarBorder } from '@mdui/icons/star-border.js';

import { LitElementWrapper } from '@/solit';

import {
  type ProviderName,
  ProviderNames,
  providerNames,
  ProviderNameSchema,
  type ProviderState,
} from '@/plugins/lyrics-provider/providers';
import { _ytAPI } from '../index';
import { config } from '../renderer';

import type { PlayerAPIEvents } from '@/types/player-api-events';
import { getLyricsProvider } from '@/plugins/lyrics-provider/renderer/utils';

const LocalStorageSchema = z.object({
  provider: ProviderNameSchema,
});

const shouldSwitchProvider = (providerData: ProviderState) => {
  if (providerData.state === 'error') return true;
  if (providerData.state === 'fetching') return true;
  return (
    providerData.state === 'done' &&
    !providerData.data?.lines &&
    !providerData.data?.lyrics
  );
};

const providerBias = (p: ProviderName) =>
  (getLyricsProvider().lyricsStore.lyrics[p].state === 'done' ? 1 : -1) +
  (getLyricsProvider().lyricsStore.lyrics[p].data?.lines?.length ? 2 : -1) +
  // eslint-disable-next-line prettier/prettier
  (getLyricsProvider().lyricsStore.lyrics[p].data?.lines?.length && p === ProviderNames.YTMusic
    ? 1
    : 0) +
  (getLyricsProvider().lyricsStore.lyrics[p].data?.lyrics ? 1 : -1);

const pickBestProvider = () => {
  const preferred = config()?.preferredProvider;
  if (preferred) {
    const data = getLyricsProvider().lyricsStore.lyrics[preferred].data;
    if (Array.isArray(data?.lines) || data?.lyrics) {
      return { provider: preferred, force: true };
    }
  }

  const providers = Array.from(providerNames);
  providers.sort((a, b) => providerBias(b) - providerBias(a));

  return { provider: providers[0], force: false };
};

export const LyricsPicker = (props: {
  setStickRef: Setter<HTMLElement | null>;
}) => {
  const [videoId, setVideoId] = createSignal<string | null>(null);
  const [starredProvider, setStarredProvider] =
    createSignal<ProviderName | null>(null);
  const [hasManuallySwitchedProvider, setHasManuallySwitchedProvider] =
    createSignal(false);

  const providerIdx = createMemo(() => {
    const store = getLyricsProvider().lyricsStore;
    return providerNames.indexOf(store.provider);
  });

  createEffect(() => {
    const id = videoId();
    if (id === null) {
      setStarredProvider(null);
      return;
    }

    const key = `ytmd-sl-starred-${id}`;
    const value = localStorage.getItem(key);
    if (!value) {
      setStarredProvider(null);
      return;
    }

    const parseResult = LocalStorageSchema.safeParse(JSON.parse(value));
    if (parseResult.success) {
      setStarredProvider(parseResult.data.provider);
    } else {
      setStarredProvider(null);
    }
  });

  const toggleStar = () => {
    const id = videoId();
    if (id === null) return;

    const key = `ytmd-sl-starred-${id}`;

    setStarredProvider((currentStarred) => {
      const currentProvider = getLyricsProvider().lyricsStore.provider;
      if (currentProvider === currentStarred) {
        localStorage.removeItem(key);
        return null;
      }

      localStorage.setItem(key, JSON.stringify({ provider: currentProvider }));
      return currentProvider;
    });
  };

  const videoDataChangeHandler = (
    name: string,
    { videoId }: PlayerAPIEvents['videodatachange']['value'],
  ) => {
    setVideoId(videoId);

    if (name !== 'dataloaded') return;
    setHasManuallySwitchedProvider(false);
  };

  onMount(() => _ytAPI?.addEventListener('videodatachange', videoDataChangeHandler));
  onCleanup(() => _ytAPI?.removeEventListener('videodatachange', videoDataChangeHandler));

  createEffect(() => {
    if (!hasManuallySwitchedProvider()) {
      const starred = starredProvider();
      if (starred !== null) {
        getLyricsProvider().setLyricsStore('provider', starred);
        return;
      }

      const allProvidersFailed = providerNames.every((p) =>
        shouldSwitchProvider(getLyricsProvider().lyricsStore.lyrics[p]),
      );
      if (allProvidersFailed) return;

      const { provider, force } = pickBestProvider();
      if (
        force ||
        providerBias(getLyricsProvider().lyricsStore.provider) < providerBias(provider)
      ) {
        getLyricsProvider().setLyricsStore('provider', provider);
      }
    }
  });

  const next = () => {
    setHasManuallySwitchedProvider(true);
    getLyricsProvider().setLyricsStore('provider', (prevProvider: ProviderName) => {
      const idx = providerNames.indexOf(prevProvider);
      return providerNames[(idx + 1) % providerNames.length];
    });
  };

  const previous = () => {
    setHasManuallySwitchedProvider(true);
    getLyricsProvider().setLyricsStore('provider', (prevProvider: ProviderName) => {
      const idx = providerNames.indexOf(prevProvider);
      return providerNames[
        (idx + providerNames.length - 1) % providerNames.length
      ];
    });
  };

  const selectProvider = (provider: ProviderName) => {
    setHasManuallySwitchedProvider(true);
    getLyricsProvider().setLyricsStore('provider', provider);
  };

  return (
    <div class="lyrics-picker" ref={props.setStickRef}>
      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronLeft}
            props={{
              onClick: previous,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>

      <div class="lyrics-picker-content">
        <div class="lyrics-picker-content-label">
          <div
            class="lyrics-picker-item"
            style={{ display: 'flex', "align-content": 'center' }}
            tabindex="-1"
          >
            <Switch>
              <Match
                when={
                  getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].state === 'fetching'
                }
              >
                <tp-yt-paper-spinner-lite
                  active
                  class="loading-indicator style-scope"
                  style={{ padding: '5px', transform: 'scale(0.5)' }}
                  tabindex="-1"
                />
              </Match>
              <Match when={getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].state === 'error'}>
                <LitElementWrapper
                  elementClass={IconError}
                  props={{ style: { padding: '5px', scale: '0.8' } }}
                />
              </Match>
              <Match
                when={
                  getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].state === 'done' &&
                  (getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].data?.lines ||
                    getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].data?.lyrics)
                }
              >
                <LitElementWrapper
                  elementClass={IconCheckCircle}
                  props={{ style: { padding: '5px', scale: '0.8' } }}
                />
              </Match>
              <Match
                when={
                  getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].state === 'done' &&
                  !getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].data?.lines &&
                  !getLyricsProvider().lyricsStore.lyrics[getLyricsProvider().lyricsStore.provider].data?.lyrics
                }
              >
                <LitElementWrapper
                  elementClass={IconWarning}
                  props={{ style: { padding: '5px', scale: '0.8' } }}
                />
              </Match>
            </Switch>
            <span style={{ color: 'white' }}>{getLyricsProvider().lyricsStore.provider}</span>
            <mdui-button-icon onClick={toggleStar} tabindex={-1}>
              <Show
                fallback={
                  <LitElementWrapper elementClass={IconStarBorder} />
                }
                when={starredProvider() === getLyricsProvider().lyricsStore.provider}
              >
                <LitElementWrapper elementClass={IconStar} />
              </Show>
            </mdui-button-icon>
          </div>
        </div>

        <ul class="lyrics-picker-content-dots">
          <For each={providerNames}>
            {(provider, idx) => (
              <li
                class="lyrics-picker-dot"
                onClick={() => selectProvider(provider)}
                style={{
                  background: idx() === providerIdx() ? 'white' : 'black',
                }}
              />
            )}
          </For>
        </ul>
      </div>

      <div class="lyrics-picker-left">
        <mdui-button-icon>
          <LitElementWrapper
            elementClass={IconChevronRight}
            props={{
              onClick: next,
              role: 'button',
              style: { padding: '5px' },
            }}
          />
        </mdui-button-icon>
      </div>
    </div>
  );
};
