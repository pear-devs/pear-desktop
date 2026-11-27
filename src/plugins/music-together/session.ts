import type { Connection } from './connection';
import type { Queue } from './queue';
import type {
  RemoveFailure,
  SessionCommand,
  SessionState,
} from './session-protocol';
import type { Permission, VideoData } from './types';
import type { MusicPlayer } from '@/types/music-player';
import type { DataConnection } from 'peerjs';

const isVideoId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{11}$/.test(id);

const isPlaylistId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{2,128}$/.test(id);

export class Session {
  private active = true;
  private work = Promise.resolve();
  private sequence = 0;
  private queueRevision = 0;
  private guestQueueRevision = -1;
  private transitMs = 0;
  private lastProbeAt?: number;
  private publishing = false;
  private seekRevision = 0;
  private appliedSeekRevision = -1;
  private appliedEntryId?: string;
  private expectedSeek?: {
    entryId: string;
    position: number;
    expiresAt: number;
  };
  private expectedPlayerStates = new Map<number, number>();
  private selectingEntry?: { entryId: string; startedAt: number };
  private guestControlsSettleUntil = 0;
  private guestMediaRequest?: { entryId: string; startedAt: number };
  private sourcePlaylistId?: string;
  private hostEntryId?: string;
  private hostNavigation?: {
    previousVideoId?: string;
    videoId?: string;
    startedAt: number;
    loaded: boolean;
  };
  private guestNavigation?: {
    videoId?: string;
    playlistId?: string;
    initialItems: Queue['rawItems'];
    ownerId: string;
    startedAt: number;
  };
  private hostSeek?: { entryId: string; position: number; requestedAt: number };
  private latest?: { state: SessionState; receivedAt: number };
  private pendingQueue?: { revision: number; entries: VideoData[] };
  private reconciling = false;
  private syncingPlayback = false;

  constructor(
    private readonly connection: Connection,
    private readonly queue: Queue,
    private readonly player: MusicPlayer,
    private readonly getPermission: () => Permission,
    private readonly setPermission: (permission: Permission) => void,
    private readonly showRemoveFailure: (reason: RemoveFailure) => void,
  ) {}

  start() {
    const mode = this.connection.mode;
    if (mode === 'disconnected') return;
    if (mode === 'host') this.queue.adoptPlayerQueue(this.connection.id);
    this.queue.initQueue();
    this.queue.injection(
      mode,
      (command) => this.command(command),
      () => this.publishState(),
    );
  }

  stop() {
    this.active = false;
    this.queue.rollbackInjection();
    this.queue.removeQueueOwner();
  }

  private enqueue(action: () => Promise<void>) {
    this.work = this.work
      .then(async () => {
        if (this.active) await action();
      })
      .catch((error: unknown) => {
        console.warn('Music Together: Could not apply session update', error);
      });
  }

  command(command: SessionCommand, sender?: DataConnection) {
    if (!this.active) return;
    if (this.connection.mode === 'guest') {
      const permission = this.getPermission();
      if (
        permission !== 'host-only' &&
        (command.kind !== 'playback' || permission === 'all')
      ) {
        this.connection.broadcast('COMMAND', command);
      } else if (command.kind === 'remove') {
        this.showRemoveFailure('permission');
      }
      return;
    }

    this.enqueue(async () => {
      if (sender && !sender.open) return;
      const before = this.queue.videoList.slice();
      this.reconcileHostQueue();
      let accepted = false;
      try {
        accepted = await this.applyCommand(command, sender);
      } catch (error) {
        console.warn('Music Together: Could not apply command', error);
      }
      if (!this.active) return;
      if (!accepted) this.reconcileHostQueue();
      const changed =
        before.length !== this.queue.videoList.length ||
        before.some((entry, index) => entry !== this.queue.videoList[index]);
      if (changed) this.queueRevision++;
      if (accepted || changed) await this.publish(changed);
      if (sender && command?.kind === 'queue-media') {
        await this.connection.send(sender, 'QUEUE_ADD_RESULT', accepted);
      } else if (!accepted) {
        if (command?.kind === 'remove') {
          if (sender) {
            const reason =
              this.getPermission() === 'host-only' ? 'permission' : 'failed';
            await this.connection.send(sender, 'QUEUE_REMOVE_FAILED', reason);
          } else {
            this.showRemoveFailure('failed');
          }
        }
        if (sender) await this.publish(true, sender);
      }
    });
  }

