import prompt from 'custom-electron-prompt';
import { app, type BrowserWindow, type Event as ElectronEvent } from 'electron';

import { t } from '@/i18n';
import { createAddToToastAction } from '@/plugins/utils/renderer';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { Connection } from './connection';
import { Queue } from './queue';
import { Session } from './session';
import style from './style.css?inline';
import settingHTML from './templates/setting.html?raw';
import { getDefaultProfile, type Permission, type Profile } from './types';
import { createGuestPopup } from './ui/guest';
import { createHostPopup } from './ui/host';
import { createSettingPopup } from './ui/setting';

import type { RemoveFailure } from './session-protocol';
import type { ItemPlaylistPanelVideoRenderer } from '@/types/datahost-get-state';
import type { MusicPlayer } from '@/types/music-player';
import type { AppElement } from '@/types/queue';
import type { VideoDataChanged } from '@/types/video-data-changed';

type RawAccountData = {
  accountName: {
    runs: { text: string }[];
  };
  accountPhoto: {
    thumbnails: { url: string; width: number; height: number }[];
  };
  channelHandle: {
    runs: { text: string }[];
  };
};

type WatchEndpoint = {
  watchEndpoint?: { videoId?: string; playlistId?: string; params?: string };
  watchPlaylistEndpoint?: { playlistId?: string; params?: string };
};

type MusicActionElement = HTMLElement & {
  state?: string;
  data?: {
    playNavigationEndpoint?: WatchEndpoint;
    serviceEndpoint?: {
      removeFromQueueEndpoint?: unknown;
      queueAddEndpoint?: {
        queueTarget?: { videoId?: string; playlistId?: string };
        queueInsertPosition?: string;
      };
    };
  };
};

type JoinPrompt = { token: string; window: BrowserWindow };

const hasWatchTarget = (endpoint?: WatchEndpoint) =>
  Boolean(endpoint?.watchEndpoint || endpoint?.watchPlaylistEndpoint);

const findMusicAction = (
  path: EventTarget[],
  matches: (node: MusicActionElement) => boolean,
) =>
  path.find(
    (target): target is MusicActionElement =>
      target instanceof HTMLElement && matches(target),
  );

const dismissMusicMenu = (item?: HTMLElement) => {
  item?.closest('tp-yt-iron-dropdown')?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
    }),
  );
};

export default createPlugin<
  {
    joinPrompt?: JoinPrompt;
    closeJoinPrompt: () => void;
  },
  unknown,
  {
    connection?: Connection;
    api: AppElement | null;
    queue?: Queue;
    playerApi?: MusicPlayer;
    pluginLifecycleToken?: string;
    pendingJoinPrompt?: string;
    showPrompt: (
      token: string,
      title: string,
      label: string,
    ) => Promise<string | null>;
    popups: {
      host: ReturnType<typeof createHostPopup>;
      guest: ReturnType<typeof createGuestPopup>;
      setting: ReturnType<typeof createSettingPopup>;
    };
    elements: {
      setting: HTMLElement;
      icon: SVGElement;
      spinner: HTMLElement;
    };
    stateInterval?: number;
    session?: Session;
    me?: Omit<Profile, 'id'>;
    profiles: Record<string, Profile>;
    permission: Permission;
    videoChangeListener: (event: CustomEvent<VideoDataChanged>) => void;
    videoStateChangeListener: () => void;
    seekListener: (event: Event) => void;
    handlePlaybackNavigation: (event: Event) => void;
    handleGuestQueueMenu: (event: Event) => boolean;
    handleGuestQueueTrack: (event: Event) => boolean;
    handleGuestPlayerControls: (event: Event) => boolean;
    showRemoveFailure: (reason: RemoveFailure) => void;
    onHost: () => Promise<boolean>;
    onJoin: () => Promise<boolean>;
    onStop: () => void;
    putProfile: (id: string, profile?: Profile) => void;
    showSpinner: () => void;
    hideSpinner: () => void;
    initMyProfile: () => void;
  }
