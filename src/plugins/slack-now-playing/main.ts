import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { net } from 'electron';

import { SlackApiClient, SlackError } from './slack-api-client';
import { createBackend } from '@/utils';
import { registerCallback, SongInfoEvent } from '@/providers/song-info';
import { t } from '@/i18n';

import type { SongInfo } from '@/providers/song-info';
import type { BackendContext } from '@/types/contexts';

// Plugin config type
export interface SlackNowPlayingConfig {
  enabled: boolean;
  token: string;
  cookieToken: string;
  emojiName: string;
  alternativeTitles?: boolean;
}

/**
 * Type guard to check if an object is a valid SlackNowPlayingConfig
 * @param config The object to check
 * @returns True if the object is a valid SlackNowPlayingConfig
 */
function isSlackNowPlayingConfig(
  config: unknown,
): config is SlackNowPlayingConfig {
  if (!config || typeof config !== 'object') return false;

  const c = config as Partial<SlackNowPlayingConfig>;
  return (
    typeof c.enabled === 'boolean' &&
    typeof c.token === 'string' &&
    typeof c.cookieToken === 'string' &&
    typeof c.emojiName === 'string'
  );
}

const defaultEmojis = [
  ':cd:',
  ':headphones:',
  ':musical_note:',
  ':notes:',
  ':radio:',
];

// Cache to store album art file paths by URL to avoid repeated downloads
type AlbumArtCache = {
  [url: string]: {
    filePath: string;
    timestamp: number;
  };
};

const state = {
  lastStatus: '',
  lastEmoji: '',
  window: undefined as Electron.BrowserWindow | undefined,
  tempFiles: new Set<string>(), // Track temporary files for cleanup
  albumArtCache: {} as AlbumArtCache, // Cache album art files
  cacheExpiryMs: 30 * 60 * 1000, // Cache expiry time (30 minutes)
  cacheCleanupTimer: undefined as NodeJS.Timeout | undefined, // Timer for periodic cache cleanup
  context: undefined as BackendContext<SlackNowPlayingConfig> | undefined, // Store the plugin context
  currentConfig: undefined as SlackNowPlayingConfig | undefined, // Current configuration
};

/**
 * Register a temporary file for cleanup when the plugin is stopped
 * @param filePath Path to the temporary file
 */
function registerFileForCleanup(filePath: string): void {
  state.tempFiles.add(filePath);
}

/**
 * Clean up all temporary files created by the plugin
 */
async function cleanupTempFiles(): Promise<void> {
  const fsPromises = fs.promises;

  for (const filePath of state.tempFiles) {
    try {
      // Check if the file exists before attempting to delete it
      await fsPromises
        .access(filePath, fs.constants.F_OK)
        .then(() => fsPromises.unlink(filePath))
        .then(() => {
          // Remove the file from the set once it's deleted
          state.tempFiles.delete(filePath);
        })
        .catch((error: NodeJS.ErrnoException) => {
          // Ignore errors if the file doesn't exist
          if (error.code !== 'ENOENT') {
            console.error(`Error deleting temporary file ${filePath}:`, error);
          }
        });
    } catch (error: unknown) {
      // Catch any unexpected errors
      if (error instanceof Error) {
        console.error(`Error during cleanup of ${filePath}:`, error.message);
      } else {
        console.error(`Error during cleanup of ${filePath}:`, String(error));
      }
    }
  }
}

/**
 * Clean up expired cache entries to prevent the cache from growing too large
 */
async function cleanupExpiredCache(): Promise<void> {
  const now = Date.now();
  const fsPromises = fs.promises;

  // Check each cache entry
  for (const [url, cacheEntry] of Object.entries(state.albumArtCache)) {
    // If the entry is expired
    if (now - cacheEntry.timestamp > state.cacheExpiryMs) {
      // Remove from cache
      delete state.albumArtCache[url];

      // Try to delete the file if it's not needed elsewhere
      try {
        await fsPromises.access(cacheEntry.filePath, fs.constants.F_OK);
        await fsPromises.unlink(cacheEntry.filePath);
        state.tempFiles.delete(cacheEntry.filePath);
      } catch {
        // Ignore errors if the file doesn't exist or is in use
      }
    }
  }
}

/**
 * Result of configuration validation
 */
