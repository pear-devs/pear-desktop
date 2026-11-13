import { t } from '@/i18n';
import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { Connection, type ConnectionEventUnion } from './connection';
import { Queue } from './queue';
import settingHTML from './templates/setting.html?raw';
import {
  getDefaultProfile,
  type MusicTogetherIpc,
  type Permission,
  type Profile,
  type VideoData,
} from './types';
import { createGuestPopup } from './ui/guest';
import { createHostPopup } from './ui/host';
import { createSettingPopup } from './ui/setting';

import type { MusicPlayer } from '@/types/music-player';
import type { Empty } from '@/types/plugins';
import type { AppElement } from '@/types/queue';
import type { VideoDataChanged } from '@/types/video-data-changed';
import type { DataConnection } from 'peerjs';

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

export default createRenderer<Empty, MusicTogetherIpc>((ctx) => {
  const state = {
    connection: undefined as Connection | undefined,
    api: null as AppElement | null,
    queue: undefined as Queue | undefined,
    playerApi: undefined as MusicPlayer | undefined,
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
    updateNext: false,
    ignoreChange: false,
    rollbackInjector: undefined as (() => void) | undefined,
    me: undefined as Omit<Profile, 'id'> | undefined,
    profiles: {} as Record<string, Profile>,
    permission: 'playlist' as Permission,
  };

  const showPrompt = (title: string, label: string) =>
    ctx.ipc.invoke('prompt', title, label);

  /* events */
  const videoChangeListener = async (event: CustomEvent<VideoDataChanged>) => {
    if (event.detail.name === 'dataloaded' || state.updateNext) {
      if (state.connection?.mode === 'host') {
        const videoList: VideoData[] =
          state.queue?.flatItems.map(
            (it, index) =>
              ({
                videoId: it!.videoId,
                ownerId:
                  state.queue?.videoList[index]?.ownerId ??
                  state.connection!.id,
              }) satisfies VideoData,
          ) ?? [];

        state.queue?.setVideoList(videoList, false);
        state.queue?.syncQueueOwner();
        await state.connection.broadcast('SYNC_QUEUE', {
          videoList,
        });

        state.updateNext = event.detail.name === 'dataloaded';
      }
    }
  };

  const videoStateChangeListener = async () => {
    if (state.connection?.mode !== 'guest') return;
    if (state.ignoreChange) return;
    if (state.permission !== 'all') return;

    const playerState = state.playerApi?.getPlayerState();
    if (playerState !== 1 && playerState !== 2) return;

    await state.connection.broadcast('SYNC_PROGRESS', {
      // progress: state.playerApi?.getCurrentTime(),
      state: state.playerApi?.getPlayerState(),
      // index: state.queue?.selectedIndex ?? 0,
    });
  };

  /* connection */
  const onHost = async () => {
    state.connection = new Connection();
    const wait = await state.connection.waitForReady().catch(() => null);
    if (!wait || ctx.signal.aborted) return false;

    if (!state.me) state.me = getDefaultProfile(state.connection.id);

    state.profiles = {};
    putProfile(state.connection.id, {
      id: state.connection.id,
      ...state.me,
    });

    state.queue?.setOwner({
      id: state.connection.id,
      ...state.me,
    });
    const rawItems =
      state.queue?.flatItems?.map(
        (it) =>
          ({
            videoId: it!.videoId,
            ownerId: state.connection!.id,
          }) satisfies VideoData,
      ) ?? [];
    state.queue?.setVideoList(rawItems, false);
    state.queue?.syncQueueOwner();
    state.queue?.initQueue();
    state.queue?.injection();

    state.connection.onConnections((connection) => {
      if (!connection) {
        state.api?.toastService?.show(
          t('plugins.music-together.toast.disconnected'),
        );
        onStop();
        return;
      }

      if (!connection.open) {
        state.api?.toastService?.show(
          t('plugins.music-together.toast.user-disconnected', {
            name: state.profiles[connection.peer]?.name,
          }),
        );
        putProfile(connection.peer, undefined);
      }
    });

    const listener = async (
      event: ConnectionEventUnion,
      conn?: DataConnection | null,
    ) => {
      state.ignoreChange = true;

      switch (event.type) {
        case 'CLEAR_QUEUE': {
          if (conn && state.permission === 'host-only') {
            await state.connection?.broadcast('SYNC_QUEUE', {
              videoList: state.queue?.videoList ?? [],
            });
            return;
          }

          state.queue?.clear();
          await state.connection?.broadcast('CLEAR_QUEUE', null);
          break;
        }
        case 'SET_INDEX': {
          state.queue?.setIndex(event.payload.index);
          await state.connection?.broadcast('SET_INDEX', {
            index: event.payload.index,
          });
          break;
        }
        case 'ADD_SONGS': {
          if (conn && state.permission === 'host-only') {
            await state.connection?.broadcast('SYNC_QUEUE', {
              videoList: state.queue?.videoList ?? [],
            });
            return;
          }

          const videoList: VideoData[] = event.payload.videoList.map((it) => ({
            ...it,
            ownerId: it.ownerId ?? conn?.peer ?? state.connection!.id,
          }));

          await state.queue?.addVideos(videoList, event.payload.index);
          await state.connection?.broadcast(
            'ADD_SONGS',
            {
              ...event.payload,
              videoList,
            },
            event.after,
          );

          const afterevent = event.after?.at(0);
          if (afterevent?.type === 'SET_INDEX') {
            state.queue?.setIndex(afterevent.payload.index);
          }

          break;
        }
        case 'REMOVE_SONG': {
          if (conn && state.permission === 'host-only') {
            await state.connection?.broadcast('SYNC_QUEUE', {
              videoList: state.queue?.videoList ?? [],
            });
            return;
          }

          state.queue?.removeVideo(event.payload.index);
          await state.connection?.broadcast('REMOVE_SONG', event.payload);
          break;
        }
        case 'MOVE_SONG': {
          if (conn && state.permission === 'host-only') {
            await state.connection?.broadcast('SYNC_QUEUE', {
              videoList: state.queue?.videoList ?? [],
            });
            break;
          }

          state.queue?.moveItem(event.payload.fromIndex, event.payload.toIndex);
          await state.connection?.broadcast('MOVE_SONG', event.payload);
          break;
        }
        case 'IDENTIFY': {
          if (!event.payload || !conn) {
            console.warn(
              'Music Together [Host]: Received "IDENTIFY" event without payload or connection',
            );
            break;
          }

          state.api?.toastService?.show(
            t('plugins.music-together.toast.user-connected', {
              name: event.payload.profile.name,
            }),
          );
          putProfile(conn.peer, event.payload.profile);
          break;
        }
        case 'SYNC_PROFILE': {
          await state.connection?.broadcast('SYNC_PROFILE', {
            profiles: state.profiles,
          });

          break;
        }
        case 'PERMISSION': {
          await state.connection?.broadcast('PERMISSION', state.permission);
          state.popups.guest.setPermission(state.permission);
          state.popups.host.setPermission(state.permission);
          state.popups.setting.setPermission(state.permission);
          break;
        }
        case 'SYNC_QUEUE': {
          await state.connection?.broadcast('SYNC_QUEUE', {
            videoList: state.queue?.videoList ?? [],
          });
          break;
        }
        case 'SYNC_PROGRESS': {
          let permissionLevel = 0;
          if (state.permission === 'all') permissionLevel = 2;
          if (state.permission === 'playlist') permissionLevel = 1;
          if (state.permission === 'host-only') permissionLevel = 0;
          if (!conn) permissionLevel = 3;

          if (permissionLevel >= 2) {
            if (typeof event.payload?.progress === 'number') {
              const currentTime = state.playerApi?.getCurrentTime() ?? 0;
              if (Math.abs(event.payload.progress - currentTime) > 3)
                state.playerApi?.seekTo(event.payload.progress);
            }
            if (state.playerApi?.getPlayerState() !== event.payload?.state) {
              if (event.payload?.state === 2) state.playerApi?.pauseVideo();
              if (event.payload?.state === 1) state.playerApi?.playVideo();
            }
          }
          if (permissionLevel >= 1) {
            if (typeof event.payload?.index === 'number') {
              const nowIndex = state.queue?.selectedIndex ?? 0;

              if (nowIndex !== event.payload.index) {
                state.queue?.setIndex(event.payload.index);
              }
            }
          }

          break;
        }
        case 'CONNECTION_CLOSED': {
          state.queue?.off(listener);
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
    state.connection.on(listener);
    state.queue?.on(listener);

    ctx.setTimeout(() => {
      state.ignoreChange = false;
    }, 16); // wait 1 frame
    return true;
  };

  const onJoin = async () => {
    state.connection = new Connection();
    const wait = await state.connection.waitForReady().catch(() => null);
    if (!wait || ctx.signal.aborted) return false;

    state.profiles = {};

    const id = await showPrompt(
      t('plugins.music-together.name'),
      t('plugins.music-together.dialog.enter-host'),
    );
    if (typeof id !== 'string') return false;

    const connection = await state.connection.connect(id).catch(() => false);
    if (!connection || ctx.signal.aborted) return false;
    state.connection.onConnections((connection) => {
      if (!connection?.open) {
        state.api?.toastService?.show(
          t('plugins.music-together.toast.disconnected'),
        );
        onStop();
      }
    });

    let resolveIgnore: ReturnType<typeof setTimeout> | undefined;
    const queueListener = async (event: ConnectionEventUnion) => {
      state.ignoreChange = true;
      switch (event.type) {
        case 'CLEAR_QUEUE': {
          await state.connection?.broadcast('CLEAR_QUEUE', null);
          break;
        }
        case 'SET_INDEX': {
          await state.connection?.broadcast('SET_INDEX', {
            index: event.payload.index,
          });
          break;
        }
        case 'ADD_SONGS': {
          await state.connection?.broadcast(
            'ADD_SONGS',
            {
              ...event.payload,
              videoList: event.payload.videoList.map((it) => ({
                ...it,
                ownerId: it.ownerId ?? state.connection!.id,
              })),
            },
            event.after,
          );
          break;
        }
        case 'REMOVE_SONG': {
          await state.connection?.broadcast('REMOVE_SONG', event.payload);
          break;
        }
        case 'MOVE_SONG': {
          await state.connection?.broadcast('MOVE_SONG', event.payload);
          break;
        }
        case 'SYNC_PROGRESS': {
          if (state.permission === 'host-only')
            await state.connection?.broadcast('SYNC_QUEUE', undefined);
          else
            await state.connection?.broadcast('SYNC_PROGRESS', event.payload);
          break;
        }
      }

      ctx.clearTimeout(resolveIgnore);
      resolveIgnore = ctx.setTimeout(() => {
        state.ignoreChange = false;
      }, 16); // wait 1 frame
    };
    const listener = async (event: ConnectionEventUnion) => {
      state.ignoreChange = true;
      switch (event.type) {
        case 'CLEAR_QUEUE': {
          state.queue?.clear();
          break;
        }
        case 'SET_INDEX': {
          state.queue?.setIndex(event.payload.index);
          break;
        }
        case 'ADD_SONGS': {
          const videoList: VideoData[] = event.payload.videoList.map((it) => ({
            ...it,
            ownerId: it.ownerId ?? state.connection!.id,
          }));

          await state.queue?.addVideos(videoList, event.payload.index);

          const afterevent = event.after?.at(0);
          if (afterevent?.type === 'SET_INDEX') {
            state.queue?.setIndex(afterevent.payload.index);
          }

          break;
        }
        case 'REMOVE_SONG': {
          state.queue?.removeVideo(event.payload.index);
          break;
        }
        case 'MOVE_SONG': {
          state.queue?.moveItem(event.payload.fromIndex, event.payload.toIndex);
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
            await state.queue?.setVideoList(event.payload.videoList);
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
            putProfile(id, profile);
          });
          break;
        }
        case 'SYNC_PROGRESS': {
          if (typeof event.payload?.progress === 'number') {
            const currentTime = state.playerApi?.getCurrentTime() ?? 0;
            if (Math.abs(event.payload.progress - currentTime) > 3)
              state.playerApi?.seekTo(event.payload.progress);
          }
          if (state.playerApi?.getPlayerState() !== event.payload?.state) {
            if (event.payload?.state === 2) state.playerApi?.pauseVideo();
            if (event.payload?.state === 1) state.playerApi?.playVideo();
          }
          if (typeof event.payload?.index === 'number') {
            const nowIndex = state.queue?.selectedIndex ?? 0;

            if (nowIndex !== event.payload.index) {
              state.queue?.setIndex(event.payload.index);
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

          state.permission = event.payload;
          state.popups.guest.setPermission(state.permission);
          state.popups.host.setPermission(state.permission);
          state.popups.setting.setPermission(state.permission);

          const permissionLabel = t(
            `plugins.music-together.menu.permission.${state.permission}`,
          );

          state.api?.toastService?.show(
            t('plugins.music-together.toast.permission-changed', {
              permission: permissionLabel,
            }),
          );
          break;
        }
        case 'CONNECTION_CLOSED': {
          state.queue?.off(queueListener);
          break;
        }
        default: {
          console.warn('Music Together [Guest]: Unknown Event', event);
          break;
        }
      }

      ctx.clearTimeout(resolveIgnore);
      resolveIgnore = ctx.setTimeout(() => {
        state.ignoreChange = false;
      }, 16); // wait 1 frame
    };

    state.connection.on(listener);
    state.queue?.on(queueListener);

    if (!state.me) state.me = getDefaultProfile(state.connection.id);
    state.queue?.injection();
    state.queue?.setOwner({
      id: state.connection.id,
      ...state.me,
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

        if (state.permission === 'all' && typeof now === 'number') {
          const currentTime = state.playerApi?.getCurrentTime() ?? 0;
          if (Math.abs(now - currentTime) > 3)
            state.connection?.broadcast('SYNC_PROGRESS', {
              progress: now,
              state: state.playerApi?.getPlayerState(),
            });
        }

        original.call(progress, ...args);
      };

      return () => {
        progress._update = original;
      };
    });
    state.rollbackInjector = () => {
      rollbackList.forEach((rollback) => rollback());
    };

    await state.connection.broadcast('IDENTIFY', {
      profile: {
        id: state.connection.id,
        handleId: state.me.handleId,
        name: state.me.name,
        thumbnail: state.me.thumbnail,
      },
    });

    await state.connection.broadcast('SYNC_PROFILE', undefined);
    await state.connection.broadcast('PERMISSION', undefined);

    state.queue?.clear();
    state.queue?.syncQueueOwner();
    state.queue?.initQueue();

    await state.connection.broadcast('SYNC_QUEUE', undefined);

    return true;
  };

  const onStop = () => {
    if (state.connection?.mode !== 'disconnected') {
      state.connection?.disconnect();
    }
    state.queue?.rollbackInjection();
    state.queue?.removeQueueOwner();
    if (state.rollbackInjector) {
      state.rollbackInjector();
      state.rollbackInjector = undefined;
    }

    state.profiles = {};
    state.popups.host.setUsers(Object.values(state.profiles));
    state.popups.guest.setUsers(Object.values(state.profiles));

    state.popups.host.dismiss();
    state.popups.guest.dismiss();
    state.popups.setting.dismiss();
  };

  /* methods */
  const putProfile = (id: string, profile?: Profile) => {
    if (profile === undefined) {
      delete state.profiles[id];
    } else {
      state.profiles[id] = profile;
    }

    state.popups.host.setUsers(Object.values(state.profiles));
    state.popups.guest.setUsers(Object.values(state.profiles));
  };

  const showSpinner = () => {
    state.elements.icon.style.setProperty('display', 'none');
    state.elements.spinner.removeAttribute('hidden');
    state.elements.spinner.setAttribute('active', '');
  };

  const hideSpinner = () => {
    state.elements.icon.style.removeProperty('display');
    state.elements.spinner.removeAttribute('active');
    state.elements.spinner.setAttribute('hidden', '');
  };

  const initMyProfile = async () => {
    const accountButton = await waitForElement<HTMLElement>(
      '#right-content > ytmusic-settings-button *:where(tp-yt-paper-icon-button,yt-icon-button,.ytmusic-settings-button)',
      {
        maxRetry: 10000,
      },
    );

    if (ctx.signal.aborted) return;
    accountButton?.click();
    ctx.setTimeout(async () => {
      const renderer = await waitForElement<HTMLElement & { data: unknown }>(
        'ytd-active-account-header-renderer',
        {
          maxRetry: 10000,
        },
      );
      if (ctx.signal.aborted) return;
      if (!accountButton || !renderer) {
        console.warn('Music Together: Cannot find account');
        state.me = getDefaultProfile(state.connection?.id ?? '');
        return;
      }

      const accountData = renderer.data as RawAccountData;
      state.me = {
        handleId:
          accountData.channelHandle.runs[0].text ??
          accountData.accountName.runs[0].text,
        name: accountData.accountName.runs[0].text,
        thumbnail: accountData.accountPhoto.thumbnails[0].url,
      };

      if (state.me.thumbnail) {
        state.popups.host.setProfile(state.me.thumbnail);
        state.popups.guest.setProfile(state.me.thumbnail);
        state.popups.setting.setProfile(state.me.thumbnail);
      }
      accountButton?.click(); // close menu
    }, 0);
  };

  state.api = document.querySelector<AppElement>('ytmusic-app');

  /* setup */
  const anchor = document.querySelector(
    '#right-content > ytmusic-settings-button',
  );
  anchor?.insertAdjacentHTML('beforebegin', settingHTML);
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
    setting?.remove();
    console.warn('Music Together: Cannot inject html');
    console.log(setting, icon, spinner);
    return;
  }
  ctx.onCleanup(() => setting.remove());

  state.elements = {
    setting,
    icon,
    spinner,
  };

  ctx.setInterval(() => {
    if (state.connection?.mode !== 'host') return;
    const index = state.queue?.selectedIndex ?? 0;

    state.connection.broadcast('SYNC_PROGRESS', {
      progress: state.playerApi?.getCurrentTime(),
      state: state.playerApi?.getPlayerState(),
      index,
    });
  }, 1000);

  /* UI */
  const hostPopup = createHostPopup({
    onItemClick: (id) => {
      if (id === 'music-together-close') {
        onStop();
        state.api?.toastService?.show(t('plugins.music-together.toast.closed'));
        hostPopup.dismiss();
      }

      if (id === 'music-together-copy-id') {
        navigator.clipboard
          .writeText(state.connection?.id ?? '')
          .then(() => {
            state.api?.toastService?.show(
              t('plugins.music-together.toast.id-copied'),
            );
            hostPopup.dismiss();
          })
          .catch(() => {
            state.api?.toastService?.show(
              t('plugins.music-together.toast.id-copy-failed'),
            );
            hostPopup.dismiss();
          });
      }

      if (id === 'music-together-permission') {
        if (state.permission === 'all') state.permission = 'host-only';
        else if (state.permission === 'playlist') state.permission = 'all';
        else if (state.permission === 'host-only')
          state.permission = 'playlist';
        state.connection?.broadcast('PERMISSION', state.permission);

        hostPopup.setPermission(state.permission);
        guestPopup.setPermission(state.permission);
        settingPopup.setPermission(state.permission);

        const permissionLabel = t(
          `plugins.music-together.menu.permission.${state.permission}`,
        );
        state.api?.toastService?.show(
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
        onStop();
        state.api?.toastService?.show(
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
        showSpinner();
        const result = await onHost();
        hideSpinner();

        if (result) {
          navigator.clipboard
            .writeText(state.connection?.id ?? '')
            .then(() => {
              state.api?.toastService?.show(
                t('plugins.music-together.toast.id-copied'),
              );
              hostPopup.showAtAnchor(setting);
            })
            .catch(() => {
              state.api?.toastService?.show(
                t('plugins.music-together.toast.id-copy-failed'),
              );
              hostPopup.showAtAnchor(setting);
            });
        } else {
          state.api?.toastService?.show(
            t('plugins.music-together.toast.host-failed'),
          );
        }
      }

      if (id === 'music-together-join') {
        settingPopup.dismiss();
        showSpinner();
        const result = await onJoin();
        hideSpinner();

        if (result) {
          state.api?.toastService?.show(
            t('plugins.music-together.toast.joined'),
          );
          guestPopup.showAtAnchor(setting);
        } else {
          state.api?.toastService?.show(
            t('plugins.music-together.toast.join-failed'),
          );
        }
      }
    },
  });
  state.popups = {
    host: hostPopup,
    guest: guestPopup,
    setting: settingPopup,
  };
  ctx.listen(setting, 'click', () => {
    let popup = settingPopup;
    if (state.connection?.mode === 'host') popup = hostPopup;
    if (state.connection?.mode === 'guest') popup = guestPopup;

    if (popup.isShowing()) popup.dismiss();
    else popup.showAtAnchor(setting);
  });

  // Ends the session and removes the popups (added to document.body).
  ctx.onCleanup(() => {
    onStop();
    hostPopup.element.remove();
    guestPopup.element.remove();
    settingPopup.element.remove();
  });

  /* account data getter */
  initMyProfile();

  ctx.onPlayerApiReady((playerApi) => {
    state.queue = new Queue({
      owner: {
        id: state.connection?.id ?? '',
        ...state.me!,
      },
      getProfile: (id) => state.profiles[id],
    });
    state.playerApi = playerApi;

    playerApi.addEventListener('onStateChange', videoStateChangeListener);
    ctx.onCleanup(() =>
      playerApi.removeEventListener('onStateChange', videoStateChangeListener),
    );
    ctx.listen(document, 'videodatachange', videoChangeListener);
  });
});