>({
  name: () => t('plugins.music-together.name'),
  description: () => t('plugins.music-together.description'),
  restartNeeded: false,
  addedVersion: '3.2.X',
  config: {
    enabled: false,
  },
  stylesheets: [style],
  backend: {
    start({ ipc }) {
      ipc.handle(
        'music-together:prompt',
        (token: string, title: string, label: string) => {
          if (this.joinPrompt) return null;

          const options = {
            title,
            label,
            type: 'input' as const,
            ...promptOptions(),
          };
          let pending: JoinPrompt | undefined;
          const captureWindow = (
            _event: ElectronEvent,
            window: BrowserWindow,
          ) => {
            pending = { token, window };
            this.joinPrompt = pending;
          };

          // The prompt library creates its window synchronously but only returns the input promise.
          app.prependOnceListener('browser-window-created', captureWindow);
          try {
            return prompt(options).then(
              (id) => {
                if (this.joinPrompt === pending) this.joinPrompt = undefined;
                return id;
              },
              (error: unknown) => {
                if (this.joinPrompt === pending) this.closeJoinPrompt();
                throw error;
              },
            );
          } finally {
            app.off('browser-window-created', captureWindow);
          }
        },
      );
      ipc.handle('music-together:close-prompt', (token: string) => {
        if (this.joinPrompt?.token === token) this.closeJoinPrompt();
      });
    },
    closeJoinPrompt() {
      const pending = this.joinPrompt;
      this.joinPrompt = undefined;
      if (pending && !pending.window.isDestroyed()) pending.window.close();
    },
    stop({ ipc }) {
      ipc.removeHandler('music-together:prompt');
      ipc.removeHandler('music-together:close-prompt');
      this.closeJoinPrompt();
    },
  },
  renderer: {
    permission: 'playlist',
    popups: {} as {
      host: ReturnType<typeof createHostPopup>;
      guest: ReturnType<typeof createGuestPopup>;
      setting: ReturnType<typeof createSettingPopup>;
    },
    elements: {} as {
      setting: HTMLElement;
      icon: SVGElement;
      spinner: HTMLElement;
    },
    profiles: {},
    showPrompt: () => Promise.resolve(null),
    api: null,

    videoChangeListener(event) {
      if (
        event.detail.name === 'dataloaded' ||
        event.detail.name === 'dataupdated'
      ) {
        this.session?.onPlayerChange(event.detail.name === 'dataloaded');
      }
    },

    videoStateChangeListener() {
      this.session?.onPlayPause();
    },

    seekListener(event) {
      if (event.target instanceof HTMLVideoElement) this.session?.onSeek();
    },

    handlePlaybackNavigation(event) {
      const mode = this.connection?.mode;
      if (!mode || mode === 'disconnected') return;

      const path = event.composedPath();
      let endpoint: WatchEndpoint | undefined;
      let action: MusicActionElement | undefined;
      if (event.type === 'yt-action') {
        const detail = (
          event as CustomEvent<{
            actionName?: string;
            args?: [WatchEndpoint, ...unknown[]];
          }>
        ).detail;
        if (
          detail?.actionName !== 'yt-watch-endpoint' &&
          detail?.actionName !== 'yt-watch-playlist-endpoint'
        )
          return;
        endpoint = detail.args?.[0];
      } else if (event.type === 'yt-navigate') {
        const detail = (
          event as CustomEvent<{
            endpoint?: WatchEndpoint;
            musicEndpoint?: WatchEndpoint;
          }>
        ).detail;
        endpoint = hasWatchTarget(detail?.endpoint)
          ? detail?.endpoint
          : detail?.musicEndpoint;
      } else if (event.type === 'click') {
        if (
          mode === 'guest' &&
          (this.handleGuestPlayerControls(event) ||
            this.handleGuestQueueMenu(event) ||
            this.handleGuestQueueTrack(event))
        )
          return;

        action = findMusicAction(path, (element) =>
          hasWatchTarget(element.data?.playNavigationEndpoint),
        );
        endpoint = action?.data?.playNavigationEndpoint;
        if (!endpoint) {
          if (
            mode !== 'guest' ||
            this.permission !== 'host-only' ||
            !path.some(
              (element) =>
                element instanceof HTMLAnchorElement &&
                element.origin === location.origin &&
                element.pathname === '/watch',
            )
          )
            return;
        } else if (
          this.permission !== 'host-only' &&
          action?.state === 'playing' &&
          !(
            endpoint.watchEndpoint?.playlistId ??
            endpoint.watchPlaylistEndpoint?.playlistId
          )?.startsWith('RD')
        ) {
          return;
        }
      } else {
        return;
      }

      if (this.queue?.containsEventPath(path)) return;
      if (mode === 'host') {
        if (hasWatchTarget(endpoint)) {
          this.session?.onHostNavigation(
            endpoint?.watchEndpoint?.videoId,
            endpoint?.watchEndpoint?.playlistId ??
              endpoint?.watchPlaylistEndpoint?.playlistId,
          );
        }
        return;
      }

      const videoId = endpoint?.watchEndpoint?.videoId;
      const playlistId =
        endpoint?.watchEndpoint?.playlistId ??
        endpoint?.watchPlaylistEndpoint?.playlistId;
      const params =
        endpoint?.watchEndpoint?.params ??
        endpoint?.watchPlaylistEndpoint?.params;
      if (
        !videoId &&
        !playlistId &&
        !(event.type === 'click' && this.permission === 'host-only')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.permission === 'host-only') {
        this.api?.handleAddToToastAction?.(
          createAddToToastAction(
            t('plugins.music-together.menu.permission.host-only'),
          ),
        );
      } else {
        this.session?.command({
          kind: 'navigate',
          ...(videoId ? { videoId } : {}),
          ...(playlistId ? { playlistId } : {}),
          ...(params ? { params } : {}),
        });
      }
      dismissMusicMenu(action);
    },

    handleGuestPlayerControls(event) {
      const control = event
        .composedPath()
        .find(
          (target): target is HTMLElement =>
            target instanceof HTMLElement &&
            target.matches(
              'ytmusic-player-bar #play-pause-button, ytmusic-player-bar .next-button',
            ),
        );
      if (!control) return false;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (control.id === 'play-pause-button') {
        if (this.permission === 'all') this.session?.toggleGuestPlayback();
      } else if (this.permission !== 'host-only') {
        this.session?.command({ kind: 'next' });
      }
      return true;
    },

    handleGuestQueueTrack(event) {
      const path = event.composedPath();
      if (
        (this.queue?.handlesNativeSelection &&
          this.permission !== 'host-only') ||
        !this.queue?.containsEventPath(path)
      )
        return false;
      const items = this.queue.flatItems;
      const row = path.find(
        (
          target,
        ): target is HTMLElement & { data: ItemPlaylistPanelVideoRenderer } =>
          target instanceof HTMLElement &&
          'data' in target &&
          items.some((item) => item && item === target.data),
      );
      if (!row) return false;
      const playButton = findMusicAction(path, (node) =>
        hasWatchTarget(node.data?.playNavigationEndpoint),
      );
      const clickedTrack =
        playButton ||
        event.target === row ||
        path.some(
          (target) =>
            target instanceof HTMLAnchorElement &&
            target.origin === location.origin &&
            target.pathname === '/watch',
        );
      if (
        !clickedTrack ||
        (playButton?.state === 'playing' && this.permission === 'all')
      )
        return false;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.permission === 'host-only') {
        this.api?.handleAddToToastAction?.(
          createAddToToastAction(
            t('plugins.music-together.menu.permission.host-only'),
          ),
        );
      } else {
        const index = items.indexOf(row.data);
        const entry = this.queue?.videoList[index];
        if (entry && entry.videoId === row.data?.videoId) {
          this.session?.command({ kind: 'select', entryId: entry.entryId });
        }
      }
      return true;
    },

    handleGuestQueueMenu(event) {
      const item = findMusicAction(event.composedPath(), (node) => {
        const endpoint = node.data?.serviceEndpoint;
        return Boolean(
          endpoint?.queueAddEndpoint ||
          (this.permission === 'host-only' &&
            endpoint?.removeFromQueueEndpoint),
        );
      });
      if (
        this.permission === 'host-only' &&
        item?.data?.serviceEndpoint?.removeFromQueueEndpoint
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.showRemoveFailure('permission');
        dismissMusicMenu(item);
        return true;
      }
      const endpoint = item?.data?.serviceEndpoint?.queueAddEndpoint;
      const videoId = endpoint?.queueTarget?.videoId;
      const playlistId = endpoint?.queueTarget?.playlistId;
      const position = endpoint?.queueInsertPosition;
      if (
        (!videoId && !playlistId) ||
        (position !== 'INSERT_AFTER_CURRENT_VIDEO' &&
          position !== 'INSERT_AT_END')
      ) {
        return false;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.permission === 'host-only') {
        this.api?.handleAddToToastAction?.(
          createAddToToastAction(
            t('plugins.music-together.menu.permission.host-only'),
          ),
        );
      } else {
        this.session?.command({
          kind: 'queue-media',
          ...(videoId ? { videoId } : { playlistId: playlistId! }),
          placement: position === 'INSERT_AFTER_CURRENT_VIDEO' ? 'next' : 'end',
        });
      }
      dismissMusicMenu(item);
      return true;
    },

    showRemoveFailure(reason) {
      this.api?.handleAddToToastAction?.(
        createAddToToastAction(
          t(
            reason === 'permission'
              ? 'plugins.music-together.menu.permission.host-only'
              : 'plugins.music-together.toast.remove-song-failed',
          ),
        ),
      );
    },

    async onHost() {
      if (!this.playerApi || this.connection) return false;
      if (!this.queue?.isReady) {
        this.queue = new Queue((id) => this.profiles[id]);
        if (!this.queue.isReady) return false;
      }
      const connection = new Connection();
      this.connection = connection;
      if (!(await connection.waitForReady().catch(() => null))) {
        if (this.connection === connection) this.onStop();
        return false;
      }
      if (this.connection !== connection) return false;
      this.me ??= getDefaultProfile(connection.id);
      this.profiles = {};
      this.putProfile(connection.id, { ...this.me, id: connection.id });

      const session = new Session(
        connection,
        this.queue,
        this.playerApi,
        () => this.permission,
        (permission) => {
          this.permission = permission;
        },
        (reason) => this.showRemoveFailure(reason),
      );
      this.session = session;
      session.start();

      connection.onConnections((peer) => {
        if (this.connection !== connection) return;
        if (!peer) {
          this.api?.handleAddToToastAction?.(
            createAddToToastAction(
              t('plugins.music-together.toast.disconnected'),
            ),
          );
          this.onStop();
          return;
        }
        if (!peer.open && this.profiles[peer.peer]) {
          this.api?.handleAddToToastAction?.(
            createAddToToastAction(
              t('plugins.music-together.toast.user-disconnected', {
                name: this.profiles[peer.peer].name,
              }),
            ),
          );
          this.putProfile(peer.peer, undefined);
          connection.broadcast('SYNC_PROFILE', {
            profiles: this.profiles,
          });
        }
      });

      connection.on((event, peer) => {
        if (!peer?.open || this.connection !== connection) return;
        if (event.type === 'IDENTIFY') {
          const profile = event.payload?.profile;
          if (
            !profile ||
            typeof profile.name !== 'string' ||
            typeof profile.thumbnail !== 'string' ||
            typeof profile.handleId !== 'string'
          )
            return;
          const joined = !this.profiles[peer.peer];
          this.putProfile(peer.peer, { ...profile, id: peer.peer });
          if (joined) {
            this.api?.handleAddToToastAction?.(
              createAddToToastAction(
                t('plugins.music-together.toast.user-connected', {
                  name: profile.name,
                }),
              ),
            );
          }
          connection.broadcast('SYNC_PROFILE', {
            profiles: this.profiles,
          });
          session.publishState(peer);
        } else if (event.type === 'PING' && Number.isFinite(event.payload)) {
          connection.send(peer, 'PONG', event.payload);
        } else if (event.type === 'REQUEST_STATE') {
          session.publishState(peer);
        } else if (event.type === 'COMMAND') {
          session.command(event.payload, peer);
        }
      });
      return true;
    },

    async onJoin() {
      const token = this.pluginLifecycleToken;
      if (
        !token ||
        this.pendingJoinPrompt ||
        !this.queue ||
        !this.playerApi ||
        this.connection
      ) return false;

      if (!this.queue?.isReady) {
        this.queue = new Queue((id) => this.profiles[id]);
        if (!this.queue.isReady) return false;
      }

      this.pendingJoinPrompt = token;
      const id = await this.showPrompt(
        token,
        t('plugins.music-together.name'),
        t('plugins.music-together.dialog.enter-host'),
      ).catch(() => null);
      if (token !== this.pluginLifecycleToken) return false;
      this.pendingJoinPrompt = undefined;
      if (typeof id !== 'string' || !id.trim() || this.connection) return false;

      const connection = new Connection();
      this.connection = connection;
      const ready = await connection.waitForReady().catch(() => null);
      const host =
        ready && this.connection === connection
          ? await connection.connect(id.trim()).catch(() => null)
          : null;
      if (!host?.open || this.connection !== connection) {
        if (this.connection === connection) this.onStop();
        return false;
      }

      this.profiles = {};
      this.permission = 'host-only';
      this.popups.guest.setPermission(this.permission);
      this.popups.setting.setPermission(this.permission);

      const session = new Session(
        connection,
        this.queue,
        this.playerApi,
        () => this.permission,
        (permission) => {
          this.permission = permission;
          this.popups.guest.setPermission(permission);
          this.popups.host.setPermission(permission);
          this.popups.setting.setPermission(permission);
          const permissionLabel = t(
            `plugins.music-together.menu.permission.${this.permission}`,
          );
          this.api?.handleAddToToastAction?.(
            createAddToToastAction(
              t('plugins.music-together.toast.permission-changed', {
                permission: permissionLabel,
              }),
            ),
          );
        },
        (reason) => this.showRemoveFailure(reason),
      );
      this.session = session;
      session.start();
      let finishJoin!: (joined: boolean) => void;
      const initialState = new Promise<boolean>((resolve) => {
        finishJoin = resolve;
      });
      const joinTimeout = window.setTimeout(() => finishJoin(false), 15_000);
      connection.onConnections((peer) => {
        if (peer?.open) return;
        finishJoin(false);
        if (this.connection !== connection) return;
        this.api?.handleAddToToastAction?.(
          createAddToToastAction(
            t('plugins.music-together.toast.disconnected'),
          ),
        );
        this.onStop();
      });
      connection.on((event, peer) => {
        if (peer !== host || this.connection !== connection) return;
        if (event.type === 'SESSION_STATE') {
          session.receive(event.payload).then((applied) => {
            if (applied && Array.isArray(event.payload?.queue))
              finishJoin(true);
          });
        }
        if (event.type === 'PONG') session.receivePong(event.payload);
        if (event.type === 'QUEUE_REMOVE_FAILED')
          this.showRemoveFailure(event.payload);
        if (event.type === 'QUEUE_ADD_RESULT') {
          this.api?.handleAddToToastAction?.(
            createAddToToastAction(
              t(
                event.payload
                  ? 'plugins.music-together.toast.song-added'
                  : 'plugins.music-together.toast.add-song-failed',
              ),
            ),
          );
        }
        if (event.type === 'SYNC_PROFILE' && event.payload?.profiles) {
          this.profiles = event.payload.profiles;
          this.popups.host.setUsers(Object.values(this.profiles));
          this.popups.guest.setUsers(Object.values(this.profiles));
          this.queue?.syncQueueOwner();
        }
      });
      this.me ??= getDefaultProfile(connection.id);
      session.tick();
      await connection.broadcast('IDENTIFY', {
        profile: { ...this.me, id: connection.id },
      });
      const joined = await initialState;
      clearTimeout(joinTimeout);
      if (!joined && this.connection === connection) this.onStop();
      return joined && this.connection === connection;
    },

    onStop() {
      const connection = this.connection;
      this.connection = undefined;
      this.session?.stop();
      this.session = undefined;
      connection?.disconnect();

      this.profiles = {};
      this.popups.host.setUsers(Object.values(this.profiles));
      this.popups.guest.setUsers(Object.values(this.profiles));

      this.popups.host.dismiss();
      this.popups.guest.dismiss();
      this.popups.setting.dismiss();
    },

    /* methods */
    putProfile(id: string, profile?: Profile) {
      if (profile === undefined) {
        delete this.profiles[id];
      } else {
        this.profiles[id] = profile;
      }

      this.popups.host.setUsers(Object.values(this.profiles));
      this.popups.guest.setUsers(Object.values(this.profiles));
    },

    showSpinner() {
      this.elements.icon.style.setProperty('display', 'none');
      this.elements.spinner.removeAttribute('hidden');
      this.elements.spinner.setAttribute('active', '');
    },

    hideSpinner() {
      this.elements.icon.style.removeProperty('display');
      this.elements.spinner.removeAttribute('active');
      this.elements.spinner.setAttribute('hidden', '');
    },

    async initMyProfile() {
      const accountButton = await waitForElement<HTMLElement>(
        '#right-content > ytmusic-settings-button *:where(tp-yt-paper-icon-button,yt-icon-button,.ytmusic-settings-button)',
        {
          maxRetry: 10000,
        },
      );

      accountButton?.click();
      setTimeout(async () => {
        const renderer = await waitForElement<HTMLElement & { data: unknown }>(
          'ytd-active-account-header-renderer',
          {
            maxRetry: 10000,
          },
        );
        if (!accountButton || !renderer) {
          console.warn('Music Together: Cannot find account');
          this.me = getDefaultProfile(this.connection?.id ?? '');
          return;
        }

        const accountData = renderer.data as RawAccountData;
        this.me = {
          handleId:
            accountData.channelHandle.runs[0].text ??
            accountData.accountName.runs[0].text,
          name: accountData.accountName.runs[0].text,
          thumbnail: accountData.accountPhoto.thumbnails[0].url,
        };

        if (this.me.thumbnail) {
          this.popups.host.setProfile(this.me.thumbnail);
          this.popups.guest.setProfile(this.me.thumbnail);
          this.popups.setting.setProfile(this.me.thumbnail);
        }
        accountButton?.click(); // close menu
      }, 0);
    },
    /* hooks */

    start({ ipc }) {
      this.pluginLifecycleToken = crypto.randomUUID();
      this.showPrompt = (token, title, label) =>
        ipc.invoke('music-together:prompt', token, title, label) as Promise<
          string | null
        >;
      this.api = document.querySelector<AppElement>('ytmusic-app');

      /* setup */
      document
        .querySelector('#right-content > ytmusic-settings-button')
        ?.insertAdjacentHTML('beforebegin', settingHTML);
      const setting = document.querySelector<HTMLElement>(
        '#music-together-setting-button',
      );
      const icon = document.querySelector<SVGElement>(
        '#music-together-setting-button > svg',
      );
      const spinner = document.querySelector<HTMLElement>(
        '#music-together-setting-button > tp-yt-paper-spinner-lite',
      );
      if (!setting || !icon || !spinner) {
        console.warn('Music Together: Cannot inject html');
        console.log(setting, icon, spinner);
        return;
      }

      this.elements = {
        setting,
        icon,
        spinner,
      };

      this.stateInterval = window.setInterval(() => {
        this.session?.tick();
      }, 1000);

      /* UI */
      const hostPopup = createHostPopup({
        onItemClick: (id) => {
          if (id === 'music-together-close') {
            this.onStop();
            this.api?.handleAddToToastAction?.(
              createAddToToastAction(t('plugins.music-together.toast.closed')),
            );
            hostPopup.dismiss();
          }

          if (id === 'music-together-copy-id') {
            navigator.clipboard
              .writeText(this.connection?.id ?? '')
              .then(() => {
                this.api?.handleAddToToastAction?.(
                  createAddToToastAction(
                    t('plugins.music-together.toast.id-copied'),
                  ),
                );
                hostPopup.dismiss();
              })
              .catch(() => {
                this.api?.handleAddToToastAction?.(
                  createAddToToastAction(
                    t('plugins.music-together.toast.id-copy-failed'),
                  ),
                );
                hostPopup.dismiss();
              });
          }

          if (id === 'music-together-permission') {
            if (this.permission === 'all') this.permission = 'host-only';
            else if (this.permission === 'playlist') this.permission = 'all';
            else if (this.permission === 'host-only')
              this.permission = 'playlist';
            this.session?.publishState();

            hostPopup.setPermission(this.permission);
            guestPopup.setPermission(this.permission);
            settingPopup.setPermission(this.permission);

            const permissionLabel = t(
              `plugins.music-together.menu.permission.${this.permission}`,
            );
            this.api?.handleAddToToastAction?.(
              createAddToToastAction(
                t('plugins.music-together.toast.permission-changed', {
                  permission: permissionLabel,
                }),
              ),
            );
            const item = hostPopup.items.find((it) => it?.element.id === id);
            if (item?.type === 'item') {
              item.setText(t('plugins.music-together.menu.set-permission'));
            }
          }
        },
      });
      const guestPopup = createGuestPopup({
        onItemClick: (id) => {
          if (id === 'music-together-disconnect') {
            this.onStop();
            this.api?.handleAddToToastAction?.(
              createAddToToastAction(
                t('plugins.music-together.toast.disconnected'),
              ),
            );
            guestPopup.dismiss();
          }
        },
      });
      const settingPopup = createSettingPopup({
        onItemClick: async (id) => {
          if (id === 'music-together-host') {
            settingPopup.dismiss();
            this.showSpinner();
            const result = await this.onHost();
            this.hideSpinner();

            if (result) {
              navigator.clipboard
                .writeText(this.connection?.id ?? '')
                .then(() => {
                  this.api?.handleAddToToastAction?.(
                    createAddToToastAction(
                      t('plugins.music-together.toast.id-copied'),
                    ),
                  );
                  hostPopup.showAtAnchor(setting);
                })
                .catch(() => {
                  this.api?.handleAddToToastAction?.(
                    createAddToToastAction(
                      t('plugins.music-together.toast.id-copy-failed'),
                    ),
                  );
                  hostPopup.showAtAnchor(setting);
                });
            } else {
              this.api?.handleAddToToastAction?.(
                createAddToToastAction(
                  t('plugins.music-together.toast.host-failed'),
                ),
              );
            }
          }

          if (id === 'music-together-join') {
            const token = this.pluginLifecycleToken;
            if (!token || this.pendingJoinPrompt) return;
            settingPopup.dismiss();
            this.showSpinner();
            const result = await this.onJoin();
            if (token !== this.pluginLifecycleToken) return;
            this.hideSpinner();

            if (result) {
              this.api?.handleAddToToastAction?.(
                createAddToToastAction(
                  t('plugins.music-together.toast.joined'),
                ),
              );
              guestPopup.showAtAnchor(setting);
            } else {
              this.api?.handleAddToToastAction?.(
                createAddToToastAction(
                  t('plugins.music-together.toast.join-failed'),
                ),
              );
            }
          }
        },
      });
      this.popups = {
        host: hostPopup,
        guest: guestPopup,
        setting: settingPopup,
      };
      setting.addEventListener('click', () => {
        let popup = settingPopup;
        if (this.connection?.mode === 'host') popup = hostPopup;
        if (this.connection?.mode === 'guest') popup = guestPopup;

        if (popup.isShowing()) popup.dismiss();
        else popup.showAtAnchor(setting);
      });

      /* account data getter */
      this.initMyProfile();
    },
    onPlayerApiReady(playerApi) {
      this.queue = new Queue((id) => this.profiles[id]);
      this.playerApi = playerApi;

      this.playerApi.addEventListener(
        'onStateChange',
        this.videoStateChangeListener,
      );
      document.addEventListener('videodatachange', this.videoChangeListener);
      document.addEventListener('seeked', this.seekListener, true);
      for (const event of ['click', 'yt-navigate', 'yt-action']) {
        window.addEventListener(event, this.handlePlaybackNavigation, true);
      }
    },
    stop({ ipc }) {
      const pendingPrompt = this.pendingJoinPrompt;
      this.pluginLifecycleToken = undefined;
      this.pendingJoinPrompt = undefined;
      if (pendingPrompt) {
        ipc
          .invoke('music-together:close-prompt', pendingPrompt)
          .catch(() => null);
      }

      const dividers = Array.from(
        document.querySelectorAll('.music-together-divider'),
      );
      dividers.forEach((divider) => divider.remove());

      this.elements.setting?.remove();
      this.onStop();
      if (typeof this.stateInterval === 'number')
        clearInterval(this.stateInterval);
      if (this.playerApi)
        this.playerApi.removeEventListener(
          'onStateChange',
          this.videoStateChangeListener,
        );
      document.removeEventListener('seeked', this.seekListener, true);
      for (const event of ['click', 'yt-navigate', 'yt-action']) {
        window.removeEventListener(event, this.handlePlaybackNavigation, true);
      }
      if (this.videoChangeListener)
        document.removeEventListener(
          'videodatachange',
          this.videoChangeListener,
        );
    },
  },
});
