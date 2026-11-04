import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { t } from '@/i18n';
import { getSongInfo } from '@/providers/song-info-front';

import {
  formatOffset,
  loadOffset,
  nudgeOffset,
  OFFSET_STEP_MS,
  saveOffset,
} from '../lyric-offset';
import { getLyricsState, type LyricsState } from '../lyrics';
import {
  findCurrentLineIndex,
  getCountdownBeats,
  getLineProgress,
} from '../timing';

import type { LyricsSize } from '../types';

const RTL_TEXT = /[֐-ࣿ]/;

type Frame = {
  message: string | null;
  current: string;
  next: string;
  beats: number;
};

const getMessage = (state: LyricsState) => {
  if (state.status === 'searching')
    return t('plugins.karaoke.lyrics.searching');
  if (state.status === 'not-found')
    return t('plugins.karaoke.lyrics.not-found');
  return null;
};

export interface KaraokeOverlayProps {
  size: LyricsSize;
  notice: string | null;
  aiStatus: string | null;
  vocalLevel: number;
  onVocalLevel: (level: number) => void;
  onExit: () => void;
}

export const KaraokeOverlay = (props: KaraokeOverlayProps) => {
  const [frame, setFrame] = createSignal<Frame>(
    { message: null, current: '', next: '', beats: 0 },
    {
      equals: (a, b) =>
        a.message === b.message &&
        a.current === b.current &&
        a.next === b.next &&
        a.beats === b.beats,
    },
  );
  const [title, setTitle] = createSignal('');
  const [artist, setArtist] = createSignal('');
  const [offsetMs, setOffsetMs] = createSignal(0);

  const [currentLine, setCurrentLine] = createSignal<HTMLSpanElement>();
  let animationFrame = 0;
  let offsetVideoId: string | null = null;

  const nudge = (deltaMs: number) => {
    const next = nudgeOffset(offsetMs(), deltaMs);
    setOffsetMs(next);
    if (offsetVideoId) saveOffset(offsetVideoId, next);
  };

  const draw = () => {
    animationFrame = requestAnimationFrame(draw);

    const video = document.querySelector('video');
    const state = getLyricsState();

    const songInfo = getSongInfo();
    if (songInfo.videoId !== offsetVideoId) {
      offsetVideoId = songInfo.videoId;
      setOffsetMs(loadOffset(offsetVideoId));
    }
    const videoTimeInMs = (video?.currentTime ?? 0) * 1000;
    const timeInMs = videoTimeInMs - offsetMs();

    setTitle(songInfo.alternativeTitle ?? songInfo.title);
    setArtist(songInfo.artist);

    // An ad plays in the same video element, so its clock is not the song's.
    const isAdPlaying = Boolean(document.querySelector('.ad-showing'));

    if (isAdPlaying || state.status !== 'ready') {
      setFrame({
        message: isAdPlaying
          ? t('plugins.karaoke.lyrics.after-ad')
          : getMessage(state),
        current: '',
        next: '',
        beats: 0,
      });
      return;
    }

    const { lines } = state;
    const index = findCurrentLineIndex(lines, timeInMs);
    const line = lines.at(Math.max(index, 0));
    const isSinging = index >= 0 && Boolean(line?.text.trim());
    const nextLine = lines.slice(index + 1).find((it) => it.text.trim());

    setFrame({
      message: null,
      current: isSinging ? line!.text.trim() : '',
      next: nextLine?.text.trim() ?? '',
      beats: getCountdownBeats(lines, index, timeInMs),
    });

    if (isSinging) {
      currentLine()?.style.setProperty(
        '--karaoke-progress',
        `${getLineProgress(line!, timeInMs) * 100}%`,
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    props.onExit();
  };

  onMount(() => {
    animationFrame = requestAnimationFrame(draw);
    window.addEventListener('keydown', onKeyDown, { capture: true });
  });

  onCleanup(() => {
    cancelAnimationFrame(animationFrame);
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  return (
    <div class="karaoke-overlay" data-size={props.size}>
      <header class="karaoke-header">
        <div class="karaoke-title">{title()}</div>
        <div class="karaoke-artist">{artist()}</div>
      </header>

      <main class="karaoke-stage">
        <Show
          fallback={<p class="karaoke-message">{frame().message}</p>}
          when={!frame().message}
        >
          <div aria-hidden="true" class="karaoke-countdown">
            <For each={[3, 2, 1]}>
              {(beat) => (
                <span
                  class="karaoke-beat"
                  classList={{ lit: frame().beats >= beat }}
                />
              )}
            </For>
          </div>
          <p class="karaoke-current" dir="auto">
            <span
              class="karaoke-sweep"
              classList={{ rtl: RTL_TEXT.test(frame().current) }}
              ref={setCurrentLine}
            >
              {frame().current}
            </span>
          </p>
          <p class="karaoke-next" dir="auto">
            {frame().next}
          </p>
        </Show>
      </main>

      <footer class="karaoke-footer">
        <label class="karaoke-vocals">
          <span>{t('plugins.karaoke.overlay.vocals')}</span>
          <input
            max="100"
            min="0"
            onInput={(event) =>
              props.onVocalLevel(event.currentTarget.valueAsNumber / 100)
            }
            type="range"
            value={Math.round(props.vocalLevel * 100)}
          />
          <span>{Math.round(props.vocalLevel * 100)}%</span>
        </label>
        <Show when={props.aiStatus}>
          <p class="karaoke-ai-status">{props.aiStatus}</p>
        </Show>
        <div class="karaoke-offset">
          <button onClick={() => nudge(-OFFSET_STEP_MS)} type="button">
            {t('plugins.karaoke.overlay.lyrics-earlier')}
          </button>
          <span>{formatOffset(offsetMs())}</span>
          <button onClick={() => nudge(OFFSET_STEP_MS)} type="button">
            {t('plugins.karaoke.overlay.lyrics-later')}
          </button>
        </div>
        <Show when={props.notice}>
          <p class="karaoke-notice">{props.notice}</p>
        </Show>
        <p class="karaoke-hint">{t('plugins.karaoke.overlay.exit-hint')}</p>
      </footer>
    </div>
  );
};