  private async applyCommand(
    command: SessionCommand,
    sender?: DataConnection,
  ): Promise<boolean> {
    if (!command || typeof command !== 'object') return false;
    const permission = this.getPermission();
    if (sender && permission === 'host-only') return false;
    const list = this.queue.videoList;
    const indexOf = (id: unknown) =>
      typeof id === 'string'
        ? list.findIndex((entry) => entry.entryId === id)
        : -1;

    const ownerId = sender?.peer ?? this.connection.id;
    const newEntry = (videoId: string): VideoData => ({
      entryId: crypto.randomUUID(),
      videoId,
      ownerId,
    });
    const canEdit = () =>
      this.active &&
      (!sender || (sender.open && this.getPermission() !== 'host-only'));
    const currentQueue = () => {
      if (!canEdit() || (this.guestNavigation && !this.queue.rawItems.length))
        return;
      this.reconcileHostQueue();
      return this.queue.videoList;
    };

    switch (command.kind) {
      case 'navigate': {
        const { videoId, playlistId, params } = command;
        if (
          (!videoId && !playlistId) ||
          (videoId !== undefined && !isVideoId(videoId)) ||
          (playlistId !== undefined && !isPlaylistId(playlistId)) ||
          (params !== undefined &&
            (typeof params !== 'string' || !/^[\w%+/=-]{1,1024}$/.test(params)))
        )
          return false;
        // A playlist-page link can also select a song already in this session.
        if (
          videoId &&
          playlistId &&
          !(playlistId.startsWith('RD') && params?.startsWith('wAEB')) &&
          (playlistId === this.sourcePlaylistId ||
            playlistId === this.player.getVideoData()?.list)
        ) {
          const matches = list.filter((entry) => entry.videoId === videoId);
          if (matches.length === 1) {
            return this.applyCommand(
              { kind: 'select', entryId: matches[0].entryId },
              sender,
            );
          }
        }
        const app = document.querySelector('ytmusic-app');
        if (!app) return false;
        this.selectingEntry = undefined;
        const playerParams =
          params ?? (playlistId?.startsWith('RD') ? 'wAEB' : undefined);
        const target = {
          ...(videoId ? { videoId } : {}),
          ...(playlistId ? { playlistId } : {}),
          ...(playerParams ? { params: playerParams } : {}),
        };
        const endpoint = videoId
          ? { watchEndpoint: target }
          : { watchPlaylistEndpoint: target };
        const initialItems = this.queue.rawItems;
        app.dispatchEvent(
          new CustomEvent('yt-navigate', {
            bubbles: true,
            composed: true,
            detail: { endpoint },
          }),
        );
        this.guestNavigation = {
          videoId,
          playlistId,
          initialItems,
          ownerId: sender?.peer ?? this.connection.id,
          startedAt: performance.now(),
        };
        return true;
      }
      case 'queue-media': {
        const { videoId, playlistId, placement } = command;
        if (placement !== 'next' && placement !== 'end') return false;
        const locate = () => {
          const current = currentQueue();
          if (!current) return;
          if (placement === 'end') return current.length;
          const active = this.getHostEntry();
          const index = active
            ? current.indexOf(active)
            : this.queue.selectedIndex;
          return index >= 0 ? index + 1 : current.length;
        };
        if (isVideoId(videoId) && playlistId === undefined) {
          return this.queue.addVideos([newEntry(videoId)], locate);
        }
        if (isPlaylistId(playlistId) && videoId === undefined) {
          return this.queue.addPlaylist(playlistId, ownerId, locate);
        }
        return false;
      }
      case 'add': {
        const { videoIds } = command;
        if (
          !Array.isArray(videoIds) ||
          !videoIds.length ||
          !videoIds.every(isVideoId)
        )
          return false;
        return this.queue.addVideos(videoIds.map(newEntry), () => {
          const current = currentQueue();
          if (!current) return;
          if (command.before === null) return current.length;
          const index = current.findIndex(
            (entry) => entry.entryId === command.before,
          );
          return index >= 0 ? index : undefined;
        });
      }
      case 'move': {
        const from = indexOf(command.entryId);
        const anchor =
          command.before === null ? list.length : indexOf(command.before);
        if (from < 0 || anchor < 0 || command.before === command.entryId)
          return false;
        const to = anchor > from ? anchor - 1 : anchor;
        if (from !== to) this.queue.moveItem(from, to);
        return true;
      }
      case 'remove': {
        const index = indexOf(command.entryId);
        if (index < 0) return false;
        const removingSelected = index === this.queue.selectedIndex;
        if (!this.queue.removeVideo(index)) return false;
        if (!this.queue.videoList.length) {
          this.player.pauseVideo();
        } else if (removingSelected) {
          const next = Math.min(index, this.queue.videoList.length - 1);
          this.selectHostTrack(next, this.queue.videoList[next], 0);
        }
        return true;
      }
      case 'next': {
        const active = this.getHostEntry();
        const index = active ? list.indexOf(active) : this.queue.selectedIndex;
        const next =
          list[index + 1] ?? (this.queue.repeatsQueue ? list[0] : undefined);
        if (!next) return false;
        return this.applyCommand(
          { kind: 'select', entryId: next.entryId },
          sender,
        );
      }
      case 'select': {
        const index = indexOf(command.entryId);
        if (index < 0) return false;
        const entry = list[index];
        const loaded = this.isLoaded(entry);
        if (
          index !== this.queue.selectedIndex ||
          !loaded ||
          (this.selectingEntry && this.selectingEntry.entryId !== entry.entryId)
        ) {
          this.selectHostTrack(index, entry, 0);
        }
        const state = this.player.getPlayerState();
        if (loaded && (state === 2 || state === 5)) this.player.playVideo();
        return true;
      }
      case 'playback': {
        if (sender && permission !== 'all') return false;
        const entry = this.getHostEntry();
        if (!entry || entry.entryId !== command.entryId) return false;
        const { state, position } = command;
        if (state !== undefined && state !== 1 && state !== 2) return false;
        if (
          position !== undefined &&
          (!Number.isFinite(position) || position < 0)
        )
          return false;
        if (state === undefined && position === undefined) return false;
        if (position !== undefined) {
          const duration = this.player.getDuration();
          const target = duration > 0 ? Math.min(position, duration) : position;
          this.hostSeek = {
            entryId: entry.entryId,
            position: target,
            requestedAt: performance.now(),
          };
          this.seekRevision++;
          this.player.seekTo(target);
        }
        if (state === 1) this.player.playVideo();
        if (state === 2) this.player.pauseVideo();
        return true;
      }
      default:
        return false;
    }
  }

