const { Client: DiscordClient } = require('@xhayper/discord-rpc');
const { TimerManager } = require('./timer-manager');
const { TimerKey } = require('./constants');

/**
 * Discord Rich Presence Service
 * Handles connection and activity updates to Discord
 */
class DiscordService {
  constructor() {
    this.rpc = null;
    this.clientId = null;
    this.ready = false;
    this.autoReconnect = true;
    this.timerManager = new TimerManager();
    this.currentActivity = null;
    this.onStatusChange = null;
  }

  /**
   * Initialize the Discord RPC client with a client ID
   * @param {string} clientId - Discord Application ID
   */
  init(clientId) {
    if (this.rpc) {
      this.disconnect();
    }

    this.clientId = clientId;
    this.rpc = new DiscordClient({ clientId });

    this.rpc.on('connected', () => {
      console.log('[Discord] Connected');
      this._notifyStatus('connected');
    });

    this.rpc.on('ready', () => {
      this.ready = true;
      console.log('[Discord] Ready');
      this._notifyStatus('ready');

      // If we have a pending activity, set it now
      if (this.currentActivity) {
        this.updateActivity(this.currentActivity);
      }
    });

    this.rpc.on('disconnected', () => {
      this.ready = false;
      console.log('[Discord] Disconnected');
      this._notifyStatus('disconnected');

      if (this.autoReconnect) {
        this._connectRecursive();
      }
    });
  }

  /**
   * Notify status change to callback
   * @param {string} status
   */
  _notifyStatus(status) {
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }

  /**
   * Attempts to connect to Discord RPC after a delay
   */
  _connectWithRetry() {
    return new Promise((resolve, reject) => {
      this.timerManager.set(
        TimerKey.DiscordConnectRetry,
        () => {
          if (!this.autoReconnect || (this.rpc && this.rpc.isConnected)) {
            this.timerManager.clear(TimerKey.DiscordConnectRetry);
            if (this.rpc && this.rpc.isConnected) resolve();
            else reject(new Error('Auto-reconnect disabled or already connected.'));
            return;
          }

          this.rpc
            .login()
            .then(() => {
              this.timerManager.clear(TimerKey.DiscordConnectRetry);
              resolve();
            })
            .catch(() => {
              this._connectRecursive();
            });
        },
        5000
      );
    });
  }

  /**
   * Recursively attempts to connect
   */
  _connectRecursive() {
    if (!this.autoReconnect || (this.rpc && this.rpc.isConnected)) {
      this.timerManager.clear(TimerKey.DiscordConnectRetry);
      return;
    }
    this._connectWithRetry();
  }

  /**
   * Connect to Discord
   */
  connect() {
    if (!this.rpc) {
      throw new Error('Discord client not initialized. Call init() first.');
    }

    if (this.rpc.isConnected) {
      console.log('[Discord] Already connected');
      return;
    }

    this.autoReconnect = true;
    this.timerManager.clear(TimerKey.DiscordConnectRetry);

    this.rpc.login().catch((err) => {
      console.error('[Discord] Connection failed:', err.message);
      this._notifyStatus('error');

      if (this.autoReconnect) {
        this._connectRecursive();
      }
    });
  }

  /**
   * Disconnect from Discord
   */
  disconnect() {
    this.autoReconnect = false;
    this.timerManager.clear(TimerKey.DiscordConnectRetry);

    if (this.rpc && this.rpc.isConnected) {
      try {
        this.rpc.destroy();
      } catch (e) {
        // Ignored
      }
    }

    this.ready = false;
    this.currentActivity = null;
    this._notifyStatus('disconnected');
  }

  /**
   * Update Discord Rich Presence activity
   * @param {Object} activity - Activity object
   */
  updateActivity(activity) {
    this.currentActivity = activity;

    if (!this.rpc || !this.ready) {
      console.log('[Discord] Not ready, activity cached for later');
      return;
    }

    // Build the activity payload
    const payload = this._buildActivityPayload(activity);

    this.rpc.user
      ?.setActivity(payload)
      .then(() => {
        console.log('[Discord] Activity updated');
        this._notifyStatus('activity_updated');
      })
      .catch((err) => {
        console.error('[Discord] Failed to set activity:', err.message);
      });
  }

