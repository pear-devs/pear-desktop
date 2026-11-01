import { copyState, LyricsCache, candidatesValid } from './cache';
import { bounded, classifyFailure, LyricsError } from './http';

import type { ProviderState } from '../providers';
import type { LyricProvider, SearchSongInfo, SearchOptions } from '../types';

export const fingerprint = (
  info: SearchSongInfo,
  options: SearchOptions,
  names: string[],
) =>
  JSON.stringify([
    'lyrics-search-v4-candidates-match-v1',
    info.videoId,
    info.title,
    info.alternativeTitle ?? null,
    info.artist,
    info.album ?? null,
    info.songDuration,
    info.tags ?? [],
    options.showLyricsEvenIfInexact,
    [...names].sort(),
  ]);

export interface SearchSession {
  fingerprint: string;
  generation: number;
  controller: AbortController;
  states: Record<string, ProviderState>;
  track: SearchSongInfo;
  complete: boolean;
  completion: Promise<void>;
}
type Run = { controller: AbortController; promise: Promise<void> };

export class SearchCoordinator {
  current?: SearchSession;
  private generation = 0;
  private runs = new Map<string, Run>();
  private listeners = new Set<(session: SearchSession) => void>();
  private disposed = false;
  constructor(
    private providers: Record<string, LyricProvider>,
    readonly cache = new LyricsCache(),
    private timeoutMs = 15000,
  ) {}

  subscribe(listener: (session: SearchSession) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(session: SearchSession) {
    if (this.current === session && !this.disposed)
      for (const listener of this.listeners) {
        try {
          listener(session);
        } catch (error) {
          console.error('Lyrics search subscriber failed', error);
        }
      }
  }
  search(
    info: SearchSongInfo,
    options: SearchOptions = { showLyricsEvenIfInexact: false },
  ): SearchSession {
    if (this.disposed) throw new Error('Lyrics coordinator disposed');
    info = { ...info, ...(info.tags ? { tags: [...info.tags] } : {}) };
    options = { ...options };
    const key = fingerprint(
      info,
      options,
      Object.entries(this.providers).map(
        ([name, provider]) => `${name}:${provider.baseUrl}`,
      ),
    );
    if (this.current?.fingerprint === key) return this.current;
    this.cancel();
    const session: SearchSession = {
      fingerprint: key,
      generation: ++this.generation,
      controller: new AbortController(),
      states: {},
      track: info,
      complete: false,
      completion: Promise.resolve(),
    };
    this.current = session;
    for (const name of Object.keys(this.providers)) {
      const cached = this.cache.get(key, name);
      session.states[name] = cached ?? {
        state: 'fetching',
        candidates: [],
        error: null,
      };
    }
    this.emit(session);
    for (const name of Object.keys(this.providers)) {
      if (session.states[name].state === 'fetching')
        this.run(session, name, info);
    }
    this.completion(session);
    return session;
  }
  private completion(session: SearchSession) {
    session.complete = Object.values(session.states).every(
      (state) => state.state !== 'fetching',
    );
    const promises = [...this.runs.values()].map((run) => run.promise);
    session.completion = Promise.all(promises).then(() => {
      if (this.current !== session || session.controller.signal.aborted) return;
      session.complete = Object.values(session.states).every(
        (state) => state.state !== 'fetching',
      );
      this.emit(session);
    });
    this.emit(session);
  }
  private run(session: SearchSession, name: string, info: SearchSongInfo) {
    const controller = new AbortController();
    const abort = () => controller.abort(session.controller.signal.reason);
    session.controller.signal.addEventListener('abort', abort, { once: true });
    const run: Run = { controller, promise: Promise.resolve() };
    this.runs.set(name, run);
    run.promise = bounded(
      (signal) => this.providers[name].search(info, { signal }),
      controller.signal,
      this.timeoutMs,
    )
      .then((candidates) => {
        if (
          !candidatesValid(candidates) ||
          candidates.some((candidate) => candidate.provider !== name)
        )
          throw new LyricsError(
            'parse/schema',
            'Invalid canonical provider result',
          );
        return copyState({
          state: 'done',
          candidates,
          error: null,
        });
      })
      .catch(
        (error: unknown): ProviderState => ({
          state: 'error',
          candidates: [],
          error: classifyFailure(error),
        }),
      )
      .then((state) => {
        if (
          this.disposed ||
          this.current !== session ||
          session.controller.signal.aborted ||
          this.runs.get(name) !== run
        )
          return;
        this.cache.set(session.fingerprint, name, state);
        session.states[name] = copyState(state);
        this.emit(session);
      })
      .finally(() => {
        session.controller.signal.removeEventListener('abort', abort);
        if (this.runs.get(name) === run) this.runs.delete(name);
      });
  }
  retry(
    name: string,
    info: SearchSongInfo,
    options: SearchOptions = { showLyricsEvenIfInexact: false },
  ) {
    if (!this.providers[name])
      throw new Error(`Unknown lyrics provider: ${name}`);
    if (this.disposed) throw new Error('Lyrics coordinator disposed');
    const key = fingerprint(
      info,
      options,
      Object.entries(this.providers).map(
        ([providerName, provider]) => `${providerName}:${provider.baseUrl}`,
      ),
    );
    const session = this.current;
    // A late retry from an old UI must never switch the active track backwards.
    if (!session || session.fingerprint !== key) return;
    this.runs
      .get(name)
      ?.controller.abort(
        new LyricsError('aborted', 'Lyrics retry superseded request'),
      );
    this.cache.delete(session.fingerprint, name);
    session.states[name] = { state: 'fetching', candidates: [], error: null };
    session.complete = false;
    this.run(session, name, info);
    this.completion(session);
    return session;
  }
  cancel() {
    const error = new LyricsError('aborted', 'Lyrics session ended');
    this.current?.controller.abort(error);
    if (this.current) {
      for (const name of Object.keys(this.current.states)) {
        if (this.current.states[name].state === 'fetching')
          this.current.states[name] = { state: 'error', candidates: [], error };
      }
      this.current.complete = true;
    }
    this.runs.clear();
    this.current = undefined;
  }
  dispose() {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
    this.cache.clear();
  }
}