  private isLoaded(entry: VideoData) {
    return this.player.getVideoData()?.video_id === entry.videoId;
  }

  onHostNavigation(videoId?: string, playlistId?: string) {
    this.guestNavigation = undefined;
    if (!playlistId?.startsWith('QP')) this.sourcePlaylistId = playlistId;
    const previousVideoId = this.player.getVideoData()?.video_id;
    if (!playlistId && videoId && videoId === previousVideoId) return;
    this.hostNavigation = {
      previousVideoId,
      videoId,
      startedAt: performance.now(),
      loaded: false,
    };
  }

  private getHostEntry() {
    const videoId = this.player.getVideoData()?.video_id;
    if (!videoId) return;
    const navigation = this.hostNavigation;
    if (
      navigation &&
      !navigation.loaded &&
      videoId === navigation.previousVideoId &&
      performance.now() - navigation.startedAt < 10_000
    )
      return;

    const entries = this.queue.videoList;
    if (this.selectingEntry) return;
    const selected = entries[this.queue.selectedIndex];
    if (selected?.videoId === videoId) return selected;

    // During a native queue update the numeric selection can still refer to the old queue.
    let match: VideoData | undefined;
    let duplicates = false;
    for (const [index, entry] of entries.entries()) {
      if (entry.videoId !== videoId) continue;
      if (this.queue.isHighlighted(index)) return entry;
      if (match) duplicates = true;
      match = entry;
    }
    return duplicates
      ? entries.find(
          (entry) =>
            entry.entryId === this.hostEntryId && entry.videoId === videoId,
        )
      : match;
  }

  private reconcileHostQueue() {
    const items = this.queue.rawItems;
    const pending = this.guestNavigation;
    if (pending) {
      if (!items.length) return false;
      if (items !== pending.initialItems) this.guestNavigation = undefined;
    }

    const navigation = this.hostNavigation;
    if (navigation) {
      if (performance.now() - navigation.startedAt >= 10_000) {
        this.hostNavigation = undefined;
      } else if (!items.length) {
        return false;
      } else if (navigation.loaded) {
        this.hostNavigation = undefined;
      }
    }
    return this.queue.adoptPlayerQueue(pending?.ownerId ?? this.connection.id);
  }

