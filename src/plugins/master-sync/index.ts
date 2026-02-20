import { createPlugin } from '@/utils';
import { onMenu } from './menu';

import masterSyncStyle from './master-sync.css?inline';

export type Role = 'MASTER' | 'SLAVE';

export type MasterSyncConfig = {
  enabled: boolean;
  role: Role;
  slaveHost: string;
  slavePort: number;
  syncInterval: number;
  syncPlayPause: boolean;
  logDebug: boolean;
  slaveAuthToken?: string;
  autoRequestToken?: boolean;
};

const STATIC_AUTH_TOKEN = 'peard-static-token';

export default createPlugin({
  name: () => 'Master Sync',
  restartNeeded: false,
  config: {
    enabled: false,
    role: 'MASTER',
    slaveHost: '192.168.1.100',
    slavePort: 26538,
    syncInterval: 2000,
    syncPlayPause: true,
    logDebug: false,
    slaveAuthToken: '',
    autoRequestToken: false,
  } as MasterSyncConfig,
  stylesheets: [masterSyncStyle],
  
  menu: onMenu,

  backend: {
    start({ getConfig, setConfig, ipc }) {
      let syncIntervalId: ReturnType<typeof setInterval> | null = null;
      let lastSongId: string | null = null;
      let lastPausedState: boolean | null = null;
      let lastQueueHash: string | null = null;

      const log = async (message: string, ...args: any[]) => {
        const config = await getConfig();
        if (config.logDebug) {
          console.log(`[Master Sync] ${message}`, ...args);
        }
      };

      // Validate configuration
      const validateConfig = (config: MasterSyncConfig): string | null => {
        // Only require slaveHost when acting as MASTER
        if (config.role === 'MASTER') {
          if (!config.slaveHost || !config.slaveHost.trim()) {
            return 'SLAVE host is required when ROLE is MASTER';
          }
          if (config.slavePort < 1 || config.slavePort > 65535) {
            return 'SLAVE port must be between 1 and 65535';
          }
        }
        if (config.syncInterval < 500) {
          return 'Sync interval must be at least 500ms';
        }
        return null;
      };

      // Helper to call slave API with retry logic
      const callSlaveAPI = async (
        endpoint: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
        body?: any,
        retries: number = 3
      ): Promise<{ success: boolean; error?: string; data?: any }> => {
        const config = await getConfig();
        
        // Validate configuration
        const validationError = validateConfig(config);
        if (validationError) {
          await log(`Configuration error: ${validationError}`);
          return { success: false, error: validationError };
        }

        const url = `http://${config.slaveHost}:${config.slavePort}${endpoint}`;
        
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            const options: RequestInit & { timeout?: number } = {
              method,
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: 5000,
            };

            // Prefer stored token when available (set via menu request), otherwise fall back to static token
            const cfgForAuth = await getConfig();
            const token = cfgForAuth.slaveAuthToken && cfgForAuth.slaveAuthToken.trim()
              ? cfgForAuth.slaveAuthToken
              : STATIC_AUTH_TOKEN;

            if (token) {
              // @ts-ignore - RequestInit.headers is a loose map in Node fetch
              options.headers['Authorization'] = `Bearer ${token}`;
            }

            if (body !== undefined) {
              options.body = JSON.stringify(body);
            }

            await log(`API ${method} ${endpoint}`, body);
            const response = await fetch(url, options);
            
            // If we're unauthorized (401/403) and autoRequestToken is enabled, try to request an auth token from the slave
            if (!response.ok && (response.status === 403 || response.status === 401)) {
              const cfg = await getConfig();
              if (cfg.autoRequestToken) {
                await log('Received 403 from slave, attempting to request token via /auth/master-sync');
                try {
                  const authUrl = `http://${cfg.slaveHost}:${cfg.slavePort}/auth/master-sync`;
                  const authRes = await fetch(authUrl, { method: 'POST' } as any);
                  if (authRes.ok) {
                    const json = (await authRes.json().catch(() => ({}))) as { accessToken?: string };
                    const token = json.accessToken;
                    if (token) {
                      await log('Received token from slave, saving to config');
                      await setConfig({ slaveAuthToken: token });
                      // Retry immediately once with new token
                      // Rebuild options with new token
                      const retryOptions = { ...options } as any;
                      retryOptions.headers = { ...retryOptions.headers, Authorization: `Bearer ${token}` };
                      const retryResp = await fetch(url, retryOptions);
                      if (retryResp.ok) {
                        const data = await retryResp.json().catch(() => ({}));
                        return { success: true, data };
                      }
                    }
                  }
                } catch (authErr: any) {
                  await log(`Token request failed: ${authErr.message}`);
                }
              }
            }

            if (!response.ok) {
              const errorText = await response.text().catch(() => '');
              throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return { success: true, data };
          } catch (error: any) {
            const isLastAttempt = attempt === retries - 1;
            const errorMsg = error.message || 'Unknown error';
            
            if (isLastAttempt) {
              await log(`API call failed after ${retries} attempts: ${errorMsg}`);
              return { success: false, error: errorMsg };
            } else {
              const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
              await log(`API call failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms: ${errorMsg}`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        return { success: false, error: 'Max retries reached' };
      };

      // IPC handler to receive state updates from renderer
      ipc.handle('master-sync:update-state', async (_event: any, state: any) => {
        try {
          if (!state) {
            await log('Received empty state update, ignoring');
            return { success: false, error: 'No state provided' };
          }

          const config = await getConfig();
          if (!config.enabled) return { success: false, error: 'Plugin disabled' };
          if (config.role !== 'MASTER') return { success: false, error: 'Plugin not running as MASTER' };

          const { songId, isPaused, queueHash, videoId } = state;

          await log('State update received:', state);

          // Sync song change: ensure the slave plays the same track
          if (songId && songId !== lastSongId && videoId) {
            await log(`Song changed to: ${songId} (${videoId})`);

            const cfg = await getConfig();
            if (cfg.role !== 'MASTER') {
              await log('Skipping song sync because role is not MASTER');
            } else {
              // Strategy: clear slave queue, add the single video, then start playback
              const clearResult = await callSlaveAPI('/api/v1/queue', 'DELETE');
              if (!clearResult.success) {
                await log(`Failed to clear slave queue: ${clearResult.error}`);
              }

              const addResult = await callSlaveAPI('/api/v1/queue', 'POST', { videoId });
              if (!addResult.success) {
                await log(`Failed to add video to slave queue: ${addResult.error}`);
              } else {
                const playResult = await callSlaveAPI('/api/v1/play', 'POST');
                if (!playResult.success) {
                  await log(`Failed to start playback on slave: ${playResult.error}`);
                } else {
                  lastSongId = songId;
                  await log('Song synced successfully');
                }
              }
            }
          }

          // Sync play/pause state
          if (config.syncPlayPause && isPaused !== null && isPaused !== lastPausedState) {
            await log(`Playback state changed to: ${isPaused ? 'paused' : 'playing'}`);
            
            const cfg = await getConfig();
            if (cfg.role !== 'MASTER') {
              await log('Skipping play/pause sync because role is not MASTER');
            } else {
              const endpoint = isPaused ? '/api/v1/pause' : '/api/v1/play';
              const result = await callSlaveAPI(endpoint, 'POST');
              if (!result.success) {
                await log(`Failed to sync playback state: ${result.error}`);
              } else {
                lastPausedState = isPaused;
                await log('Playback state synced successfully');
              }
            }
          }

          // Sync queue changes
          if (queueHash && queueHash !== lastQueueHash) {
            await log('Queue changed');
            lastQueueHash = queueHash;
            
            // Queue sync would require the full queue data
            // This is handled in the renderer
          }

          return { success: true };
        } catch (error: any) {
          await log(`Error in update-state handler: ${error.message}`);
          return { success: false, error: error.message };
        }
      });

      // IPC handler to sync queue
      ipc.handle('master-sync:sync-queue', async (_event: any, queue: any) => {
        try {
          const config = await getConfig();
          if (!config.enabled) {
            return { success: false, error: 'Plugin disabled' };
          }

          await log('Syncing queue with', queue.length, 'items');

          // Clear existing queue on slave (DELETE /api/v1/queue)
          const clearResult = await callSlaveAPI('/api/v1/queue', 'DELETE');
          if (!clearResult.success) {
            await log(`Failed to clear queue: ${clearResult.error}`);
            return clearResult;
          }

          // Add songs to queue (POST /api/v1/queue)
          let successCount = 0;
          for (const item of queue) {
            if (item.videoId) {
              const addResult = await callSlaveAPI('/api/v1/queue', 'POST', {
                videoId: item.videoId,
              });
              if (addResult.success) {
                successCount++;
              }
            }
          }

          await log(`Queue synced: ${successCount}/${queue.length} items added`);
          return { success: true, synced: successCount };
        } catch (error: any) {
          await log(`Error in sync-queue handler: ${error.message}`);
          return { success: false, error: error.message };
        }
      });

      // Periodic sync check (as backup)
      let startPeriodicSync: (() => Promise<void>) | null = null;
      startPeriodicSync = async () => {
        const config = await getConfig();
        
        // Clear existing interval
        if (syncIntervalId) {
          clearInterval(syncIntervalId);
          syncIntervalId = null;
        }

        // Only start when plugin is enabled and ROLE is MASTER
        if (config.enabled && config.role === 'MASTER') {
          // Validate config before starting
          const validationError = validateConfig(config);
          if (validationError) {
            await log(`Cannot start sync: ${validationError}`);
            return;
          }

          await log(`Starting periodic sync every ${config.syncInterval}ms`);
          
          // Trigger renderer to send current state immediately
          try {
            ipc.send('master-sync:request-state');
          } catch (error: any) {
            await log(`Failed to request state from renderer: ${error.message}`);
          }
          
          // Set up periodic checks
          syncIntervalId = setInterval(() => {
            try {
              ipc.send('master-sync:request-state');
            } catch (error: any) {
              console.error('[Master Sync] Failed to send state request:', error);
            }
          }, config.syncInterval);
        } else {
          await log('Periodic sync not started (plugin disabled or not MASTER)');
        }
      };

      // Start sync after a short delay to ensure renderer is ready
      setTimeout(() => {
        startPeriodicSync?.().catch((error: any) => {
          console.error('[Master Sync] Failed to start periodic sync:', error);
        });
      }, 1000);

      // Handle config changes
      // Expose a hook so onConfigChange can restart the periodic sync
      (this as any)._startPeriodicSync = startPeriodicSync;

      Promise.resolve(getConfig()).then((config: MasterSyncConfig) => {
        if (config.enabled) {
          log('Master Sync plugin started');
        }
      }).catch((error: Error) => {
        console.error('[Master Sync] Failed to get initial config:', error);
      });
    },

    async onConfigChange(newConfig: MasterSyncConfig) {
      console.log('[Master Sync] Config updated:', newConfig);
      // Config changes are handled by the monitoring system
    },

    stop() {
      console.log('[Master Sync] Plugin stopped');
    },
  },

  renderer: {
    async start({ ipc, getConfig }) {
      const log = async (message: string, ...args: any[]) => {
        const config = await getConfig();
        if (config.logDebug) {
          console.log(`[Master Sync Renderer] ${message}`, ...args);
        }
      };

      await log('Renderer started');

      let currentSongId: string | null = null;
      let currentPausedState: boolean | null = null;
      let currentQueue: any[] = [];
      let domObserver: MutationObserver | null = null;
      let pollCheckInterval: ReturnType<typeof setInterval> | null = null;

      // Function to compute queue hash
      const computeQueueHash = (queue: any[]) => {
        return JSON.stringify(queue.map(item => item.videoId || item.id));
      };

      // Function to send state to backend
      const sendStateToBackend = async () => {
        const config = await getConfig();
        if (!config.enabled) return;

        try {
          await ipc.invoke('master-sync:update-state', {
            songId: currentSongId,
            isPaused: currentPausedState,
            queueHash: computeQueueHash(currentQueue),
            videoId: currentSongId, // Assuming songId is the videoId
          });
        } catch (error: any) {
          await log(`Failed to send state to backend: ${error.message}`);
        }
      };

      // Listen for state requests from backend
      ipc.on('master-sync:request-state', async () => {
        try {
          await sendStateToBackend();
        } catch (error: any) {
          await log(`Error sending state: ${error.message}`);
        }
      });

      // Monitor player state changes
      const observePlayer = () => {
        // Try to access the player API
        let checkAttempts = 0;
        const maxCheckAttempts = 30; // 30 seconds (1 per second)

        pollCheckInterval = setInterval(async () => {
          checkAttempts++;
          const videoElement = document.querySelector<HTMLVideoElement>('video');
          const playerBar = document.querySelector('.player-bar');
          
          if (videoElement && playerBar) {
            if (pollCheckInterval) {
              clearInterval(pollCheckInterval);
              pollCheckInterval = null;
            }
            
            await log('Found player elements after ' + checkAttempts + ' attempts');

            // Monitor play/pause
            const playHandler = async () => {
              currentPausedState = false;
              await sendStateToBackend();
            };

            const pauseHandler = async () => {
              currentPausedState = true;
              await sendStateToBackend();
            };

            videoElement.addEventListener('play', playHandler);
            videoElement.addEventListener('pause', pauseHandler);

            // Monitor song changes with more specific selector
            domObserver = new MutationObserver(async () => {
              const titleElement = document.querySelector('[role="heading"][title]');
              const newSongId = titleElement?.textContent?.trim() || '';
              
              if (newSongId && newSongId !== currentSongId) {
                await log('Song changed:', newSongId);
                currentSongId = newSongId;
                
                // Try to get video ID from URL
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (videoId) {
                  currentSongId = videoId;
                }
                
                await sendStateToBackend();
              }
            });

            // Watch a smaller target for better performance
            const playerContainer = document.querySelector('[role="main"]') || document.body;
            domObserver.observe(playerContainer, {
              childList: true,
              subtree: true,
              attributeFilter: ['title'],
            });

            // Initial state
            currentPausedState = videoElement.paused;
            await sendStateToBackend();
          } else if (checkAttempts >= maxCheckAttempts) {
            await log('Player elements not found after maximum attempts');
            if (pollCheckInterval) {
              clearInterval(pollCheckInterval);
              pollCheckInterval = null;
            }
          }
        }, 1000);
      };

      observePlayer();
    },

    onPlayerApiReady(api: any, { ipc, getConfig }: any) {
      const log = async (message: string) => {
        const config = await getConfig();
        if (config.logDebug) {
          console.log(`[Master Sync] ${message}`);
        }
      };

      log('Player API ready, setting up listeners');

      try {
        // Listen to state changes
        api.addEventListener('onStateChange', async (state: any) => {
          try {
            await log('Player state changed: ' + state);
            
            const playerResponse = api.getPlayerResponse?.();
            const currentSong = playerResponse?.videoDetails;
            
            if (currentSong) {
              const result = await ipc.invoke('master-sync:update-state', {
                songId: currentSong.videoId,
                videoId: currentSong.videoId,
                isPaused: state === 2, // YouTube player states: 2 = paused
                queueHash: null,
              });
              if (!result?.success) {
                await log(`Failed to update state: ${result?.error}`);
              }
            }
          } catch (error: any) {
            await log(`Error in onStateChange handler: ${error.message}`);
          }
        });

        // Get initial state
        const playerResponse = api.getPlayerResponse?.();
        const initialSong = playerResponse?.videoDetails;
        if (initialSong) {
          ipc.invoke('master-sync:update-state', {
            songId: initialSong.videoId,
            videoId: initialSong.videoId,
            isPaused: api.getPlayerState?.() === 2,
            queueHash: null,
          }).catch((error: any) => {
            console.error('[Master Sync] Failed to send initial state:', error);
          });
        }
      } catch (error: any) {
        console.error('[Master Sync] Error in onPlayerApiReady:', error);
      }
    },

    stop() {
      console.log('[Master Sync] Renderer stopped');
      // Note: Observers and intervals are cleaned up by the system on plugin stop
    },
  },
});
