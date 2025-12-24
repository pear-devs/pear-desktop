import { WebClient } from '@slack/web-api';

import { t } from '@/i18n';
import { SLACK_PROGRESS_THROTTLE_MS, TimerKey } from './constants';
import { TimerManager } from './timer-manager';

import { LoggerPrefix } from '@/utils';

import type { SongInfo } from '@/providers/song-info';
import type { SlackStatusConfig } from './index';

export class SlackService {
  timerManager = new TimerManager();

  clearActivityTimeout() {
    this.timerManager.clear(TimerKey.ClearActivity);
  }

  setActivityTimeout() {
    this.clearActivityTimeout();
    if (
      this.lastSongInfo?.isPaused === true &&
      this.config?.activityTimeoutEnabled &&
      this.config?.activityTimeoutTime &&
      this.config.activityTimeoutTime > 0
    ) {
      this.timerManager.set(
        TimerKey.ClearActivity,
        () => {
          this.clearStatus();
        },
        this.config.activityTimeoutTime,
      );
    }
  }
  config?: SlackStatusConfig;
  lastStatus: string = '';
  lastEmoji: string = '';
  lastSongInfo?: SongInfo;
  lastStatusUpdate = 0;
  albumArtCache: Record<string, { filePath: string; timestamp: number }> = {};
  tempFiles = new Set<string>();
  mainWindow: Electron.BrowserWindow;
  slackClient?: WebClient;

  constructor(mainWindow: Electron.BrowserWindow, config?: SlackStatusConfig) {
    this.config = config;
    this.mainWindow = mainWindow;
    if (config?.token) {
      this.slackClient = new WebClient(config.token);
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.init'),
        config.token ? 'token set' : 'no token',
      );
    } else {
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.init'),
        'no token',
      );
    }
  }

  async updateStatus(songInfo: SongInfo) {
    if (!this.config?.enabled || !this.config.token || !this.slackClient) {
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.update-skipped'),
      );
      return;
    }

    const now = Date.now();
    const elapsedSeconds = songInfo.elapsedSeconds ?? 0;
    const songChanged = songInfo.videoId !== this.lastSongInfo?.videoId;
    const pauseChanged = songInfo.isPaused !== this.lastSongInfo?.isPaused;
    const seeked =
      !songChanged &&
      typeof this.lastSongInfo?.elapsedSeconds === 'number' &&
      Math.abs((this.lastSongInfo.elapsedSeconds ?? 0) - elapsedSeconds) > 3;

    if (
      (songChanged || pauseChanged || seeked) &&
      this.lastSongInfo !== undefined
    ) {
      this.timerManager.clear(TimerKey.UpdateTimeout);
      await this.setSlackStatus(songInfo);
      this.lastSongInfo = { ...songInfo };
      this.lastStatusUpdate = now;
      this.setActivityTimeout();
      return;
    }

    if (now - this.lastStatusUpdate > SLACK_PROGRESS_THROTTLE_MS) {
      this.timerManager.clear(TimerKey.UpdateTimeout);
      await this.setSlackStatus(songInfo);
      this.lastSongInfo = { ...songInfo };
      this.lastStatusUpdate = now;
      this.setActivityTimeout();
      return;
    }

    this.timerManager.clear(TimerKey.UpdateTimeout);
    const remainingThrottle =
      SLACK_PROGRESS_THROTTLE_MS - (now - this.lastStatusUpdate);

    const songInfoSnapshot = { ...songInfo };
    this.timerManager.set(
      TimerKey.UpdateTimeout,
      async () => {
        await this.setSlackStatus(songInfoSnapshot);
        this.lastStatusUpdate = Date.now();
        this.lastSongInfo = { ...songInfoSnapshot };
        this.setActivityTimeout();
      },
      remainingThrottle,
    );
  }

  async setSlackStatus(songInfo: SongInfo) {
    const statusText = `${songInfo.title} - ${songInfo.artist}`;
    const emoji = songInfo.isPaused ? ':double_vertical_bar:' : ':headphones:';
    try {
      await this.slackClient!.users.profile.set({
        profile: {
          status_text: statusText,
          status_emoji: emoji,
          status_expiration: 0,
        },
      });
      this.lastStatus = statusText;
      this.lastEmoji = emoji;
    } catch (err) {
      console.error(
        LoggerPrefix,
        t('plugins.slack-status.backend.status-error'),
        err,
      );
    }
  }

  async clearStatus() {
    if (!this.config?.enabled || !this.config.token || !this.slackClient) {
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.clear-skipped'),
      );
      return;
    }
    try {
      await this.slackClient.users.profile.set({
        profile: {
          status_text: '',
          status_emoji: '',
          status_expiration: 0,
        },
      });
      this.lastStatus = '';
      this.lastEmoji = '';
      this.lastSongInfo = undefined;
      this.lastStatusUpdate = Date.now();
      this.clearActivityTimeout();
      this.timerManager.clear(TimerKey.UpdateTimeout);
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.status-cleared'),
      );
    } catch (err) {
      console.error(
        LoggerPrefix,
        t('plugins.slack-status.backend.clear-error'),
        err,
      );
    }
  }

  onConfigChange(newConfig: SlackStatusConfig) {
    this.config = newConfig;
    if (newConfig.token) {
      this.slackClient = new WebClient(newConfig.token);
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.config-changed'),
        'token set',
      );
    } else {
      this.slackClient = undefined;
      console.log(
        LoggerPrefix,
        t('plugins.slack-status.backend.config-changed'),
        'no token',
      );
    }
  }

  async cleanup() {
    this.timerManager.clearAll();
    await this.clearStatus();
    console.log(LoggerPrefix, t('plugins.slack-status.backend.cleanup'));
  }
}