  private async recoverGuestNavigation() {
    const pending = this.guestNavigation;
    if (
      !pending ||
      performance.now() - pending.startedAt < (pending.playlistId ? 5000 : 3500)
    )
      return false;

    const canCommit = () =>
      this.active &&
      this.guestNavigation === pending &&
      (!this.queue.rawItems.length ||
        this.queue.rawItems === pending.initialItems);
    if (!canCommit()) return false;
    let recovered = false;
    if (pending.playlistId) {
      recovered = await this.queue.setPlaylist(
        pending.playlistId,
        pending.ownerId,
        canCommit,
      );
    } else if (pending.videoId) {
      const entry = {
        entryId: crypto.randomUUID(),
        videoId: pending.videoId,
        ownerId: pending.ownerId,
      };
      recovered = await this.queue.setVideoList([entry], canCommit);
    }
    if (!recovered) return false;
    const entries = this.queue.videoList;
    const entry =
      entries.find((item) => item.videoId === pending.videoId) ?? entries[0];
    if (!entry) return false;
    this.guestNavigation = undefined;
    this.hostNavigation = undefined;
    if (!this.isLoaded(entry)) {
      this.player.loadVideoById(
        entry.videoId,
        0,
        this.player.getUserPlaybackQualityPreference(),
      );
    } else if (this.player.getPlayerState() !== 1) {
      this.player.playVideo();
    }
    return true;
  }

  tick() {
    if (this.connection.mode === 'host') {
      this.publishState();
    } else if (this.connection.mode === 'guest') {
      const now = performance.now();
      if (this.lastProbeAt === undefined || now - this.lastProbeAt >= 10_000) {
        this.lastProbeAt = now;
        this.connection.broadcast('PING', now);
      }
    }
  }

  receivePong(sentAt: number) {
    if (sentAt === this.lastProbeAt) {
      this.transitMs = (performance.now() - sentAt) / 2;
    }
  }

  publishState(target?: DataConnection) {
    if (this.connection.mode !== 'host' || (!target && this.publishing)) return;
    if (!target) this.publishing = true;
    this.enqueue(async () => {
      try {
        const recovered = await this.recoverGuestNavigation();
        if (!this.active) return;
        const changed = recovered || this.reconcileHostQueue();
        if (changed) {
          this.queueRevision++;
          await this.publish(true);
        }
        if (target?.open) await this.publish(true, target);
        else if (!changed && !target) await this.publish(false);
      } finally {
        if (!target) this.publishing = false;
      }
    });
  }

  private async publish(includeQueue: boolean, target?: DataConnection) {
    if (this.selectingEntry) {
      const index = this.queue.videoList.findIndex(
        (entry) => entry.entryId === this.selectingEntry?.entryId,
      );
      const requested = this.queue.videoList[index];
      if (
        !requested ||
        (index === this.queue.selectedIndex && this.isLoaded(requested))
      ) {
        this.selectingEntry = undefined;
      } else {
        this.selectHostTrack(index, requested, 0);
      }
    }

    const entry =
      this.guestNavigation && !this.queue.flatItems.length
        ? undefined
        : this.getHostEntry();
    if (entry) this.hostEntryId = entry.entryId;
    const playerState = this.player.getPlayerState();
    let position = this.player.getCurrentTime();
    if (this.hostSeek?.entryId === entry?.entryId && this.hostSeek) {
      const elapsed = performance.now() - this.hostSeek.requestedAt;
      if (elapsed <= 2000) {
        position =
          this.hostSeek.position + (playerState === 1 ? elapsed / 1000 : 0);
      } else {
        this.hostSeek = undefined;
      }
    }
    const state: SessionState = {
      sequence: ++this.sequence,
      queueRevision: this.queueRevision,
      ...(includeQueue ? { queue: this.queue.videoList.slice() } : {}),
      permission: this.getPermission(),
      playback:
        entry && (playerState === 1 || playerState === 2)
          ? {
              entryId: entry.entryId,
              videoId: entry.videoId,
              position,
              state: playerState,
              seekRevision: this.seekRevision,
            }
          : null,
    };
    if (target) await this.connection.send(target, 'SESSION_STATE', state);
    else await this.connection.broadcast('SESSION_STATE', state);
  }

  async receive(state: SessionState): Promise<boolean> {
    if (!this.active || !state || state.sequence <= this.sequence) return false;
    // Targeted snapshots can leave gaps in the publication sequence.
    // The queue revision tells a guest when it needs a new queue.
    this.sequence = state.sequence;
    if (
      state.playback &&
      state.playback.entryId !== this.latest?.state.playback?.entryId
    ) {
      this.settleGuestControls();
    }
    this.latest = { state, receivedAt: performance.now() };
    if (
      state.queue &&
      state.queueRevision !== this.guestQueueRevision &&
      state.queueRevision !== this.pendingQueue?.revision
    ) {
      this.pendingQueue = {
        revision: state.queueRevision,
        entries: state.queue,
      };
    }
    if (state.permission !== this.getPermission())
      this.setPermission(state.permission);
    return this.reconcileGuest();
  }

