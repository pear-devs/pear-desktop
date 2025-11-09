import { app, type BrowserWindow, Notification } from 'electron';

import playIcon from '@assets/media-icons-black/play.png?asset&asarUnpack';
import pauseIcon from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import nextIcon from '@assets/media-icons-black/next.png?asset&asarUnpack';
import previousIcon from '@assets/media-icons-black/previous.png?asset&asarUnpack';

import { notificationImage, secondsToMinutes, ToastStyles } from './utils';

import { getSongControls } from '@/providers/song-controls';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { changeProtocolHandler } from '@/providers/protocol-handler';
import { setTrayOnClick, setTrayOnDoubleClick } from '@/tray';
import { mediaIcons } from '@/types/media-icons';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let songControls: ReturnType<typeof getSongControls>;
let savedNotification: Notification | undefined;

type Accessor<T> = () => T;

export default (
  win: BrowserWindow,
  config: Accessor<NotificationsPluginConfig>,
  { ipc: { on, send } }: BackendContext<NotificationsPluginConfig>,
) => {
  const sendNotification = (songInfo: SongInfo) => {
    const iconSrc = notificationImage(songInfo, config());

    savedNotification?.close();

    let icon: string;
    if (typeof iconSrc === 'object') {
      icon = iconSrc.toDataURL();
    } else {
      icon = iconSrc;
    }

    savedNotification = new Notification({
      title: songInfo.title || 'Playing',
      body: songInfo.artist,
      icon: iconSrc,
      silent: true,
      // https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/schema-root
      // https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/toast-schema
      // https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts?tabs=xml
      // https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toasttemplatetype
      toastXml: getXml(songInfo, icon),
    });

    // To fix the notification not closing
    setTimeout(() => savedNotification?.close(), 5000);

    savedNotification.on('close', () => {
      savedNotification = undefined;
    });

    savedNotification.show();
  };

  const getXml = (songInfo: SongInfo, iconSrc: string) => {
    switch (config().toastStyle) {
      default:
      case ToastStyles.logo:
      case ToastStyles.legacy: {
        return xmlLogo(songInfo, iconSrc);
      }

      case ToastStyles.banner_top_custom: {
        return xmlBannerTopCustom(songInfo, iconSrc);
      }

      case ToastStyles.hero: {
        return xmlHero(songInfo, iconSrc);
      }

      case ToastStyles.banner_bottom: {
        return xmlBannerBottom(songInfo, iconSrc);
      }

      case ToastStyles.banner_centered_bottom: {
        return xmlBannerCenteredBottom(songInfo, iconSrc);
      }

      case ToastStyles.banner_centered_top: {
        return xmlBannerCenteredTop(songInfo, iconSrc);
      }
    }
  };

  const selectIcon = (kind: keyof typeof mediaIcons): string => {
    switch (kind) {
      case 'play':
        return playIcon;
      case 'pause':
        return pauseIcon;
      case 'next':
        return nextIcon;
      case 'previous':
        return previousIcon;
      default:
        return '';
    }
  };

  const display = (kind: keyof typeof mediaIcons) => {
    if (config().toastStyle === ToastStyles.legacy) {
      return `content="${mediaIcons[kind]}"`;
    }

    return `\
            content="${
              config().toastStyle
                ? ''
                : kind.charAt(0).toUpperCase() + kind.slice(1)
            }"\
            imageUri="file:///${selectIcon(kind)}"
        `;
  };

  const getButton = (kind: keyof typeof mediaIcons) =>
    `<action ${display(
      kind,
    )} activationType="protocol" arguments="peardesktop://${kind}"/>`;

  const getButtons = (isPaused: boolean) => `\
    <actions>
        ${getButton('previous')}
        ${isPaused ? getButton('play') : getButton('pause')}
        ${getButton('next')}
    </actions>\
`;

  const toast = (content: string, isPaused: boolean) => `\
<toast>
    <audio silent="true" />
    <visual>
        <binding template="ToastGeneric">
            ${content}
        </binding>
    </visual>

    ${getButtons(isPaused)}
</toast>`;

  const xmlImage = (
    { title, artist, isPaused }: SongInfo,
    imgSrc: string,
    placement: string,
  ) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" ${placement}/>
            <text id="1">${title}</text>
            <text id="2">${artist}</text>\
`,
      isPaused ?? false,
    );

  const xmlLogo = (songInfo: SongInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, 'placement="appLogoOverride"');

  const xmlHero = (songInfo: SongInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, 'placement="hero"');

  const xmlBannerBottom = (songInfo: SongInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, '');

  const xmlBannerTopCustom = (songInfo: SongInfo, imgSrc: string) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" />
            <text>ㅤ</text>
            <group>
                <subgroup>
                    <text hint-style="body">${songInfo.title}</text>
                    <text hint-style="captionSubtle">${songInfo.artist}</text>
                </subgroup>
                ${xmlMoreData(songInfo)}
            </group>\
`,
      songInfo.isPaused ?? false,
    );

  const xmlMoreData = ({ album, elapsedSeconds, songDuration }: SongInfo) => `\
<subgroup hint-textStacking="bottom">
    ${
      album
        ? `<text hint-style="captionSubtle" hint-wrap="true" hint-align="right">${album}</text>`
        : ''
    }
    <text hint-style="captionSubtle" hint-wrap="true" hint-align="right">${secondsToMinutes(
      elapsedSeconds ?? 0,
    )} / ${secondsToMinutes(songDuration)}</text>
</subgroup>\
`;

  const xmlBannerCenteredBottom = (
    { title, artist, isPaused }: SongInfo,
    imgSrc: string,
  ) =>
    toast(
      `\
            <text>ㅤ</text>
            <group>
                <subgroup hint-weight="1" hint-textStacking="center">
                    <text hint-align="center" hint-style="${titleFontPicker(
                      title,
                    )}">${title}</text>
                    <text hint-align="center" hint-style="SubtitleSubtle">${artist}</text>
                </subgroup>
            </group>
            <image id="1" src="${imgSrc}" name="Image"  hint-removeMargin="true" />\
`,
      isPaused ?? false,
    );

  const xmlBannerCenteredTop = (
    { title, artist, isPaused }: SongInfo,
    imgSrc: string,
  ) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" />
            <text>ㅤ</text>
            <group>
                <subgroup hint-weight="1" hint-textStacking="center">
                    <text hint-align="center" hint-style="${titleFontPicker(
                      title,
                    )}">${title}</text>
                    <text hint-align="center" hint-style="SubtitleSubtle">${artist}</text>
                </subgroup>
            </group>\
