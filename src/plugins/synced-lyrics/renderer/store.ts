import { batch, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import { config } from './renderer';

import {
  normalizePreferredProvider,
  readSongChoice,
  writeSongChoice,
} from '../preferences';
import {
  providerNames,
  type ProviderName,
  type ProviderState,
} from '../providers';
import { providers } from '../providers/renderer';
import { copyState } from '../search/cache';
import { SearchCoordinator } from '../search/coordinator';
import {
  rankCandidates,
  selectCandidate,
  type RankedCandidate,
  type SourceChoice,
} from '../search/ranking';

import type { LyricResult, SearchSongInfo } from '../types';
import type { SongInfo } from '@/providers/song-info';

type CurrentLyrics = {
  state: ProviderState['state'];
  data: LyricResult | null;
  error: Error | null;
};
type LyricsStore = {
  browsedProvider: ProviderName;
  provider: ProviderName;
  current: CurrentLyrics;
  lyrics: Record<ProviderName, ProviderState>;
  track: SearchSongInfo | null;
  manualChoice: SourceChoice | null;
  songChoice: SourceChoice | null;
};
const initialData = () =>
  providerNames.reduce(
    (states, name) => {
      states[name] = { state: 'fetching', candidates: [], error: null };
      return states;
    },
    {} as LyricsStore['lyrics'],
  );

export const [lyricsStore, setLyricsStore] = createStore<LyricsStore>({
  browsedProvider: providerNames[0],
  lyrics: initialData(),
  track: null,
  manualChoice: null,
  songChoice: null,
  get provider(): ProviderName {
    return (
      (selection().selected?.candidate.provider as ProviderName | undefined) ??
      this.browsedProvider
    );
  },
  get current(): CurrentLyrics {
    const selected = selection().selected;
    if (selected)
      return { state: 'done', data: selected.candidate.result, error: null };
    if (providerNames.some((name) => this.lyrics[name].state === 'fetching'))
      return { state: 'fetching', data: null, error: null };
    const state = this.lyrics[this.browsedProvider];
    return { state: state.state, data: null, error: state.error };
  },
});
export const rankedCandidates = (): RankedCandidate[] =>
  lyricsStore.track
    ? rankCandidates(
        lyricsStore.track,
        providerNames.flatMap((name) => lyricsStore.lyrics[name].candidates),
        {
          allowInexact: config()?.showLyricsEvenIfInexact ?? false,
          preferredProvider: normalizePreferredProvider(
            config()?.preferredProvider,
          ),
        },
      )
    : [];
export const selection = (): ReturnType<typeof selectCandidate> =>
  selectCandidate(
    rankedCandidates(),
    lyricsStore.manualChoice ?? lyricsStore.songChoice,
  );
export const currentLyrics = () => lyricsStore.current;
export const selectSource = (
  provider: ProviderName,
  candidateId: string | null = null,
) =>
  batch(() => {
    // An explicit click on an available source chooses its durable variant, not
    // whichever array position happens to win when more results arrive.
    if (candidateId === null)
      candidateId =
        rankedCandidates().find(
          (item) =>
            item.candidate.provider === String(provider) &&
            item.evidence.eligible &&
            item.syncQuality > 0,
        )?.candidate.id ?? null;
    setLyricsStore('browsedProvider', provider);
    setLyricsStore('manualChoice', { kind: 'source', provider, candidateId });
  });
export const selectAuto = () => setLyricsStore('manualChoice', null);
export const toggleSongChoice = (provider: ProviderName) => {
  const videoId = lyricsStore.track?.videoId;
  if (!videoId) return;
  const selected = selection().selected?.candidate;
  const choice: SourceChoice | null =
    lyricsStore.songChoice?.provider === provider &&
    (lyricsStore.songChoice.candidateId === null ||
      lyricsStore.songChoice.candidateId === selected?.id)
      ? null
      : {
          kind: 'source',
          provider,
          candidateId:
            selected?.provider === String(provider) ? selected.id : null,
        };
  writeSongChoice(localStorage, videoId, choice);
  batch(() => {
    setLyricsStore('songChoice', choice);
    setLyricsStore('manualChoice', null);
  });
};

let coordinator: SearchCoordinator | undefined;
const getCoordinator = () => {
  if (!coordinator) {
    coordinator = new SearchCoordinator(providers);
    coordinator.subscribe((session) =>
      untrack(() =>
        batch(() => {
          if (lyricsStore.track?.videoId !== session.track.videoId) {
            setLyricsStore('browsedProvider', providerNames[0]);
            setLyricsStore('manualChoice', null);
            setLyricsStore(
              'songChoice',
              session.track.videoId
                ? readSongChoice(localStorage, session.track.videoId)
                : null,
            );
          }
          setLyricsStore('track', reconcile(session.track));
          const states = Object.fromEntries(
            providerNames.map((name) => [
              name,
              copyState(session.states[name]),
            ]),
          ) as LyricsStore['lyrics'];
          setLyricsStore('lyrics', reconcile(states, { merge: false }));
        }),
      ),
    );
  }
  return coordinator;
};
const options = () => ({
  showLyricsEvenIfInexact: config()?.showLyricsEvenIfInexact ?? false,
});
export const fetchLyrics = (info: SongInfo) =>
  getCoordinator().search(info, options());
export const retrySearch = (provider: ProviderName, info: SongInfo) =>
  getCoordinator().retry(provider, info, options());
export const retryChosenSource = () => {
  const choice = selection().choice;
  const track = lyricsStore.track;
  if (
    choice &&
    track &&
    providerNames.includes(choice.provider as ProviderName)
  )
    return getCoordinator().retry(choice.provider, track, options());
  return undefined;
};
const reset = () =>
  batch(() => {
    setLyricsStore('track', null);
    setLyricsStore('browsedProvider', providerNames[0]);
    setLyricsStore('manualChoice', null);
    setLyricsStore('songChoice', null);
    setLyricsStore('lyrics', reconcile(initialData()));
  });
export const cancelSearch = () => {
  coordinator?.cancel();
  reset();
};
export const disposeSearch = () => {
  coordinator?.dispose();
  coordinator = undefined;
  reset();
};