  private async reconcileGuest(): Promise<boolean> {
    if (!this.active || !this.latest) return false;
    if (!this.syncingPlayback) {
      this.syncingPlayback = true;
      try {
        this.syncGuestPlayback(this.latest);
      } finally {
        this.syncingPlayback = false;
      }
    }
    if (this.reconciling) return false;
    this.reconciling = true;
    const latest = this.latest;
    try {
      await this.applyState(latest);
      return (
        this.active && this.guestQueueRevision === latest.state.queueRevision
      );
    } catch (error) {
      console.warn('Music Together: Could not synchronize guest', error);
      return false;
    } finally {
      this.reconciling = false;
      if (this.latest !== latest) await this.reconcileGuest();
    }
  }

  private async applyState({ state }: NonNullable<Session['latest']>) {
    if (this.guestQueueRevision !== state.queueRevision || this.pendingQueue) {
      const snapshot = this.pendingQueue;
      if (snapshot?.revision !== state.queueRevision) {
        await this.connection.broadcast('REQUEST_STATE', null);
        return;
      }
      if (
        !(await this.queue.setVideoList(snapshot.entries, () => {
          if (
            !this.active ||
            this.latest?.state.queueRevision !== snapshot.revision
          )
            return false;
          this.settleGuestControls();
          return true;
        }))
      )
        return;
      this.guestQueueRevision = snapshot.revision;
      if (this.pendingQueue === snapshot) this.pendingQueue = undefined;
      if (this.latest?.state !== state) return;
    }

    if (!this.queue.videoList.length) {
      if (this.player.getPlayerState() === 1) this.player.pauseVideo();
      return;
    }

    const playback = state.playback;
    if (!playback) return;
    const index = this.queue.videoList.findIndex(
      (entry) => entry.entryId === playback.entryId,
    );
    if (index < 0) return;
    const entry = this.queue.videoList[index];
    if (!this.isLoaded(entry)) return;
    if (
      index !== this.queue.selectedIndex ||
      !this.queue.isHighlighted(index)
    ) {
      this.settleGuestControls();
      this.queue.setIndex(index);
    }
  }

  private syncGuestPlayback({
    state,
    receivedAt,
  }: NonNullable<Session['latest']>) {
    const playback = state.playback;
    if (!playback || !isVideoId(playback.videoId)) return;
    const playing = playback.state === 1;
    const now = performance.now();
    const position =
      playback.position +
      (playing ? (now - receivedAt + this.transitMs) / 1000 : 0);
    if (!Number.isFinite(position)) return;
    if (this.player.getVideoData()?.video_id !== playback.videoId) {
      const request = this.guestMediaRequest;
      if (
        request?.entryId === playback.entryId &&
        now - request.startedAt < 3000
      )
        return;
      // The confirmed track can load while its queue rows are fetched.
      this.settleGuestControls();
      this.guestMediaRequest = { entryId: playback.entryId, startedAt: now };
      this.appliedEntryId = undefined;
      this.expectedSeek = undefined;
      this.expectedPlayerStates.clear();
      const quality: string = this.player.getUserPlaybackQualityPreference();
      if (playing)
        this.player.loadVideoById(playback.videoId, position, quality);
      else this.player.cueVideoById(playback.videoId, position, quality);
      return;
    }

    this.guestMediaRequest = undefined;
    const error = Math.abs(position - this.player.getCurrentTime());
    const explicitSeek =
      this.appliedEntryId !== playback.entryId ||
      playback.seekRevision !== this.appliedSeekRevision;
    this.appliedEntryId = playback.entryId;
    this.appliedSeekRevision = playback.seekRevision;
    if (error > (explicitSeek ? 0.1 : 0.75)) {
      const duration = this.player.getDuration();
      const target = duration > 0 ? Math.min(position, duration) : position;
      this.expectedSeek = {
        entryId: playback.entryId,
        position: target,
        expiresAt: now + 2000,
      };
      this.player.seekTo(target);
    }
    const currentState = this.player.getPlayerState();
    if (
      currentState !== playback.state &&
      (playing ? currentState !== 3 : currentState === 1)
    ) {
      this.expectedPlayerStates.set(playback.state, now);
      if (playing) this.player.playVideo();
      else this.player.pauseVideo();
    }
  }