`,
      isPaused ?? false,
    );

  const titleFontPicker = (title: string) => {
    if (title.length <= 13) {
      return 'Header';
    }

    if (title.length <= 22) {
      return 'Subheader';
    }

    if (title.length <= 26) {
      return 'Title';
    }

    return 'Subtitle';
  };

  songControls = getSongControls(win);

  let currentSeconds = 0;
  on('peard:player-api-loaded', () =>
    send('peard:setup-time-changed-listener'),
  );

  let savedSongInfo: SongInfo;
  let lastUrl: string | undefined;

  // Register songInfoCallback
  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) {
      currentSeconds = songInfo.elapsedSeconds ?? 0;
    }
    if (!songInfo.artist && !songInfo.title) {
      return;
    }

    savedSongInfo = { ...songInfo };
    if (
      !songInfo.isPaused &&
      (songInfo.url !== lastUrl || config().unpauseNotification)
    ) {
      lastUrl = songInfo.url;
      sendNotification(songInfo);
    }
  });

  if (config().trayControls) {
    setTrayOnClick(() => {
      if (savedNotification) {
        savedNotification.close();
        savedNotification = undefined;
      } else if (savedSongInfo) {
        sendNotification({
          ...savedSongInfo,
          elapsedSeconds: currentSeconds,
        });
      }
    });

    setTrayOnDoubleClick(() => {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
      }
    });
  }

  app.once('before-quit', () => {
    savedNotification?.close();
  });

  changeProtocolHandler((cmd, ...args) => {
    if (Object.keys(songControls).includes(cmd)) {
      // @ts-expect-error: cmd is a key of songControls
      songControls[cmd as keyof typeof songControls](...args);
      if (
        config().refreshOnPlayPause &&
        (cmd === 'pause' || (cmd === 'play' && !config().unpauseNotification))
      ) {
        setImmediate(() =>
          sendNotification({
            ...savedSongInfo,
            isPaused: cmd === 'pause',
            elapsedSeconds: currentSeconds,
          }),
        );
      }
    }
  });
};
