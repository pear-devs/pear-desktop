/**
 * YTM-Immersion -> PreMiD Activity bridge.
 *
 * Discord authentication and Activity delivery stay inside PreMiD. This module
 * only publishes the currently rendered player state to a hidden DOM node so
 * the bundled YTM-Immersion PreMiD Activity can read it from any script world.
 */
(() => {
  const BRIDGE_ID = 'ytm-immersion-discord-presence';
  const BRIDGE_SCHEMA = 1;
  const POLL_INTERVAL_MS = 250;
  const SEEK_DRIFT_TOLERANCE_SECONDS = 2;

  let lastSerialized = '';
  let lastTrackIdentity = '';
  let lastPlaybackState = 'idle';
  let playbackStartedAt = null;
  let playbackEndsAt = null;
  let attachedMedia = null;
  const MEDIA_EVENTS = [
    'play',
    'playing',
    'pause',
    'ended',
    'seeking',
    'seeked',
    'timeupdate',
    'ratechange',
    'durationchange',
    'loadedmetadata',
    'emptied'
  ];

  const normalizeText = (value, maxLength = 512) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  };

  const normalizeUrl = (value) => {
    if (!value) return '';
    try {
      const url = new URL(String(value), location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  };

  const readMetadata = () => {
    try {
      if (typeof getMetadata === 'function') {
        const metadata = getMetadata();
        if (metadata) return metadata;
      }
    } catch (e) {
      // Fall through to Media Session / DOM metadata.
    }

    const mediaMetadata = navigator.mediaSession && navigator.mediaSession.metadata;
    if (mediaMetadata) {
      const artwork = Array.isArray(mediaMetadata.artwork)
        ? mediaMetadata.artwork[mediaMetadata.artwork.length - 1]
        : null;
      return {
        title: mediaMetadata.title || '',
        artist: mediaMetadata.artist || '',
        album: mediaMetadata.album || '',
        src: artwork && artwork.src ? artwork.src : ''
      };
    }

    const title = document.querySelector(
      'ytmusic-player-bar .title, yt-formatted-string.title.style-scope.ytmusic-player-bar'
    );
    const byline = document.querySelector('ytmusic-player-bar .byline');
    const bylineParts = String(byline && byline.textContent ? byline.textContent : '')
      .split('•')
      .map(part => part.trim())
      .filter(Boolean);
    const artwork = document.querySelector(
      '#ytm-artwork-container img, #song-image img, ytmusic-player-bar img#img'
    );

    return {
      title: title && title.textContent ? title.textContent.trim() : '',
      artist: bylineParts[0] || '',
      album: bylineParts[1] || '',
      src: artwork && artwork.src ? artwork.src : ''
    };
  };

  const readCurrentLyric = () => {
    try {
      const playbackLyricReader = globalThis.YTMImmersionDiscordLyrics
        && globalThis.YTMImmersionDiscordLyrics.getCurrentPlaybackLyricText;
      if (typeof playbackLyricReader === 'function') {
        const resolvedLyric = playbackLyricReader();
        if (typeof resolvedLyric === 'string') {
          return normalizeText(resolvedLyric);
        }
      } else if (typeof getCurrentPlaybackLyricText === 'function') {
        const resolvedLyric = getCurrentPlaybackLyricText();
        if (typeof resolvedLyric === 'string') {
          return normalizeText(resolvedLyric);
        }
      }
    } catch (e) {
      // Fall through while timed lyric data is still loading.
    }

    const animatedCues = Array.from(
      document.querySelectorAll('.ytm-animated-caption-stage .ytm-animated-caption-cue')
    )
      .map(cue => normalizeText(cue.textContent))
      .filter(Boolean);
    if (animatedCues.length) {
      return animatedCues[animatedCues.length - 1];
    }

    const activeLines = Array.from(
      document.querySelectorAll('#my-lyrics-container .lyric-line.active')
    )
      .map(row => {
        const main = row.querySelector('.lyric-main');
        return normalizeText((main || row).textContent);
      })
      .filter((line, index, lines) => line && lines.indexOf(line) === index);
    if (activeLines.length) return activeLines.join(' / ');

    try {
      if (typeof getCurrentRenderedLyricText === 'function') {
        return normalizeText(getCurrentRenderedLyricText());
      }
    } catch (e) {
      // Lyrics are optional while a song is loading.
    }
    return '';
  };

  const getMedia = () => (
    document.querySelector('video.video-stream') ||
    document.querySelector('ytmusic-player video') ||
    document.querySelector('video')
  );

  const getTrackUrl = () => {
    try {
      if (typeof getCurrentVideoUrl === 'function') {
        const url = normalizeUrl(getCurrentVideoUrl());
        if (url) return url.replace('https://youtu.be/', 'https://music.youtube.com/watch?v=');
      }
    } catch (e) {
      // Fall through to page/link based lookup.
    }

    const trackLink = document.querySelector(
      'ytmusic-player-bar a[href*="/watch?v="], ytmusic-player-bar .title a[href]'
    );
    const linkedUrl = normalizeUrl(trackLink && (trackLink.href || trackLink.getAttribute('href')));
    if (linkedUrl) return linkedUrl;

    try {
      const pageUrl = new URL(location.href);
      const videoId = pageUrl.searchParams.get('v');
      return videoId
        ? `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        : 'https://music.youtube.com/';
    } catch (e) {
      return 'https://music.youtube.com/';
    }
  };

  const updatePlaybackAnchor = (media, trackIdentity, playbackState) => {
    const currentTime = Number(media && media.currentTime);
    const duration = Number(media && media.duration);
    const now = Date.now();
    const hasCurrentTime = Number.isFinite(currentTime) && currentTime >= 0;
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const expectedTime = playbackStartedAt === null
      ? null
      : Math.max(0, (now - playbackStartedAt) / 1000);
    const seeked = (
      playbackState === 'playing' &&
      expectedTime !== null &&
      hasCurrentTime &&
      Math.abs(expectedTime - currentTime) > SEEK_DRIFT_TOLERANCE_SECONDS
    );

    if (
      trackIdentity !== lastTrackIdentity ||
      playbackState !== lastPlaybackState ||
      seeked
    ) {
      if (playbackState === 'playing' && hasCurrentTime) {
        playbackStartedAt = now - (currentTime * 1000);
        playbackEndsAt = hasDuration ? playbackStartedAt + (duration * 1000) : null;
      } else {
        playbackStartedAt = null;
        playbackEndsAt = null;
      }
    }

    lastTrackIdentity = trackIdentity;
    lastPlaybackState = playbackState;
  };

  const ensureBridgeElement = () => {
    let bridge = document.getElementById(BRIDGE_ID);
    if (bridge) return bridge;

    bridge = document.createElement('script');
    bridge.id = BRIDGE_ID;
    bridge.type = 'application/json';
    bridge.dataset.schema = String(BRIDGE_SCHEMA);
    bridge.hidden = true;
    bridge.setAttribute('aria-hidden', 'true');
    (document.head || document.documentElement).appendChild(bridge);
    return bridge;
  };

  const collectSnapshot = () => {
    const metadata = readMetadata() || {};
    const media = getMedia();
    const title = normalizeText(metadata.title, 256);
    const artist = normalizeText(metadata.artist, 256);
    const album = normalizeText(metadata.album, 256);
    const artwork = normalizeUrl(metadata.src);
    const trackUrl = getTrackUrl();
    const currentTime = Number(media && media.currentTime);
    const duration = Number(media && media.duration);
    const isReady = !!media && media.readyState > 0 && !!title;
    const playbackState = !isReady
      ? 'idle'
      : (media.ended ? 'ended' : (media.paused ? 'paused' : 'playing'));
    const trackIdentity = `${title}\u0000${artist}\u0000${trackUrl}`;

    updatePlaybackAnchor(media, trackIdentity, playbackState);

    return {
      schema: BRIDGE_SCHEMA,
      source: 'ytm-immersion',
      title,
      artist,
      album,
      artwork,
      lyric: readCurrentLyric(),
      url: trackUrl,
      playbackState,
      currentTime: Number.isFinite(currentTime) ? Math.max(0, Math.floor(currentTime)) : null,
      duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : null,
      startedAt: playbackState === 'playing' ? playbackStartedAt : null,
      endsAt: playbackState === 'playing' ? playbackEndsAt : null,
      isAdvertisement: !!document.querySelector('.ad-interrupting, .ad-showing')
    };
  };

  const syncBridge = () => {
    const bridge = ensureBridgeElement();
    const serialized = JSON.stringify(collectSnapshot());
    if (serialized === lastSerialized && bridge.textContent === serialized) return;

    lastSerialized = serialized;
    bridge.textContent = serialized;
    window.dispatchEvent(new CustomEvent('ytm-immersion-presence-update'));
  };

  const attachMediaListeners = () => {
    const media = getMedia();
    if (media === attachedMedia) return;

    if (attachedMedia && typeof attachedMedia.removeEventListener === 'function') {
      MEDIA_EVENTS.forEach(eventName => attachedMedia.removeEventListener(eventName, syncBridge));
    }

    attachedMedia = media;
    if (!media) return;
    MEDIA_EVENTS.forEach(
      eventName => media.addEventListener(eventName, syncBridge, { passive: true })
    );
  };

  syncBridge();
  attachMediaListeners();
  document.addEventListener('visibilitychange', syncBridge, { passive: true });
  document.addEventListener('freeze', syncBridge, { passive: true });
  document.addEventListener('resume', syncBridge, { passive: true });
  window.addEventListener('pageshow', syncBridge, { passive: true });
  setInterval(() => {
    attachMediaListeners();
    syncBridge();
  }, POLL_INTERVAL_MS);
})();
