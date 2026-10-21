import { IconCheckCircle } from '@mdui/icons/check-circle.js';
import { IconChevronLeft } from '@mdui/icons/chevron-left.js';
import { IconChevronRight } from '@mdui/icons/chevron-right.js';
import { IconError } from '@mdui/icons/error.js';
import { IconStarBorder } from '@mdui/icons/star-border.js';
import { IconStar } from '@mdui/icons/star.js';
import { IconWarning } from '@mdui/icons/warning.js';
import {
  createMemo,
  For,
  Index,
  Match,
  Show,
  Switch,
  type Setter,
} from 'solid-js';

import { LitElementWrapper } from '@/solit';

import { providerNames, type ProviderName } from '../../providers';
import { providerIndicator } from '../picker-presentation';
import {
  lyricsStore,
  rankedCandidates,
  selection,
  selectSource,
  toggleSongChoice,
} from '../store';

export const providerIdx = () => providerNames.indexOf(lyricsStore.provider);

export const LyricsPicker = (props: {
  setStickRef: Setter<HTMLElement | null>;
}) => {
  const ranked = createMemo(rankedCandidates);
  const availableProviders = createMemo(() =>
    providerNames.filter((provider) =>
      ranked().some(
        (item) =>
          item.candidate.provider === String(provider) &&
          item.evidence.eligible &&
          item.syncQuality > 0,
      ),
    ),
  );
  const move = (delta: number) => {
    const available = availableProviders();
    if (available.length < 2) return;
    const index = available.indexOf(lyricsStore.provider);
    selectSource(
      available[(index + delta + available.length) % available.length],
    );
  };
  const indicator = (provider: ProviderName) =>
    providerIndicator(
      lyricsStore.lyrics[provider],
      ranked().some(
        (item) =>
          item.candidate.provider === String(provider) &&
          item.evidence.eligible &&
          item.syncQuality > 0,
      ),
    );
  const starred = (provider: ProviderName) =>
    lyricsStore.songChoice?.provider === provider &&
    (lyricsStore.songChoice.candidateId === null ||
      lyricsStore.songChoice.candidateId ===
        selection().selected?.candidate.id);
  const offset = () => {
    const value = providerIdx() * -100;
    return value - 5;
  };

  return (
    <div class="lyrics-picker" ref={props.setStickRef}>
      <div class="lyrics-picker-left">
        <mdui-button-icon
          aria-label="Previous lyrics provider"
          disabled={availableProviders().length < 2}
          onClick={() => move(-1)}
        >
          <LitElementWrapper
            elementClass={IconChevronLeft}
            props={{ style: { padding: '5px' } }}
          />
        </mdui-button-icon>
      </div>
      <div class="lyrics-picker-content">
        <div class="lyrics-picker-content-label">
          <Index each={providerNames}>
            {(provider) => (
              <div
                class="lyrics-picker-item"
                style={{ transform: `translateX(${offset()}%)` }}
                tabindex="-1"
              >
                <Switch>
                  <Match when={indicator(provider()) === 'searching'}>
                    <tp-yt-paper-spinner-lite
                      active
                      aria-label="Searching lyrics"
                      class="loading-indicator style-scope"
                      style={{ padding: '5px', transform: 'scale(0.5)' }}
                      tabindex="-1"
                    />
                  </Match>
                  <Match when={indicator(provider()) === 'failure'}>
                    <LitElementWrapper
                      elementClass={IconError}
                      props={{
                        'aria-label': 'Lyrics unavailable',
                        'style': { padding: '5px', scale: '0.8' },
                      }}
                    />
                  </Match>
                  <Match when={indicator(provider()) === 'success'}>
                    <LitElementWrapper
                      elementClass={IconCheckCircle}
                      props={{
                        'aria-label': 'Lyrics available',
                        'style': { padding: '5px', scale: '0.8' },
                      }}
                    />
                  </Match>
                  <Match when={indicator(provider()) === 'unavailable'}>
                    <LitElementWrapper
                      elementClass={IconWarning}
                      props={{
                        'aria-label': 'No lyrics found',
                        'style': { padding: '5px', scale: '0.8' },
                      }}
                    />
                  </Match>
                </Switch>
                <yt-formatted-string
                  class="description ytmusic-description-shelf-renderer"
                  text={{ runs: [{ text: provider() }] }}
                />
                <mdui-button-icon
                  aria-label="Remember lyrics source for this song"
                  aria-pressed={starred(provider())}
                  onClick={() => toggleSongChoice(provider())}
                  tabindex={-1}
                >
                  <Show
                    fallback={
                      <LitElementWrapper elementClass={IconStarBorder} />
                    }
                    when={starred(provider())}
                  >
                    <LitElementWrapper elementClass={IconStar} />
                  </Show>
                </mdui-button-icon>
              </div>
            )}
          </Index>
        </div>
        <ul class="lyrics-picker-content-dots">
          <For each={providerNames}>
            {(provider, idx) => (
              <li
                aria-current={idx() === providerIdx() ? 'true' : undefined}
                aria-label={`Choose ${provider}`}
                class="lyrics-picker-dot"
                classList={{
                  'lyrics-picker-dot-available':
                    availableProviders().includes(provider),
                  'lyrics-picker-dot-current': idx() === providerIdx(),
                }}
                onClick={() => selectSource(provider)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectSource(provider);
                  }
                }}
                role="button"
                tabindex="0"
                title={`${provider}: ${availableProviders().includes(provider) ? 'Lyrics available' : 'No lyrics available yet'}`}
              />
            )}
          </For>
        </ul>
      </div>
      <div class="lyrics-picker-left">
        <mdui-button-icon
          aria-label="Next lyrics provider"
          disabled={availableProviders().length < 2}
          onClick={() => move(1)}
        >
          <LitElementWrapper
            elementClass={IconChevronRight}
            props={{ style: { padding: '5px' } }}
          />
        </mdui-button-icon>
      </div>
    </div>
  );
};
