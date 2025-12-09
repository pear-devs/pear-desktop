import { app, type BrowserWindow, Notification } from 'electron';

import playIcon from '@assets/media-icons-black/play.png?asset&asarUnpack';
import pauseIcon from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import nextIcon from '@assets/media-icons-black/next.png?asset&asarUnpack';
import previousIcon from '@assets/media-icons-black/previous.png?asset&asarUnpack';
import likeFilledIcon from '@assets/media-icons-black/likeFilled.png?asset&asarUnpack';
import likeOutlineIcon from '@assets/media-icons-black/likeOutline.png?asset&asarUnpack';
import dislikeFilledIcon from '@assets/media-icons-black/dislikeFilled.png?asset&asarUnpack';
import dislikeOutlineIcon from '@assets/media-icons-black/dislikeOutline.png?asset&asarUnpack';

import { notificationImage, secondsToMinutes } from './utils';

import { getSongControls } from '@/providers/song-controls';
import { registerCallback, type SongInfo, SongInfoEvent } from '@/providers/song-info';
import { changeProtocolHandler } from '@/providers/protocol-handler';
import { setTrayOnClick, setTrayOnDoubleClick } from '@/tray';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let songControls: ReturnType<typeof getSongControls>;
let savedNotification: Notification | undefined;
let currentSongInfo: SongInfo | undefined;
let notificationDisplayedForPlay = false;
let notificationDisplayedForPause = false;

// Inline shortcut tracking to avoid path resolution issues
declare global {
  // eslint-disable-next-line no-var
  var __pearShortcutTracker: { 
    lastShortcutActionTime: number;
    lastShortcutAction: 'like' | 'dislike' | 'play' | 'pause' | 'other' | null;
    onLikeDislikeShortcut?: (action: 'like' | 'dislike', timestamp: number) => void;
    onPreviousNextShortcut?: (action: 'previous' | 'next') => void;
  } | undefined;
}

// Track the last timestamp we showed a notification for to prevent spam
let lastNotificationTimestamp = 0;
// Track if we're waiting for a song change after dislike
let waitingForSongChangeAfterDislike = false;
let previousVideoId: string | undefined;