  /**
   * Build Discord activity payload from user input
   * @param {Object} activity
   */
  _buildActivityPayload(activity) {
    const payload = {};

    // Activity type (Playing, Listening, Watching, Competing)
    if (activity.type !== undefined) {
      payload.type = activity.type;
    }

    // Status display type - controls what shows in "Listening to X" / "Playing X"
    // 0 = App Name, 1 = State field, 2 = Details field
    if (activity.statusDisplayType !== undefined) {
      payload.statusDisplayType = activity.statusDisplayType;
    }

    // Details (first line) - min 2 chars required
    if (activity.details && activity.details.trim()) {
      payload.details = this._padToMinLength(this._truncate(activity.details, 128));
    }
    // Details URL (makes details clickable)
    if (activity.detailsUrl && activity.detailsUrl.trim()) {
      payload.detailsUrl = activity.detailsUrl;
    }

    // State (second line) - min 2 chars required
    if (activity.state && activity.state.trim()) {
      payload.state = this._padToMinLength(this._truncate(activity.state, 128));
    }
    // State URL (makes state clickable)
    if (activity.stateUrl && activity.stateUrl.trim()) {
      payload.stateUrl = activity.stateUrl;
    }

    // Large image
    if (activity.largeImageKey && activity.largeImageKey.trim()) {
      payload.largeImageKey = activity.largeImageKey;
    }
    if (activity.largeImageText && activity.largeImageText.trim()) {
      payload.largeImageText = this._padToMinLength(this._truncate(activity.largeImageText, 128));
    }

    // Small image
    if (activity.smallImageKey && activity.smallImageKey.trim()) {
      payload.smallImageKey = activity.smallImageKey;
    }
    if (activity.smallImageText && activity.smallImageText.trim()) {
      payload.smallImageText = this._padToMinLength(this._truncate(activity.smallImageText, 128));
    }

    // Timestamps
    if (activity.useTimestamp) {
      if (activity.timestampMode === 'elapsed') {
        payload.startTimestamp = Math.floor(Date.now() / 1000);
      } else if (activity.timestampMode === 'remaining' && activity.endTime) {
        payload.startTimestamp = Math.floor(Date.now() / 1000);
        payload.endTimestamp = Math.floor((Date.now() + activity.endTime * 1000) / 1000);
      }
    }

    // Buttons (max 2)
    const buttons = [];
    if (activity.button1Label && activity.button1Url) {
      buttons.push({
        label: this._truncate(activity.button1Label, 32),
        url: activity.button1Url,
      });
    }
    if (activity.button2Label && activity.button2Url) {
      buttons.push({
        label: this._truncate(activity.button2Label, 32),
        url: activity.button2Url,
      });
    }
    if (buttons.length > 0) {
      payload.buttons = buttons;
    }

    return payload;
  }

  /**
   * Truncate string to max length
   */
  _truncate(str, maxLength) {
    if (!str) return str;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Pad string to minimum length (Discord requires min 2 chars)
   * Uses Unicode Hangul filler character (invisible)
   */
  _padToMinLength(str, minLength = 2) {
    if (!str) return str;
    const FILLER = '\u3164'; // Hangul filler (invisible)
    if (str.length > 0 && str.length < minLength) {
      return str + FILLER.repeat(minLength - str.length);
    }
    return str;
  }

  /**
   * Clear Discord activity
   */
  clearActivity() {
    this.currentActivity = null;

    if (this.rpc && this.ready) {
      this.rpc.user?.clearActivity();
      console.log('[Discord] Activity cleared');
      this._notifyStatus('activity_cleared');
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.rpc && this.rpc.isConnected && this.ready;
  }

  /**
   * Cleanup
   */
  cleanup() {
    this.disconnect();
    this.timerManager.clearAll();
  }
}

// Singleton instance
const discordService = new DiscordService();

module.exports = { discordService, DiscordService };