type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates the Slack Now Playing configuration
 * @param config The configuration to validate
 * @returns A validation result object
 */
function validateConfig(config: SlackNowPlayingConfig): ValidationResult {
  const errors: string[] = [];

  // Check token
  if (!config.token) {
    errors.push('Missing Slack API token');
  } else if (!config.token.startsWith('xoxc-')) {
    errors.push('Invalid Slack API token format (should start with "xoxc-")');
  }

  // Check cookie token
  if (!config.cookieToken) {
    errors.push('Missing Slack cookie token');
  } else if (!config.cookieToken.startsWith('xoxd-')) {
    errors.push(
      'Invalid Slack cookie token format (should start with "xoxd-")',
    );
  }

  // Check emoji name
  if (!config.emojiName) {
    errors.push('Missing custom emoji name');
  } else if (!/^[a-z0-9_-]+$/.test(config.emojiName)) {
    errors.push(
      'Invalid emoji name format (should only contain lowercase letters, numbers, hyphens, and underscores)',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates the configuration and throws an error if invalid
 * @param config The configuration to validate
 * @throws Error if the configuration is invalid
 */
function assertValidConfig(
  config: SlackNowPlayingConfig,
): asserts config is SlackNowPlayingConfig {
  const result = validateConfig(config);
  if (!result.valid) {
    throw new Error(
      `Invalid Slack Now Playing configuration: ${result.errors.join(', ')}`,
    );
  }
}

/**
 * Updates the Slack status with the currently playing song
 * @param songInfo Information about the current song
 * @param config Plugin configuration
 */
async function setNowPlaying(
  songInfo: SongInfo,
  config: SlackNowPlayingConfig,
) {
  try {
    // Validate configuration
    const validationResult = validateConfig(config);
    if (!validationResult.valid) {
      console.error(
        `Cannot set Slack status: ${validationResult.errors.join(', ')}`,
      );
      return;
    }

    // Skip if song is paused
    if (songInfo.isPaused) {
      return;
    }

    const title = songInfo.alternativeTitle ?? songInfo.title;
    const artistPart = songInfo.artist || 'Unknown Artist';
    const truncatedArtist =
      artistPart.length > 50 ? artistPart.substring(0, 50) + '...' : artistPart;

    // Use localized version of the status text
    let statusText = t('plugins.slack-now-playing.status-text')
      .replace('{{artist}}', truncatedArtist)
      .replace('{{title}}', title);

    // Ensure the status text doesn't exceed Slack's limit
    if (statusText.length > 97)
      statusText = statusText.substring(0, 97) + '...';

    // Calculate expiration time (current time + remaining song duration)
    const elapsed = songInfo.elapsedSeconds ?? 0;
    const remaining = Math.max(0, Math.floor(songInfo.songDuration - elapsed));
    const expirationTime = Math.floor(Date.now() / 1000) + remaining;

    await updateSlackStatusWithEmoji(
      statusText,
      expirationTime,
      songInfo,
      config,
    );
  } catch (error: unknown) {
    // Provide more detailed error information based on error type
    if (error instanceof Error) {
      console.error(`Error setting Slack status: ${error.message}`, {
        name: error.name,
        stack: error.stack,
      });
    } else {
      console.error(`Error setting Slack status: ${String(error)}`);
    }

    // Re-throw specific errors that should be handled by the caller
    if (
      error instanceof Error &&
      (error.message.includes('token') ||
        error.message.includes('authentication'))
    ) {
      throw new Error(
        'Slack authentication failed. Please check your API token and cookie token.',
      );
    }
  }
}

/**
 * Updates the Slack status with emoji and text
 * @param statusText The status text to set
 * @param expirationTime When the status should expire
 * @param songInfo Information about the current song
 * @param config Plugin configuration
 * @throws Error if the Slack API request fails
 */
async function updateSlackStatusWithEmoji(
  statusText: string,
  expirationTime: number,
  songInfo: SongInfo,
  config: SlackNowPlayingConfig,
): Promise<void> {
  try {
    // Validate configuration
    const validationResult = validateConfig(config);
    if (!validationResult.valid) {
      throw new Error(
        `Cannot update Slack status: ${validationResult.errors.join(', ')}`,
      );
    }

    const client = new SlackApiClient(config.token, config.cookieToken);

    // Get the appropriate emoji for the current song
    const statusEmoji = await getStatusEmoji(songInfo, config);

    // Prepare the status update payload
    const statusUpdatePayload = {
      profile: JSON.stringify({
        status_text: statusText,
        status_emoji: statusEmoji,
        status_expiration: expirationTime,
      }),
    };

    // Update the status
    // The client now handles API errors internally
    await client.post('users.profile.set', statusUpdatePayload);

    // Update state with the new status and emoji
    state.lastStatus = statusText;
    state.lastEmoji = statusEmoji;
  } catch (error: unknown) {
    // Handle SlackError specifically
    if (error instanceof SlackError) {
      console.error(`Slack API error updating status: ${error.message}`, {
        endpoint: error.endpoint,
        statusCode: error.statusCode,
        responseError: error.responseData?.error,
      });
    }
    // Handle other errors
    else if (error instanceof Error) {
      console.error(`Error updating Slack status: ${error.message}`, {
        name: error.name,
        stack: error.stack,
      });
    } else {
      console.error(`Error updating Slack status: ${String(error)}`);
    }

    // Re-throw the error to be handled by the caller
    throw error;
  }
}

async function getStatusEmoji(
  songInfo: SongInfo,
  config: SlackNowPlayingConfig,
): Promise<string> {
  if (songInfo.imageSrc && (await uploadEmojiToSlack(songInfo, config))) {
    return `:${config.emojiName}:`;
  }

  const randomIndex = Math.floor(Math.random() * defaultEmojis.length);
  return defaultEmojis[randomIndex];
}

/**
 * Uploads album art to Slack as a custom emoji
 * @param songInfo Information about the current song
 * @param config Plugin configuration
 * @returns True if the emoji was successfully uploaded, false otherwise
 */
async function uploadEmojiToSlack(
  songInfo: SongInfo,
  config: SlackNowPlayingConfig,
): Promise<boolean> {
  try {
    // Validate configuration
    const validationResult = validateConfig(config);
    if (!validationResult.valid) {
      console.error(
        `Cannot upload emoji to Slack: ${validationResult.errors.join(', ')}`,
      );
      return false;
    }

    const client = new SlackApiClient(config.token, config.cookieToken);

    // Save album art to a temporary file
    const filePath = await saveAlbumArtToFile(songInfo);
    if (!filePath) {
      console.warn('Failed to save album art to file');
      return false;
    }

    // Make sure the emoji doesn't already exist
    const emojiDeleted = await ensureEmojiDoesNotExist(config);
    if (!emojiDeleted) {
      console.warn('Failed to ensure emoji does not exist');
      return false;
    }

    // Prepare the form data for the API request using native Node.js APIs
    const formData = new FormData();
    formData.append('mode', 'data');
    formData.append('name', config.emojiName);
    try {
      // Read the file as a Buffer and append directly to FormData
      const fileBuffer = await fs.promises.readFile(filePath);
      const filename = path.basename(filePath) || 'emoji.png';
      // Convert Buffer to Uint8Array for File constructor compatibility
      const imageFile = new File([new Uint8Array(fileBuffer)], filename);
      formData.append('image', imageFile, filename);
    } catch (fileError: unknown) {
      console.error(
        `Error preparing album art file: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
      );
      return false;
    }

    try {
      // The post method now returns a properly typed response
      await client.post<{ ok: boolean }>('emoji.add', formData, true);
      return true;
    } catch (apiError: unknown) {
      // Handle specific API error types
      if (apiError instanceof SlackError && apiError.responseData) {
        const errorCode = apiError.responseData.error;

        if (errorCode === 'invalid_name') {
          console.error(
            `Invalid emoji name: ${config.emojiName}. Emoji names can only contain lowercase letters, numbers, hyphens, and underscores.`,
          );
        } else if (errorCode === 'too_large') {
          console.error(
            'Album art image is too large for Slack emoji (max 128KB).',
          );
        } else if (errorCode === 'name_taken') {
          console.error(
            `Emoji name '${config.emojiName}' is already taken. This should not happen as we check for existing emojis.`,
          );
        } else {
          console.error(
            `Error uploading emoji: ${errorCode}`,
            apiError.responseData,
          );
        }
        // Log the full Slack error response for diagnostics
        console.error('Slack error full response:', apiError.responseData);
      } else {
        console.error(
          `Error uploading emoji to Slack: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
        );
      }
      return false;
    }
  } catch (error: unknown) {
    // Handle any other unexpected errors
    if (error instanceof Error) {
      console.error(
        `Unexpected error uploading emoji to Slack: ${error.message}`,
        {
          name: error.name,
          stack: error.stack,
        },
      );
    } else {
      console.error(
        `Unexpected error uploading emoji to Slack: ${String(error)}`,
      );
    }
    return false;
  }
}
/**
 * Downloads and saves album art to a temporary file
 * @param songInfo Information about the current song
 * @returns Path to the saved file, or null if the operation failed
 */
async function saveAlbumArtToFile(songInfo: SongInfo): Promise<string | null> {
  if (!songInfo.imageSrc) {
    console.warn('No image source available for album art');
    return null;
  }

  try {
    const imageUrl = songInfo.imageSrc;
    const now = Date.now();

    // Check if we have a cached version of this image
    const cachedImage = state.albumArtCache[imageUrl];
    if (cachedImage) {
      // Check if the cached file exists and is not expired
      const cacheAge = now - cachedImage.timestamp;
      if (cacheAge < state.cacheExpiryMs) {
        try {
          // Verify the file still exists
          await fs.promises.access(cachedImage.filePath, fs.constants.F_OK);
          return cachedImage.filePath;
        } catch {
          // File doesn't exist anymore, remove from cache
          delete state.albumArtCache[imageUrl];
        }
      } else {
        // Cache entry expired, remove it
        delete state.albumArtCache[imageUrl];
        // Try to clean up the old file
        try {
          await fs.promises.unlink(cachedImage.filePath);
          state.tempFiles.delete(cachedImage.filePath);
        } catch {
          // Ignore errors if the file doesn't exist
        }
      }
    }

    // Create a unique filename to prevent conflicts
    const tempDir = os.tmpdir();
    const timestamp = now;
    const randomString = Math.random().toString(36).substring(2, 10);
    const filename = `album-art-${timestamp}-${randomString}.jpg`;
    const filePath = path.join(tempDir, filename);

    // Fetch the image
    let response: Response;
    try {
      response = await net.fetch(imageUrl);

      if (!response.ok) {
        console.error(
          `Failed to fetch album art: HTTP ${response.status} ${response.statusText}`,
        );
        return null;
      }
    } catch (fetchError) {
      console.error(
        `Network error fetching album art: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
      );
      return null;
    }

    // Convert the response to a buffer
    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(await response.arrayBuffer());

      if (imageBuffer.length === 0) {
        console.error('Received empty album art image');
        return null;
      }
    } catch (bufferError) {
      console.error(
        `Error processing album art data: ${bufferError instanceof Error ? bufferError.message : String(bufferError)}`,
      );
      return null;
    }

    // Write the buffer to a file using async file operations
    try {
      // Import the promises API from fs
      const fsPromises = fs.promises;
      await fsPromises.writeFile(filePath, imageBuffer);

      // Register the file for cleanup when the app exits
      registerFileForCleanup(filePath);

      // Add to cache
      state.albumArtCache[imageUrl] = {
        filePath,
        timestamp: now,
      };

      return filePath;
    } catch (fileError) {
      console.error(
        `Error writing album art to file: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
      );
      return null;
    }
  } catch (error: unknown) {
    // Catch any other unexpected errors
    if (error instanceof Error) {
      console.error(`Error saving album art to file: ${error.message}`, {
        name: error.name,
        stack: error.stack,
      });
    } else {
      console.error(`Error saving album art to file: ${String(error)}`);
    }
    return null;
  }
}

/**
 * Checks if the emoji already exists and deletes it if necessary
 * @param config Plugin configuration
 * @returns True if the emoji doesn't exist or was successfully deleted, false otherwise
 */
async function ensureEmojiDoesNotExist(
  config: SlackNowPlayingConfig,
): Promise<boolean> {
  try {
    // Validate configuration
    const validationResult = validateConfig(config);
    if (!validationResult.valid) {
      console.error(
        `Cannot check emoji existence: ${validationResult.errors.join(', ')}`,
      );
      return false;
    }

    const client = new SlackApiClient(config.token, config.cookieToken);

    try {
      interface EmojiListResponse {
        emoji: Record<string, string>;
        [key: string]: unknown;
      }
      const response = await client.get<EmojiListResponse>('emoji.list');
      if (!response || !response.emoji) {
        return false;
      }
      if (
        response.emoji &&
        typeof response.emoji === 'object' &&
        config.emojiName in response.emoji
      ) {
        // Emoji already exists, attempting to delete it
        return await deleteExistingEmoji(config);
      } else {
        // Emoji doesn't exist, no need to delete
        return true;
      }
    } catch (apiError: unknown) {
      // Handle specific API error types
      if (apiError instanceof SlackError) {
        const errorCode = apiError.responseData?.error;

        if (errorCode === 'invalid_auth' || errorCode === 'token_expired') {
          console.error(
            'Slack authentication failed. Please check your API token and cookie token.',
          );
        } else if (errorCode === 'rate_limited') {
          console.error(
            'Slack API rate limit exceeded. Please try again later.',
          );
        } else {
          console.error(
            `Error checking emoji list: ${errorCode || apiError.message}`,
          );
        }
      } else {
        console.error(
          `[Slack] Error checking emoji list: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
        );
        if (apiError instanceof SlackError && apiError.responseData) {
          console.error('[Slack] Slack error response:', apiError.responseData);
        }
      }
      return false;
    }
  } catch (error: unknown) {
    // Handle any other unexpected errors
    if (error instanceof Error) {
      console.error(
        `[Slack] Unexpected error in ensureEmojiDoesNotExist: ${error.message}`,
        {
          name: error.name,
          stack: error.stack,
        },
      );
    } else {
      console.error(
        `[Slack] Unexpected error in ensureEmojiDoesNotExist: ${String(error)}`,
      );
    }
    return false;
  }
}

/**
 * Deletes an existing emoji from Slack
 * @param config Plugin configuration
 * @returns True if the emoji was successfully deleted or doesn't exist, false otherwise
 */
async function deleteExistingEmoji(
  config: SlackNowPlayingConfig,
): Promise<boolean> {
  try {
    // Validate configuration
    const validationResult = validateConfig(config);
    if (!validationResult.valid) {
      console.error(
        `Cannot delete emoji: ${validationResult.errors.join(', ')}`,
      );
      return false;
    }

    const client = new SlackApiClient(config.token, config.cookieToken);

    try {
      // Delete the emoji - no need to include the token in the data anymore
      const data = { name: config.emojiName };
      await client.post('emoji.remove', data);

      // If we got here, the request was successful
      // Emoji deleted successfully
      return true;
    } catch (apiError: unknown) {
      // Handle specific API error types
      if (apiError instanceof SlackError && apiError.responseData) {
        const errorCode = apiError.responseData.error;

        // Consider 'emoji_not_found' as a successful outcome
        if (errorCode === 'emoji_not_found') {
          // Emoji not found, no need to delete
          console.error(
            `Unexpected error deleting emoji: ${apiError.message}`,
            {
              name: apiError.name,
              stack: apiError.stack,
            },
          );
          return true;
        }
      }
      console.error(`Unexpected error deleting emoji: ${String(apiError)}`);
      return false;
    }
  } catch (error: unknown) {
    // Handle any other unexpected errors
    if (error instanceof Error) {
      console.error(
        `[Slack] Unexpected error in deleteExistingEmoji: ${error.message}`,
        {
          name: error.name,
          stack: error.stack,
        },
      );
    } else {
      console.error(
        `[Slack] Unexpected error in deleteExistingEmoji: ${String(error)}`,
      );
    }
    return false;
  }
}

/**
 * Register exit handlers to clean up resources when the application exits
 */
function registerExitHandlers(): void {
  // Handle process exit events
  process.on('exit', () => {
    // Use synchronous operations for the exit event
    for (const filePath of state.tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Can't log during exit event, but we tried our best to clean up
      }
    }
  });

  // Handle other termination signals
  ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
    process.on(signal, async () => {
      await cleanupTempFiles();
      process.exit(0);
    });
  });
}

export const backend = createBackend({
  /**
   * Start the Slack Now Playing plugin
   * @param ctx The plugin context
   */
  async start(ctx) {
    // Store the context and window for later use
    state.context = ctx as BackendContext<SlackNowPlayingConfig>;
    state.window = ctx.window;

    // Register exit handlers for cleanup
    registerExitHandlers();

    // Set up periodic cache cleanup (every hour)
    const cacheCleanupInterval = 60 * 60 * 1000; // 1 hour in milliseconds
    const cacheCleanupTimer = setInterval(async () => {
      try {
        await cleanupExpiredCache();
      } catch {
        // Ignore errors in the background task
      }
    }, cacheCleanupInterval);

    // Store the timer so we can clear it when the plugin stops
    state.cacheCleanupTimer = cacheCleanupTimer;

    // Get the initial config and store it
    const initialConfig = await ctx.getConfig();
    state.currentConfig = initialConfig as SlackNowPlayingConfig;

    // Register callback to listen for song changes

    registerCallback(async (songInfo: SongInfo, event: SongInfoEvent) => {
      // Skip time change events
      if (event === SongInfoEvent.TimeChanged) return;

      try {
        // Get the latest config each time
        const latestConfig = await ctx.getConfig();
        const config = latestConfig as SlackNowPlayingConfig;
        state.currentConfig = config; // Update stored config

        // Only update if plugin is enabled
        if (!config.enabled) {
          return;
        }

        // Update Slack status with current song
        // Check if config has the expected structure using our type guard
        if (!isSlackNowPlayingConfig(config)) {
          // Log a warning only on the first occurrence to avoid spamming the console
          if (!state.lastStatus) {
            console.warn('Invalid Slack Now Playing configuration structure');
          }
          return;
        }

        // Validate the configuration
        const validationResult = validateConfig(config);
        if (!validationResult.valid) {
          // Log a warning only on the first occurrence to avoid spamming the console
          if (!state.lastStatus) {
            console.warn(
              `Slack Now Playing configuration validation failed: ${validationResult.errors.join(', ')}`,
            );
          }
          return;
        }

        // Process the song info with the latest config
        await setNowPlaying(songInfo, config).catch((error) => {
          // Handle specific error types
          if (error instanceof Error) {
            // Check for authentication errors
            if (
              error.message.includes('authentication') ||
              error.message.includes('token')
            ) {
              console.error(
                'Slack authentication failed. Please check your API token and cookie token.',
              );
            }
            // Check for rate limiting errors
            else if (
              error.message.includes('rate limit') ||
              error.message.includes('rate_limited')
            ) {
              console.error(
                'Slack API rate limit exceeded. Please try again later.',
              );
            }
            // Generic error handling
            else {
              console.error(`Error in Slack Now Playing: ${error.message}`);
            }
          } else {
            console.error(`Error in Slack Now Playing: ${String(error)}`);
          }
        });
      } catch (error: unknown) {
        // Handle unexpected errors in the callback itself
        if (error instanceof Error) {
          console.error(`Error processing song info: ${error.message}`, {
            name: error.name,
            stack: error.stack,
          });
        } else {
          console.error(`Error processing song info: ${String(error)}`);
        }
      }
    });
  },

  /**
   * Stop the Slack Now Playing plugin and clean up resources
   */
  async stop() {
    // Clear the cache cleanup timer
    if (state.cacheCleanupTimer) {
      clearInterval(state.cacheCleanupTimer);
      state.cacheCleanupTimer = undefined;
    }

    // Clean up any temporary files created by the plugin
    await cleanupTempFiles();

    // Run a final cache cleanup
    await cleanupExpiredCache();

    // Clear the window reference
    state.window = undefined;

    // Note: We don't unregister the callback as there's no API for that
    // It will be garbage collected when the plugin is unloaded
  },

  /**
   * Handle configuration changes
   * This is called when the user updates the plugin configuration
   */
  async onConfigChange() {
    if (state.context) {
      try {
        // Get the latest configuration
        const latestConfig = await state.context.getConfig();
        const config = latestConfig;

        // Update the stored configuration
        state.currentConfig = config;

        // Validate the configuration
        try {
          // Use assertValidConfig to validate the configuration
          assertValidConfig(config);
          // Configuration updated successfully
        } catch (error: unknown) {
          console.warn(
            `Slack Now Playing configuration validation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } catch (error: unknown) {
        console.error('Error updating Slack Now Playing configuration:', error);
      }
    }
  },
});