  private selectHostTrack(index: number, entry: VideoData, position: number) {
    const now = performance.now();
    if (this.selectingEntry?.entryId !== entry.entryId) {
      this.selectingEntry = { entryId: entry.entryId, startedAt: now };
      this.queue.setIndex(index);
    } else if (now - this.selectingEntry.startedAt >= 3000) {
      this.selectingEntry.startedAt = now;
      if (index !== this.queue.selectedIndex) this.queue.setIndex(index);
      if (!this.isLoaded(entry)) {
        this.player.loadVideoById(
          entry.videoId,
          position,
          this.player.getUserPlaybackQualityPreference(),
        );
      }
    }
  }

  onPlayerChange(loaded = false) {
    if (!this.active) return;
    if (this.connection.mode === 'host') {
      const navigation = this.hostNavigation;
      if (loaded && navigation) {
        const videoId = this.player.getVideoData()?.video_id;
        if (
          videoId &&
          (!navigation.videoId ||
            videoId === navigation.videoId ||
            videoId !== navigation.previousVideoId)
        ) {
          navigation.loaded = true;
        }
      }
      this.publishState();
    } else {
      this.reconcileGuest();
    }
  }

  private settleGuestControls() {
    this.guestControlsSettleUntil = performance.now() + 1500;
  }

  toggleGuestPlayback() {
    const playback = this.latest?.state.playback;
    if (playback) {
      this.command({
        kind: 'playback',
        entryId: playback.entryId,
        state: playback.state === 1 ? 2 : 1,
      });
    }
  }

  onPlayPause() {
    if (!this.active) return;
    if (this.connection.mode === 'host') {
      this.publishState();
      return;
    }
    if (
      this.syncingPlayback ||
      performance.now() < this.guestControlsSettleUntil
    ) {
      this.reconcileGuest();
      return;
    }
    const playback = this.latest?.state.playback;
    const entry = this.queue.videoList[this.queue.selectedIndex];
    const state = this.player.getPlayerState();
    const expectedAt = this.expectedPlayerStates.get(state);
    this.expectedPlayerStates.delete(state);
    if (expectedAt !== undefined && performance.now() - expectedAt < 2000) {
      this.reconcileGuest();
      return;
    }
    if (
      !entry ||
      !playback ||
      playback.entryId !== entry.entryId ||
      this.guestMediaRequest ||
      this.guestQueueRevision !== this.latest?.state.queueRevision ||
      this.appliedEntryId !== entry.entryId ||
      !this.isLoaded(entry) ||
      state === playback.state ||
      (state !== 1 && state !== 2)
    )
      return;
    if (this.getPermission() === 'all') {
      this.command({ kind: 'playback', entryId: entry.entryId, state });
    } else {
      this.reconcileGuest();
    }
  }

  onSeek() {
    if (!this.active) return;
    if (this.connection.mode === 'host') {
      const pending = this.hostSeek;
      this.enqueue(async () => {
        if (this.hostSeek === pending) this.hostSeek = undefined;
        if (
          !pending ||
          Math.abs(this.player.getCurrentTime() - pending.position) > 1
        ) {
          this.seekRevision++;
        }
        await this.publish(false);
      });
      return;
    }
    const entry = this.queue.videoList[this.queue.selectedIndex];
    const position = this.player.getCurrentTime();
    const expected = this.expectedSeek;
    if (expected && performance.now() >= expected.expiresAt)
      this.expectedSeek = undefined;
    else if (
      expected &&
      expected.entryId === entry?.entryId &&
      Math.abs(position - expected.position) < 1
    ) {
      this.expectedSeek = undefined;
      return;
    }
    if (
      this.syncingPlayback ||
      performance.now() < this.guestControlsSettleUntil
    )
      return;
    if (
      !entry ||
      this.guestMediaRequest ||
      this.guestQueueRevision !== this.latest?.state.queueRevision ||
      this.appliedEntryId !== entry.entryId ||
      this.latest?.state.playback?.entryId !== entry.entryId ||
      !this.isLoaded(entry)
    )
      return;
    this.expectedSeek = undefined;
    if (this.getPermission() === 'all') {
      this.command({ kind: 'playback', entryId: entry.entryId, position });
    } else {
      this.appliedSeekRevision = -1;
      this.reconcileGuest();
    }
  }
}
