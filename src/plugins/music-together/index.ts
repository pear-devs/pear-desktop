import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import promptOptions from '@/providers/prompt-options';
import { waitForElement } from '@/utils/wait-for-element';

import {
  getDefaultProfile,
  type Permission,
  type Profile,
  type VideoData,
} from './types';
import { Queue } from './queue';
import { Connection, type ConnectionEventUnion } from './connection';
import { createHostPopup } from './ui/host';
import { createGuestPopup } from './ui/guest';
import { createSettingPopup } from './ui/setting';

import settingHTML from './templates/setting.html?raw';
import style from './style.css?inline';

import type { DataConnection } from 'peerjs';
import type { MusicPlayer } from '@/types/music-player';
import type { RendererContext } from '@/types/contexts';
import type { VideoDataChanged } from '@/types/video-data-changed';
import type { AppElement } from '@/types/queue';

type RawAccountData = {
  accountName: {
    runs: { text: string }[];
  };
  accountPhoto: {
    thumbnails: { url: string; width: number; height: number }[];
  };
  settingsEndpoint: unknown;
  manageAccountTitle: unknown;
  trackingParams: string;
  channelHandle: {
    runs: { text: string }[];
  };
};

export default createPlugin<
  unknown,
  unknown,
  {
    connection?: Connection;
    ipc?: RendererContext<never>['ipc'];
    api: AppElement | null;
    queue?: Queue;
    playerApi?: MusicPlayer;
    showPrompt: (title: string, label: string) => Promise<string>;
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
    updateNext: boolean;
    ignoreChange: boolean;
    rollbackInjector?: () => void;
    me?: Omit<Profile, 'id'>;
    profiles: Record<string, Profile>;
    permission: Permission;
    videoChangeListener: (
      event: CustomEvent<VideoDataChanged>,
    ) => Promise<void>;
    videoStateChangeListener: () => Promise<void>;
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
  backend({ ipc }) {
    ipc.handle('music-together:prompt', async (title: string, label: string) =>
      prompt({
        title,
        label,
        type: 'input',
        ...promptOptions(),
      }),
    );
  },
  renderer: {
    updateNext: false,
    ignoreChange: false,
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
    showPrompt: () => Promise.resolve(''),
    api: null,

    /* events */
    async videoChangeListener(event: CustomEvent<VideoDataChanged>) {
      if (event.detail.name === 'dataloaded' || this.updateNext) {
        if (this.connection?.mode === 'host') {
          const videoList: VideoData[] =
            this.queue?.flatItems.map(
              (it, index) =>
                ({
                  videoId: it!.videoId,
                  ownerId:
                    this.queue?.videoList[index]?.ownerId ??
                    this.connection!.id,
                }) satisfies VideoData,
            ) ?? [];

          this.queue?.setVideoList(videoList, false);
          this.queue?.syncQueueOwner();
          await this.connection.broadcast('SYNC_QUEUE', {
            videoList,
          });

          this.updateNext = event.detail.name === 'dataloaded';
        }
      }
    },

    async videoStateChangeListener() {
      if (this.connection?.mode !== 'guest') return;
      if (this.ignoreChange) return;
      if (this.permission !== 'all') return;

      const state = this.playerApi?.getPlayerState();
      if (state !== 1 && state !== 2) return;

      await this.connection.broadcast('SYNC_PROGRESS', {
        // progress: this.playerApi?.getCurrentTime(),
        state: this.playerApi?.getPlayerState(),
        // index: this.queue?.selectedIndex ?? 0,
      });
    },

    /* connection */
    async onHost() {
      this.connection = new Connection();
      const wait = await this.connection.waitForReady().catch(() => null);
      if (!wait) return false;

      if (!this.me) this.me = getDefaultProfile(this.connection.id);

      this.profiles = {};
      this.putProfile(this.connection.id, {
        id: this.connection.id,
        ...this.me,
      });

      this.queue?.setOwner({
        id: this.connection.id,
        ...this.me,
      });
      const rawItems =
        this.queue?.flatItems?.map(
          (it) =>
            ({
              videoId: it!.videoId,
              ownerId: this.connection!.id,
            }) satisfies VideoData,
        ) ?? [];
      this.queue?.setVideoList(rawItems, false);
      this.queue?.syncQueueOwner();
      this.queue?.initQueue();
      this.queue?.injection();

      this.connection.onConnections((connection) => {
        if (!connection) {
          this.api?.toastService?.show(
            t('plugins.music-together.toast.disconnected'),
          );
          this.onStop();
          return;
        }

        if (!connection.open) {
          this.api?.toastService?.show(
            t('plugins.music-together.toast.user-disconnected', {
              name: this.profiles[connection.peer]?.name,
            }),
          );
          this.putProfile(connection.peer, undefined);
        }
      });

      const listener = async (
        event: ConnectionEventUnion,
        conn?: DataConnection | null,
      ) => {
        this.ignoreChange = true;

        switch (event.type) {
          case 'CLEAR_QUEUE': {
            if (conn && this.permission === 'host-only') {
              await this.connection?.broadcast('SYNC_QUEUE', {
                videoList: this.queue?.videoList ?? [],
              });
              return;
            }

            this.queue?.clear();
            await this.connection?.broadcast('CLEAR_QUEUE', null);
            break;
          }
          case 'SET_INDEX': {
            this.queue?.setIndex(event.payload.index);
            await this.connection?.broadcast('SET_INDEX', {
              index: event.payload.index,
            });
            break;
          }
          case 'ADD_SONGS': {
            if (conn && this.permission === 'host-only') {
              await this.connection?.broadcast('SYNC_QUEUE', {
                videoList: this.queue?.videoList ?? [],
              });
              return;
            }

            const videoList: VideoData[] = event.payload.videoList.map(
              (it) => ({
                ...it,
                ownerId: it.ownerId ?? conn?.peer ?? this.connection!.id,
              }),
            );

            await this.queue?.addVideos(videoList, event.payload.index);
            await this.connection?.broadcast(
              'ADD_SONGS',
              {
                ...event.payload,
                videoList,
              },
              event.after,
            );

            const afterevent = event.after?.at(0);
            if (afterevent?.type === 'SET_INDEX') {
              this.queue?.setIndex(afterevent.payload.index);
            }

            break;
          }
          case 'REMOVE_SONG': {
            if (conn && this.permission === 'host-only') {
              await this.connection?.broadcast('SYNC_QUEUE', {
                videoList: this.queue?.videoList ?? [],
              });
              return;
            }

            this.queue?.removeVideo(event.payload.index);
            await this.connection?.broadcast('REMOVE_SONG', event.payload);
            break;
          }
          case 'MOVE_SONG': {
            if (conn && this.permission === 'host-only') {
              await this.connection?.broadcast('SYNC_QUEUE', {
                videoList: this.queue?.videoList ?? [],
              });
              break;
            }

            this.queue?.moveItem(
              event.payload.fromIndex,
              event.payload.toIndex,
            );
            await this.connection?.broadcast('MOVE_SONG', event.payload);
            break;
          }
          case 'IDENTIFY': {
            if (!event.payload || !conn) {
              console.warn(
                'Music Together [Host]: Received "IDENTIFY" event without payload or connection',
              );
              break;
            }

            this.api?.toastService?.show(
              t('plugins.music-together.toast.user-connected', {
                name: event.payload.profile.name,
              }),
            );
            this.putProfile(conn.peer, event.payload.profile);
            break;
          }
          case 'SYNC_PROFILE': {
            await this.connection?.broadcast('SYNC_PROFILE', {
              profiles: this.profiles,
            });

            break;
          }
          case 'PERMISSION': {
            await this.connection?.broadcast('PERMISSION', this.permission);
            this.popups.guest.setPermission(this.permission);
            this.popups.host.setPermission(this.permission);
            this.popups.setting.setPermission(this.permission);
            break;
          }
          case 'SYNC_QUEUE': {
            await this.connection?.broadcast('SYNC_QUEUE', {
              videoList: this.queue?.videoList ?? [],
            });
            break;
          }
          case 'SYNC_PROGRESS': {
            let permissionLevel = 0;
            if (this.permission === 'all') permissionLevel = 2;
            if (this.permission === 'playlist') permissionLevel = 1;
            if (this.permission === 'host-only') permissionLevel = 0;
            if (!conn) permissionLevel = 3;

            if (permissionLevel >= 2) {
              if (typeof event.payload?.progress === 'number') {
                const currentTime = this.playerApi?.getCurrentTime() ?? 0;
                if (Math.abs(event.payload.progress - currentTime) > 3)
                  this.playerApi?.seekTo(event.payload.progress);
              }
              if (this.playerApi?.getPlayerState() !== event.payload?.state) {
                if (event.payload?.state === 2) this.playerApi?.pauseVideo();
                if (event.payload?.state === 1) this.playerApi?.playVideo();
              }
            }
            if (permissionLevel >= 1) {
              if (typeof event.payload?.index === 'number') {
                const nowIndex = this.queue?.selectedIndex ?? 0;

                if (nowIndex !== event.payload.index) {
                  this.queue?.setIndex(event.payload.index);
                }
              }
            }

            break;
          }
          case 'CONNECTION_CLOSED': {
            this.queue?.off(listener);
            break;
          }
          default: {
            console.warn('Music Together [Host]: Unknown Event', event);
            break;
          }
        }

        if (event.after) {
          const now = event.after.shift();
          if (now) {
            now.after = event.after;
            await listener(now, conn);
          }
        }
      };
      this.connection.on(listener);
      this.queue?.on(listener);

      setTimeout(() => {
        this.ignoreChange = false;
      }, 16); // wait 1 frame
      return true;
    },

    async onJoin() {
      this.connection = new Connection();
      const wait = await this.connection.waitForReady().catch(() => null);
      if (!wait) return false;

      this.profiles = {};

      const id = await this.showPrompt(
        t('plugins.music-together.name'),
        t('plugins.music-together.dialog.enter-host'),
      );
      if (typeof id !== 'string') return false;

      const connection = await this.connection.connect(id).catch(() => false);
      if (!connection) return false;
      this.connection.onConnections((connection) => {
        if (!connection?.open) {
          this.api?.toastService?.show(
            t('plugins.music-together.toast.disconnected'),
          );
          this.onStop();
        }
      });

      let resolveIgnore: number | null = null;
      const queueListener = async (event: ConnectionEventUnion) => {
        this.ignoreChange = true;
        switch (event.type) {
          case 'CLEAR_QUEUE': {
            await this.connection?.broadcast('CLEAR_QUEUE', null);
            break;
          }
          case 'SET_INDEX': {
            await this.connection?.broadcast('SET_INDEX', {
              index: event.payload.index,
            });
            break;
          }
          case 'ADD_SONGS': {
            await this.connection?.broadcast(
              'ADD_SONGS',
              {
                ...event.payload,
                videoList: event.payload.videoList.map((it) => ({
                  ...it,
                  ownerId: it.ownerId ?? this.connection!.id,
                })),
              },
              event.after,
            );
            break;
          }
          case 'REMOVE_SONG': {
            await this.connection?.broadcast('REMOVE_SONG', event.payload);
            break;
          }
          case 'MOVE_SONG': {
            await this.connection?.broadcast('MOVE_SONG', event.payload);
            break;
          }
          case 'SYNC_PROGRESS': {
            if (this.permission === 'host-only')
              await this.connection?.broadcast('SYNC_QUEUE', undefined);
            else
              await this.connection?.broadcast('SYNC_PROGRESS', event.payload);
            break;
          }
        }

        if (typeof resolveIgnore === 'number') clearTimeout(resolveIgnore);
        resolveIgnore = window.setTimeout(() => {
          this.ignoreChange = false;
        }, 16); // wait 1 frame
      };
      const listener = async (event: ConnectionEventUnion) => {
        this.ignoreChange = true;
        switch (event.type) {
          case 'CLEAR_QUEUE': {
            this.queue?.clear();
            break;
          }
          case 'SET_INDEX': {
            this.queue?.setIndex(event.payload.index);
            break;
          }
          case 'ADD_SONGS': {
            const videoList: VideoData[] = event.payload.videoList.map(
              (it) => ({
                ...it,
                ownerId: it.ownerId ?? this.connection!.id,
              }),
            );

            await this.queue?.addVideos(videoList, event.payload.index);

            const afterevent = event.after?.at(0);
            if (afterevent?.type === 'SET_INDEX') {
              this.queue?.setIndex(afterevent.payload.index);
            }

            break;
          }
          case 'REMOVE_SONG': {
            this.queue?.removeVideo(event.payload.index);
            break;
          }
          case 'MOVE_SONG': {
            this.queue?.moveItem(
              event.payload.fromIndex,
              event.payload.toIndex,
            );
            break;
          }
          case 'IDENTIFY': {
            console.warn(
              'Music Together [Guest]: Received "IDENTIFY" event from guest',
            );
            break;
          }
          case 'SYNC_QUEUE': {
            if (Array.isArray(event.payload?.videoList)) {
              await this.queue?.setVideoList(event.payload.videoList);
            }
            break;
          }
          case 'SYNC_PROFILE': {
            if (!event.payload) {
              console.warn(
                'Music Together [Guest]: Received "SYNC_PROFILE" event without payload',
              );
              break;
            }

            Object.entries(event.payload.profiles).forEach(([id, profile]) => {
              this.putProfile(id, profile);
            });
            break;
          }
          case 'SYNC_PROGRESS': {
            if (typeof event.payload?.progress === 'number') {
              const currentTime = this.playerApi?.getCurrentTime() ?? 0;
              if (Math.abs(event.payload.progress - currentTime) > 3)
                this.playerApi?.seekTo(event.payload.progress);
            }
            if (this.playerApi?.getPlayerState() !== event.payload?.state) {
              if (event.payload?.state === 2) this.playerApi?.pauseVideo();
              if (event.payload?.state === 1) this.playerApi?.playVideo();
            }
            if (typeof event.payload?.index === 'number') {
              const nowIndex = this.queue?.selectedIndex ?? 0;

              if (nowIndex !== event.payload.index) {
                this.queue?.setIndex(event.payload.index);
              }
            }
            break;
          }
          case 'PERMISSION': {
            if (!event.payload) {
              console.warn(
                'Music Together [Guest]: Received "PERMISSION" event without payload',
              );
              break;
            }

            this.permission = event.payload;
            this.popups.guest.setPermission(this.permission);
            this.popups.host.setPermission(this.permission);
            this.popups.setting.setPermission(this.permission);

            const permissionLabel = t(
              `plugins.music-together.menu.permission.${this.permission}`,
            );

            this.api?.toastService?.show(
              t('plugins.music-together.toast.permission-changed', {
                permission: permissionLabel,
              }),
            );
            break;
          }
          case 'CONNECTION_CLOSED': {
            this.queue?.off(queueListener);
            break;
          }
          default: {
            console.warn('Music Together [Guest]: Unknown Event', event);
            break;
          }
        }

        if (typeof resolveIgnore === 'number') clearTimeout(resolveIgnore);
        resolveIgnore = window.setTimeout(() => {
          this.ignoreChange = false;
        }, 16); // wait 1 frame
      };

      this.connection.on(listener);
      this.queue?.on(queueListener);

      if (!this.me) this.me = getDefaultProfile(this.connection.id);
      this.queue?.injection();
      this.queue?.setOwner({
        id: this.connection.id,
        ...this.me,
      });

      const progress = Array.from(
        document.querySelectorAll<
          HTMLElement & {
            _update: (...args: unknown[]) => void;
          }
        >('tp-yt-paper-progress'),
      );
      const rollbackList = progress.map((progress) => {
        const original = progress._update;
        progress._update = (...args) => {
          const now = args[0];

          if (this.permission === 'all' && typeof now === 'number') {
            const currentTime = this.playerApi?.getCurrentTime() ?? 0;
            if (Math.abs(now - currentTime) > 3)
              this.connection?.broadcast('SYNC_PROGRESS', {
                progress: now,
                state: this.playerApi?.getPlayerState(),
              });
          }

          original.call(progress, ...args);
        };

        return () => {
          progress._update = original;
        };
      });
      this.rollbackInjector = () => {
        rollbackList.forEach((rollback) => rollback());
      };

      await this.connection.broadcast('IDENTIFY', {
        profile: {
          id: this.connection.id,
          handleId: this.me.handleId,
          name: this.me.name,
          thumbnail: this.me.thumbnail,
        },
      });

      await this.connection.broadcast('SYNC_PROFILE', undefined);
      await this.connection.broadcast('PERMISSION', undefined);

      this.queue?.clear();
      this.queue?.syncQueueOwner();
      this.queue?.initQueue();

      await this.connection.broadcast('SYNC_QUEUE', undefined);

      return true;
    },

    onStop() {
      if (this.connection?.mode !== 'disconnected') {
        this.connection?.disconnect();
      }
      this.queue?.rollbackInjection();
      this.queue?.removeQueueOwner();
      if (this.rollbackInjector) {
        this.rollbackInjector();
        this.rollbackInjector = undefined;
      }

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
      this.ipc = ipc;
      this.showPrompt = (title: string, label: string) =>
        ipc.invoke('music-together:prompt', title, label) as Promise<string>;
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
        if (this.connection?.mode !== 'host') return;
        const index = this.queue?.selectedIndex ?? 0;

        this.connection.broadcast('SYNC_PROGRESS', {
          progress: this.playerApi?.getCurrentTime(),
          state: this.playerApi?.getPlayerState(),
          index,
        });
      }, 1000);

      /* UI */
      const hostPopup = createHostPopup({
        onItemClick: (id) => {
          if (id === 'music-together-close') {
            this.onStop();
            this.api?.toastService?.show(
              t('plugins.music-together.toast.closed'),
            );
            hostPopup.dismiss();
          }

          if (id === 'music-together-copy-id') {
            navigator.clipboard
              .writeText(this.connection?.id ?? '')
              .then(() => {
                this.api?.toastService?.show(
                  t('plugins.music-together.toast.id-copied'),
                );
                hostPopup.dismiss();
              })
              .catch(() => {
                this.api?.toastService?.show(
                  t('plugins.music-together.toast.id-copy-failed'),
                );
                hostPopup.dismiss();
              });
          }

          if (id === 'music-together-permission') {
            if (this.permission === 'all') this.permission = 'host-only';
            else if (this.permission === 'playlist') this.permission = 'all';
            else if (this.permission === 'host-only')
              this.permission = 'playlist';
            this.connection?.broadcast('PERMISSION', this.permission);

            hostPopup.setPermission(this.permission);
            guestPopup.setPermission(this.permission);
            settingPopup.setPermission(this.permission);

            const permissionLabel = t(
              `plugins.music-together.menu.permission.${this.permission}`,
            );
            this.api?.toastService?.show(
              t('plugins.music-together.toast.permission-changed', {
                permission: permissionLabel,
              }),
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
            this.api?.toastService?.show(
              t('plugins.music-together.toast.disconnected'),
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
                  this.api?.toastService?.show(
                    t('plugins.music-together.toast.id-copied'),
                  );
                  hostPopup.showAtAnchor(setting);
                })
                .catch(() => {
                  this.api?.toastService?.show(
                    t('plugins.music-together.toast.id-copy-failed'),
                  );
                  hostPopup.showAtAnchor(setting);
                });
            } else {
              this.api?.toastService?.show(
                t('plugins.music-together.toast.host-failed'),
              );
            }
          }

          if (id === 'music-together-join') {
            settingPopup.dismiss();
            this.showSpinner();
            const result = await this.onJoin();
            this.hideSpinner();

            if (result) {
              this.api?.toastService?.show(
                t('plugins.music-together.toast.joined'),
              );
              guestPopup.showAtAnchor(setting);
            } else {
              this.api?.toastService?.show(
                t('plugins.music-together.toast.join-failed'),
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
      this.queue = new Queue({
        owner: {
          id: this.connection?.id ?? '',
          ...this.me!,
        },
        getProfile: (id) => this.profiles[id],
      });
      this.playerApi = playerApi;

      this.playerApi.addEventListener(
        'onStateChange',
        this.videoStateChangeListener,
      );
      document.addEventListener('videodatachange', this.videoChangeListener);
    },
    stop() {
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
      if (this.videoChangeListener)
        document.removeEventListener(
          'videodatachange',
          this.videoChangeListener,
        );
    },
  },
});