export default (
  win: BrowserWindow,
  config: () => NotificationsPluginConfig,
  { ipc: {  } }: BackendContext<NotificationsPluginConfig>,
) => {
  songControls = getSongControls(win);

  // Register callback to be notified when like/dislike shortcuts are pressed
  if (typeof globalThis.__pearShortcutTracker === 'undefined') {
    globalThis.__pearShortcutTracker = { 
      lastShortcutActionTime: 0,
      lastShortcutAction: null,
    };
  }
  
  globalThis.__pearShortcutTracker.onLikeDislikeShortcut = async (action: 'like' | 'dislike', timestamp: number) => {
    console.debug('[Notifications] onLikeDislikeShortcut called:', action, 'timestamp:', timestamp);
    
    // Prevent spam: only show if this is a new shortcut press (different timestamp)
    if (timestamp === lastNotificationTimestamp) {
      console.debug('[Notifications] Duplicate timestamp, skipping');
      return;
    }
    lastNotificationTimestamp = timestamp;
    
    // Always show notification when shortcut is used (regardless of window focus)
    // The user wants to see notifications when using keyboard shortcuts
    const windowFocused = win.isFocused();
    const windowVisible = win.isVisible();
    console.debug('[Notifications] Window state - focused:', windowFocused, 'visible:', windowVisible);
    console.debug('[Notifications] Showing notification because shortcut was used');
    
    if (!currentSongInfo) {
      console.warn('[Notifications] No current song info available');
      return;
    }
    
    // Special handling for dislike: show dislike state, then wait for song change
    if (action === 'dislike') {
      // Store the current video ID to detect when it changes
      previousVideoId = currentSongInfo.videoId;
      waitingForSongChangeAfterDislike = true;
      console.debug('[Notifications] Dislike pressed, will wait for song change. Previous videoId:', previousVideoId);
    }
    
    console.debug('[Notifications] Will show notification for', action, 'after DOM update');
    
    // Wait a bit for DOM to update, then query the actual state and show notification
    setTimeout(async () => {
      if (!currentSongInfo) {
        console.warn('[Notifications] currentSongInfo became null during timeout');
        return;
      }
      
      try {
        console.debug('[Notifications] Querying like status from DOM...');
        const likeStatus = await songControls.getLikeStatus();
        const isLiked = likeStatus === 'LIKE';
        const isDisliked = likeStatus === 'DISLIKE';
        console.debug('[Notifications] Like status from DOM:', likeStatus, 'isLiked:', isLiked, 'isDisliked:', isDisliked);
        const updatedSongInfo: SongInfo = {
          ...currentSongInfo,
          isLiked,
          isDisliked,
        };
        currentSongInfo = updatedSongInfo;
        console.debug('[Notifications] Sending notification with updated state, songInfo:', {
          title: updatedSongInfo.title,
          isLiked: updatedSongInfo.isLiked,
          isDisliked: updatedSongInfo.isDisliked,
        });
        // Skip like query since we already queried it
        sendNotification(updatedSongInfo, true).catch((err) => {
          console.error('[Notifications] Error in sendNotification:', err);
        });
        console.debug('[Notifications] sendNotification call completed (async)');
        
        // For dislike: after showing the dislike notification, wait 1-2 seconds then check for new song
        if (action === 'dislike') {
          setTimeout(() => {
            console.debug('[Notifications] Checking for song change after dislike delay');
            // The song change will be detected by registerCallback with VideoSrcChanged event
            // We'll handle showing the new song notification there
          }, 1500); // 1.5 second delay
        }
      } catch (err) {
        console.error('[Notifications] Error querying like status, using fallback:', err);
        // Fallback: toggle based on action
        if (!currentSongInfo) return;
        const updatedSongInfo: SongInfo = {
          ...currentSongInfo,
          isLiked: action === 'like' ? !currentSongInfo.isLiked : false,
          isDisliked: action === 'dislike' ? !currentSongInfo.isDisliked : false,
        };
        if (action === 'like' && updatedSongInfo.isLiked) {
          updatedSongInfo.isDisliked = false;
        } else if (action === 'dislike' && updatedSongInfo.isDisliked) {
          updatedSongInfo.isLiked = false;
        }
        currentSongInfo = updatedSongInfo;
        await sendNotification(updatedSongInfo);
        
        // For dislike: after showing the dislike notification, wait 1-2 seconds then check for new song
        if (action === 'dislike') {
          setTimeout(() => {
            console.debug('[Notifications] Checking for song change after dislike delay (fallback)');
          }, 1500);
        }
      }
    }, 200);
  };
  
  console.debug('[Notifications] Registered onLikeDislikeShortcut callback');
  
  // Register callback to clear waiting flag when previous/next is pressed
  globalThis.__pearShortcutTracker.onPreviousNextShortcut = (action: 'previous' | 'next') => {
    console.debug('[Notifications] Previous/Next shortcut pressed:', action, '- clearing waiting flag');
    waitingForSongChangeAfterDislike = false;
    previousVideoId = undefined;
  };


  const getButtonsXml = (song: SongInfo) => {
    const isLiked = song.isLiked ?? false;
    const isDisliked = song.isDisliked ?? false;
    return `
<actions>
<action content="Dislike" imageUri="file:///${isDisliked ? dislikeFilledIcon : dislikeOutlineIcon}" activationType="protocol" arguments="peardesktop://dislike"/>
  <action content="Previous" imageUri="file:///${previousIcon}" activationType="protocol" arguments="peardesktop://previous"/>
  <action content="${song.isPaused ? 'Play' : 'Pause'}" imageUri="file:///${song.isPaused ? playIcon : pauseIcon}" activationType="protocol" arguments="peardesktop://${song.isPaused ? 'play' : 'pause'}"/>
  <action content="Next" imageUri="file:///${nextIcon}" activationType="protocol" arguments="peardesktop://next"/>
  <action content="Like" imageUri="file:///${isLiked ? likeFilledIcon : likeOutlineIcon}" activationType="protocol" arguments="peardesktop://like"/>
</actions>`;
  };

  const createNotificationXml = (song: SongInfo) => `
<toast>
  <visual>
    <binding template="ToastGeneric">
      <image id="1" src="${notificationImage(song, config())}" placement="appLogoOverride"/>
      <text id="1">${song.title}</text>
      <text id="2">${song.artist}</text>
      <text id="3">${secondsToMinutes(song.elapsedSeconds ?? 0)} / ${secondsToMinutes(song.songDuration)}</text>
    </binding>
  </visual>
  ${getButtonsXml(song)}
</toast>`;

  const sendNotification = async (song: SongInfo, skipLikeQuery = false) => {
    console.debug('[Notifications] sendNotification called, skipLikeQuery:', skipLikeQuery, 'title:', song.title);
    savedNotification?.close();
    
    // Query the actual like/dislike status from DOM before creating notification
    // Skip if already queried (e.g., from shortcut callback)
    let songWithLikeStatus = song;
    if (!skipLikeQuery) {
      try {
        const likeStatus = await songControls.getLikeStatus();
        const isLiked = likeStatus === 'LIKE';
        const isDisliked = likeStatus === 'DISLIKE';
        songWithLikeStatus = {
          ...song,
          isLiked,
          isDisliked,
        };
        // Update currentSongInfo with actual DOM state
        currentSongInfo = songWithLikeStatus;
      } catch {
        // If query fails, use the provided song info
        songWithLikeStatus = song;
      }
    } else {
      console.debug('[Notifications] Skipping like query, using provided state');
    }
    
    console.debug('[Notifications] About to create notification, songWithLikeStatus:', {
      title: songWithLikeStatus.title,
      isLiked: songWithLikeStatus.isLiked,
      isDisliked: songWithLikeStatus.isDisliked,
    });
    
    // Small delay to ensure notification closes before creating new one (fixes update bug)
    setTimeout(() => {
      console.debug('[Notifications] setTimeout callback executing');
      try {
        const toastXml = createNotificationXml(songWithLikeStatus);
        console.debug('[Notifications] Created toast XML, length:', toastXml.length);
        
        savedNotification = new Notification({
          title: songWithLikeStatus.title || 'Playing',
          body: songWithLikeStatus.artist,
          silent: true,
          toastXml: toastXml,
        });
        
        console.debug('[Notifications] Notification object created');

        savedNotification.on('close', () => {
          console.debug('[Notifications] Notification closed');
          savedNotification = undefined;
        });
        
        savedNotification.on('show', () => {
          console.debug('[Notifications] Notification shown successfully');
        });
        
        savedNotification.on('click', () => {
          console.debug('[Notifications] Notification clicked');
        });
        
        console.debug('[Notifications] Calling notification.show()');
        try {
          savedNotification.show();
          console.debug('[Notifications] notification.show() returned successfully');
          
          // Verify notification was created
          if (savedNotification) {
            console.debug('[Notifications] Notification object exists after show()');
          } else {
            console.warn('[Notifications] Notification object is null after show()');
          }
        } catch (showErr) {
          console.error('[Notifications] Error calling notification.show():', showErr);
          if (showErr instanceof Error) {
            console.error('[Notifications] Error stack:', showErr.stack);
          }
        }
      } catch (err) {
        console.error('[Notifications] Error creating/showing notification:', err);
        if (err instanceof Error) {
          console.error('[Notifications] Error stack:', err.stack);
        }
      }
    }, 10);
    console.debug('[Notifications] setTimeout scheduled, returning from sendNotification');
  };

  registerCallback((songInfo, event) => {
    const previousIsPaused = currentSongInfo?.isPaused;
    const previousIsLiked = currentSongInfo?.isLiked ?? false;
    const previousIsDisliked = currentSongInfo?.isDisliked ?? false;
    const currentIsLiked = songInfo.isLiked ?? false;
    const currentIsDisliked = songInfo.isDisliked ?? false;
    
    // Check if like/dislike state changed BEFORE updating currentSongInfo
    const likeStateChanged =
      previousIsLiked !== currentIsLiked ||
      previousIsDisliked !== currentIsDisliked;
    
    // Check if song changed (for dislike skip feature)
    const songChanged = currentSongInfo?.videoId !== songInfo.videoId;
    const isVideoSrcChanged = event === SongInfoEvent.VideoSrcChanged;
    
    // If we're waiting for a song change after dislike, and the song actually changed
    if (waitingForSongChangeAfterDislike && songChanged && isVideoSrcChanged && previousVideoId !== undefined && songInfo.videoId !== previousVideoId) {
      console.debug('[Notifications] Song changed after dislike, showing notification for new song');
      waitingForSongChangeAfterDislike = false;
      previousVideoId = undefined;
      
      // Wait a bit for the new song to fully load, then show notification
      setTimeout(() => {
        if (songInfo.title && songInfo.artist) {
          currentSongInfo = { ...songInfo };
          sendNotification(songInfo, false).catch((err) => {
            console.error('[Notifications] Error showing notification for new song after dislike:', err);
          });
        }
      }, 300);
      return; // Don't process other logic for this callback
    }
    
    currentSongInfo = { ...songInfo };

    if (!songInfo.artist && !songInfo.title) return;

    // For like/dislike: notifications are handled directly by the shortcut callback
    // Don't show notifications from the callback for like/dislike to prevent spam
    if (likeStateChanged) {
      // Just update the state, but don't show notification here
      // Notification will be shown by the shortcut callback if needed
      return;
    }

    // Show notification when song changes (VideoSrcChanged) - only if window is not focused/visible
    // This handles previous/next song changes and prevents double notifications
    const shouldShowSongChangeNotification = !win.isFocused() || !win.isVisible();
    
    if (isVideoSrcChanged && songChanged && shouldShowSongChangeNotification && !waitingForSongChangeAfterDislike) {
      // Reset play/pause flags when song changes
      notificationDisplayedForPlay = false;
      notificationDisplayedForPause = false;
      
      sendNotification(songInfo).catch(() => {
        // Error handled internally in sendNotification
      });
      notificationDisplayedForPlay = !(songInfo.isPaused ?? false);
      notificationDisplayedForPause = songInfo.isPaused ?? false;
      return;
    }

    // Handle play/pause state changes - show if window not focused
    const shouldShowNotification = !win.isFocused() || !win.isVisible();
    if (
      event === SongInfoEvent.PlayOrPaused &&
      previousIsPaused !== undefined &&
      previousIsPaused !== songInfo.isPaused &&
      shouldShowNotification &&
      !songChanged // Don't show if song also changed (already handled above)
    ) {
      sendNotification(songInfo).catch(() => {
        // Error handled internally in sendNotification
      });
      notificationDisplayedForPlay = !(songInfo.isPaused ?? false);
      notificationDisplayedForPause = songInfo.isPaused ?? false;
      return;
    }

    // Show notification when song starts playing (initial play) - only if window is not focused/visible
    const shouldShowInitialNotification = !win.isFocused() || !win.isVisible();
    
    if (!songInfo.isPaused && !notificationDisplayedForPlay && shouldShowInitialNotification) {
      sendNotification(songInfo).catch(() => {
        // Fallback if async query fails - use current song info
        if (currentSongInfo) {
          const fallbackNotification = new Notification({
            title: currentSongInfo.title || 'Playing',
            body: currentSongInfo.artist,
            silent: true,
            toastXml: createNotificationXml(currentSongInfo),
          });
          fallbackNotification.on('close', () => savedNotification = undefined);
          savedNotification = fallbackNotification;
          fallbackNotification.show();
        }
      });
      notificationDisplayedForPlay = true;
      notificationDisplayedForPause = false;
    } else if (songInfo.isPaused && !notificationDisplayedForPause && shouldShowInitialNotification) {
      sendNotification(songInfo).catch(() => {
        // Fallback if async query fails - use current song info
        if (currentSongInfo) {
          const fallbackNotification = new Notification({
            title: currentSongInfo.title || 'Playing',
            body: currentSongInfo.artist,
            silent: true,
            toastXml: createNotificationXml(currentSongInfo),
          });
          fallbackNotification.on('close', () => savedNotification = undefined);
          savedNotification = fallbackNotification;
          fallbackNotification.show();
        }
      });
      notificationDisplayedForPause = true;
      notificationDisplayedForPlay = false;
    }
  });

  changeProtocolHandler((cmd) => {
    if (!currentSongInfo) return;

    if (cmd === 'like') {
      // Click the like button directly - this will toggle correctly
      songControls.clickLikeButton();
      // Query the updated like status after DOM updates and show notification
      setTimeout(async () => {
        if (currentSongInfo) {
          try {
            const likeStatus = await songControls.getLikeStatus();
            const isLiked = likeStatus === 'LIKE';
            const isDisliked = likeStatus === 'DISLIKE';
            const updatedSongInfo = {
              ...currentSongInfo,
              isLiked,
              isDisliked,
            };
            currentSongInfo = updatedSongInfo;
            // Always show notification when button is clicked
            if (savedNotification) {
              savedNotification.close();
              savedNotification = undefined;
            }
            setTimeout(() => {
              sendNotification(updatedSongInfo);
            }, 50);
          } catch {
            // Fallback: toggle the state manually
            const updatedSongInfo = {
              ...currentSongInfo,
              isLiked: !currentSongInfo.isLiked,
              isDisliked: currentSongInfo.isLiked ? false : currentSongInfo.isDisliked,
            };
            currentSongInfo = updatedSongInfo;
            if (savedNotification) {
              savedNotification.close();
              savedNotification = undefined;
            }
            setTimeout(() => {
              sendNotification(updatedSongInfo);
            }, 50);
          }
        }
      }, 250);
    } else if (cmd === 'dislike') {
      // Click the dislike button directly - this will toggle correctly
      songControls.clickDislikeButton();
      // Query the updated like status after DOM updates and show notification
      setTimeout(async () => {
        if (currentSongInfo) {
          try {
            const likeStatus = await songControls.getLikeStatus();
            const isLiked = likeStatus === 'LIKE';
            const isDisliked = likeStatus === 'DISLIKE';
            const updatedSongInfo = {
              ...currentSongInfo,
              isLiked,
              isDisliked,
            };
            currentSongInfo = updatedSongInfo;
            // Always show notification when button is clicked
            if (savedNotification) {
              savedNotification.close();
              savedNotification = undefined;
            }
            setTimeout(() => {
              sendNotification(updatedSongInfo);
            }, 50);
          } catch {
            // Fallback: toggle the state manually
            const updatedSongInfo = {
              ...currentSongInfo,
              isDisliked: !currentSongInfo.isDisliked,
              isLiked: currentSongInfo.isDisliked ? false : currentSongInfo.isLiked,
            };
            currentSongInfo = updatedSongInfo;
            if (savedNotification) {
              savedNotification.close();
              savedNotification = undefined;
            }
            setTimeout(() => {
              sendNotification(updatedSongInfo);
            }, 50);
          }
        }
      }, 250);
    } else if (cmd === 'play') {
      // Update isPaused state and call play
      const updatedSongInfo = { ...currentSongInfo, isPaused: false };
      currentSongInfo = updatedSongInfo;
      songControls.play();
      // Always show notification when button is clicked
      if (savedNotification) {
        savedNotification.close();
        savedNotification = undefined;
      }
      setTimeout(() => {
        sendNotification(updatedSongInfo);
      }, 50);
    } else if (cmd === 'pause') {
      // Update isPaused state and call pause
      const updatedSongInfo = { ...currentSongInfo, isPaused: true };
      currentSongInfo = updatedSongInfo;
      songControls.pause();
      // Always show notification when button is clicked
      if (savedNotification) {
        savedNotification.close();
        savedNotification = undefined;
      }
      setTimeout(() => {
        sendNotification(updatedSongInfo);
      }, 50);
    } else if (Object.keys(songControls).includes(cmd)) {
      (songControls as any)[cmd]();
    }
  });

  if (config().trayControls) {
    setTrayOnClick(() => {
      if (savedNotification) {
        savedNotification.close();
      } else if (currentSongInfo) {
        sendNotification(currentSongInfo);
      }
    });

    setTrayOnDoubleClick(() => win.isVisible() ? win.hide() : win.show());
  }

  app.once('before-quit', () => savedNotification?.close());
};
