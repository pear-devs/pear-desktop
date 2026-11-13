/* oxlint-disable */
/* Adapted from Venipa/ytmdesktop2, licensed CC0 1.0 (repository LICENSE;
 * package metadata says MIT). See THIRD_PARTY_CAST.md for source and notices.
 * Page world. Keep official chrome.cast types; route transport through __ytmdCastBridge. */
(function () {
  var bridge = window.__ytmdCastBridge;
  if (!bridge || window.__ytmdCastProxyInstalled) return;
  window.__ytmdCastProxyInstalled = true;

  function CastError(code, description) {
    this.code = code;
    this.description = description || '';
    this.details = null;
  }

  var ErrorCode = {
    CANCEL: 'cancel',
    API_NOT_INITIALIZED: 'api_not_initialized',
    SESSION_ERROR: 'session_error',
    CHANNEL_ERROR: 'channel_error',
    LOAD_MEDIA_FAILED: 'load_media_failed',
  };

  var sessions = {};
  var apiConfig = null;
  var initialized = false;
  var autoResumeRequested = false;
  var mediaRequestId = 1;
  var officialCast = null;
  var MEDIA_NS = 'urn:x-cast:com.google.cast.media';

  function nextMediaRequestId() {
    mediaRequestId += 1;
    return mediaRequestId;
  }

  function parseJson(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    try {
      return JSON.parse(data);
    } catch (_e) {
      return null;
    }
  }

  function fireList(list, arg) {
    (list || []).slice().forEach(function (fn) {
      try {
        fn(arg);
      } catch (_e) {
        /* ignore */
      }
    });
  }

  function makeVolume(level, muted) {
    var Ctor = officialCast && officialCast.Volume;
    if (typeof Ctor === 'function') return new Ctor(level, muted);
    return {
      level: typeof level === 'number' ? level : null,
      muted: typeof muted === 'boolean' ? muted : null,
    };
  }

  function makeReceiver(snap) {
    var name = (snap && snap.receiver && snap.receiver.name) || '';
    var vol = snap && snap.receiver && snap.receiver.volume;
    var volume = makeVolume(vol && vol.level, vol && vol.muted);
    var caps = [];
    if (officialCast && officialCast.Capability) {
      if (officialCast.Capability.VIDEO_OUT)
        caps.push(officialCast.Capability.VIDEO_OUT);
      if (officialCast.Capability.AUDIO_OUT)
        caps.push(officialCast.Capability.AUDIO_OUT);
    }
    if (!caps.length) caps = ['video_out', 'audio_out'];
    var Ctor = officialCast && officialCast.Receiver;
    var rec;
    if (typeof Ctor === 'function')
      rec = new Ctor(name || snap.handle, name, caps, volume);
    else
      rec = {
        label: name || snap.handle,
        friendlyName: name,
        capabilities: caps,
        volume: volume,
        receiverType: 'cast',
      };
    if (snap && snap.statusText)
      rec.displayStatus = {
        statusText: snap.statusText,
        appImages: [],
        showStop: null,
      };
    if (officialCast && officialCast.ReceiverType)
      rec.receiverType = officialCast.ReceiverType.CAST;
    return rec;
  }

  function notifyCastSession() {
    var connected = Object.keys(sessions).length > 0;
    window.__ytmdCastConnected = connected;
    try {
      window.dispatchEvent(
        new CustomEvent('ytmd-cast-session', {
          detail: { connected: connected },
        }),
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function bindSession(session, handle) {
    session.__ytmdHandle = handle;
    session.__updateListeners = session.__updateListeners || [];
    session.__mediaListeners = session.__mediaListeners || [];
    session.__mediaStatusListeners = session.__mediaStatusListeners || [];
    session.__messageListeners = session.__messageListeners || {};
    if (!Array.isArray(session.media)) session.media = [];

    session.addUpdateListener = function (listener) {
      this.__updateListeners.push(listener);
    };
    session.removeUpdateListener = function (listener) {
      this.__updateListeners = this.__updateListeners.filter(function (fn) {
        return fn !== listener;
      });
    };
    session.addMessageListener = function (namespace, listener) {
      if (!this.__messageListeners[namespace])
        this.__messageListeners[namespace] = [];
      this.__messageListeners[namespace].push(listener);
    };
    session.removeMessageListener = function (namespace, listener) {
      var list = this.__messageListeners[namespace] || [];
      this.__messageListeners[namespace] = list.filter(function (fn) {
        return fn !== listener;
      });
    };
    session.addMediaListener = function (listener) {
      this.__mediaListeners.push(listener);
    };
    session.removeMediaListener = function (listener) {
      this.__mediaListeners = this.__mediaListeners.filter(function (fn) {
        return fn !== listener;
      });
    };
    session.sendMessage = function (namespace, message, success, error) {
      var payload =
        typeof message === 'string' ? message : JSON.stringify(message);
      bridge
        .sendMessage(this.__ytmdHandle, namespace, payload)
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.CHANNEL_ERROR, String(err)));
        });
    };
    session.stop = function (success, error) {
      bridge
        .stop(this.__ytmdHandle)
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
        });
    };
    session.leave = function (success, error) {
      bridge
        .leave(this.__ytmdHandle)
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
        });
    };
    session.setReceiverVolumeLevel = function (level, success, error) {
      bridge
        .setVolume(this.__ytmdHandle, level)
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
        });
    };
    session.setReceiverMuted = function (muted, success, error) {
      bridge
        .setMuted(this.__ytmdHandle, muted)
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
        });
    };
    function sendMediaLoad(kind, request, success, error) {
      var self = this;
      var settled = false;
      var expectedId =
        kind === 'queue'
          ? request &&
            request.items &&
            request.items[request.startIndex || 0] &&
            request.items[request.startIndex || 0].media &&
            request.items[request.startIndex || 0].media.contentId
          : request && request.media && request.media.contentId;
      function finishOk(media) {
        if (settled) return;
        settled = true;
        self.__mediaStatusListeners = self.__mediaStatusListeners.filter(
          function (fn) {
            return fn !== onMedia;
          },
        );
        if (success) success(media);
      }
      function finishErr(err) {
        if (settled) return;
        settled = true;
        self.__mediaStatusListeners = self.__mediaStatusListeners.filter(
          function (fn) {
            return fn !== onMedia;
          },
        );
        if (error)
          error(new CastError(ErrorCode.LOAD_MEDIA_FAILED, String(err)));
      }
      function onMedia(media) {
        if (expectedId && media.media?.contentId !== expectedId) return;
        finishOk(media);
      }
      self.__mediaStatusListeners.push(onMedia);
      (kind === 'queue'
        ? bridge.queueLoad(self.__ytmdHandle, request || {})
        : bridge.loadMedia(self.__ytmdHandle, request || {})
      )
        .then(function () {
          if (settled) return;
          window.setTimeout(function () {
            finishErr('timeout');
          }, 8000);
        })
        .catch(finishErr);
    }
    session.loadMedia = function (request, success, error) {
      sendMediaLoad.call(this, 'load', request, success, error);
    };
    session.queueLoad = function (request, success, error) {
      sendMediaLoad.call(this, 'queue', request, success, error);
    };
    return session;
  }

  function bindMedia(media, handle) {
    media.__ytmdHandle = handle;
    media.__updateListeners = media.__updateListeners || [];
    media.__statusAt = Date.now();
    media.addUpdateListener = function (listener) {
      this.__updateListeners.push(listener);
    };
    media.removeUpdateListener = function (listener) {
      this.__updateListeners = this.__updateListeners.filter(function (fn) {
        return fn !== listener;
      });
    };
    media.getEstimatedTime = function () {
      if (this.playerState !== 'PLAYING') return this.currentTime || 0;
      var elapsed = (Date.now() - this.__statusAt) / 1000;
      return (this.currentTime || 0) + elapsed * (this.playbackRate || 1);
    };
    function sendCmd(body, success, error) {
      body.requestId = nextMediaRequestId();
      body.mediaSessionId = media.mediaSessionId;
      bridge
        .sendMessage(handle, MEDIA_NS, JSON.stringify(body))
        .then(function () {
          if (success) success();
        })
        .catch(function (err) {
          if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
        });
    }
    media.play = function (customData, success, error) {
      if (typeof customData === 'function') {
        error = success;
        success = customData;
        customData = null;
      }
      sendCmd({ type: 'PLAY', customData: customData || null }, success, error);
    };
    media.pause = function (customData, success, error) {
      if (typeof customData === 'function') {
        error = success;
        success = customData;
        customData = null;
      }
      sendCmd(
        { type: 'PAUSE', customData: customData || null },
        success,
        error,
      );
    };
    media.stop = function (customData, success, error) {
      if (typeof customData === 'function') {
        error = success;
        success = customData;
        customData = null;
      }
      sendCmd({ type: 'STOP', customData: customData || null }, success, error);
    };
    media.getStatus = function (customData, success, error) {
      if (typeof customData === 'function') {
        error = success;
        success = customData;
        customData = null;
      }
      sendCmd(
        { type: 'GET_STATUS', customData: customData || null },
        success,
        error,
      );
    };
    media.seek = function (seekRequest, success, error) {
      sendCmd(
        {
          type: 'SEEK',
          currentTime:
            seekRequest && typeof seekRequest.currentTime === 'number'
              ? seekRequest.currentTime
              : 0,
          resumeState: (seekRequest && seekRequest.resumeState) || null,
          customData: (seekRequest && seekRequest.customData) || null,
        },
        success,
        error,
      );
    };
    media.setVolume = function (volume, success, error) {
      sendCmd(
        {
          type: 'SET_VOLUME',
          volume: volume && volume.volume ? volume.volume : volume,
        },
        success,
        error,
      );
    };
    return media;
  }

  function createSession(snap) {
    var session = null;
    try {
      var SessionCtor = officialCast && officialCast.Session;
      if (typeof SessionCtor === 'function') {
        session = new SessionCtor(
          snap.sessionId,
          snap.appId,
          snap.displayName,
          [],
          makeReceiver(snap),
        );
      }
    } catch (_e) {
      session = null;
    }
    if (!session) {
      session = {
        sessionId: snap.sessionId,
        appId: snap.appId,
        displayName: snap.displayName,
        statusText: snap.statusText || null,
        namespaces: snap.namespaces || [],
        senderApps: [],
        receiver: makeReceiver(snap),
        media: [],
      };
    }
    session.sessionId = snap.sessionId;
    session.appId = snap.appId;
    session.displayName = snap.displayName;
    session.statusText = snap.statusText || session.statusText || null;
    session.namespaces = snap.namespaces || session.namespaces || [];
    session.receiver = makeReceiver(snap);
    session.status =
      officialCast && officialCast.SessionStatus
        ? officialCast.SessionStatus.CONNECTED
        : 'connected';
    bindSession(session, snap.handle);
    sessions[snap.handle] = session;
    notifyCastSession();
    return session;
  }

  function requestMediaStatus(session) {
    window.setTimeout(function () {
      if (!sessions[session.__ytmdHandle]) return;
      bridge
        .sendMessage(
          session.__ytmdHandle,
          MEDIA_NS,
          JSON.stringify({
            type: 'GET_STATUS',
            requestId: nextMediaRequestId(),
          }),
        )
        .catch(function () {
          /* The receiver may have ended the session meanwhile. */
        });
    }, 0);
  }

  function announceSession(snap, success) {
    var session = sessions[snap.handle] || createSession(snap);
    if (
      !session.__announced &&
      apiConfig &&
      typeof apiConfig.sessionListener === 'function'
    ) {
      session.__announced = true;
      try {
        apiConfig.sessionListener(session);
      } catch (_e) {
        /* ignore */
      }
    }
    if (success) success(session);
    requestMediaStatus(session);
    return session;
  }

  function createMedia(session, status) {
    var media = null;
    try {
      var MediaCtor =
        officialCast && officialCast.media && officialCast.media.Media;
      if (typeof MediaCtor === 'function')
        media = new MediaCtor(session.sessionId, status.mediaSessionId);
    } catch (_e) {
      media = null;
    }
    if (!media) media = {};
    applyMediaFields(media, status);
    media.sessionId = session.sessionId;
    bindMedia(media, session.__ytmdHandle);
    return media;
  }

  function applyMediaFields(media, status) {
    media.mediaSessionId = status.mediaSessionId;
    media.currentTime =
      typeof status.currentTime === 'number'
        ? status.currentTime
        : media.currentTime || 0;
    media.playerState = status.playerState || media.playerState || 'IDLE';
    media.playbackRate =
      typeof status.playbackRate === 'number'
        ? status.playbackRate
        : media.playbackRate || 1;
    media.idleReason = status.idleReason || null;
    media.supportedMediaCommands = status.supportedMediaCommands;
    media.customData = status.customData || null;
    media.repeatMode = status.repeatMode || media.repeatMode;
    media.activeTrackIds = status.activeTrackIds || null;
    media.items = status.items || null;
    media.currentItemId =
      status.currentItemId != null ? status.currentItemId : media.currentItemId;
    if (status.volume)
      media.volume = makeVolume(status.volume.level, status.volume.muted);
    if (status.media) media.media = status.media;
    media.__statusAt = Date.now();
  }

  function applyUpdate(handle, snap) {
    var session = sessions[handle];
    if (!session || !snap) return;
    session.sessionId = snap.sessionId;
    session.displayName = snap.displayName;
    session.status =
      snap.status === 'connected'
        ? officialCast && officialCast.SessionStatus
          ? officialCast.SessionStatus.CONNECTED
          : 'connected'
        : 'disconnected';
    session.statusText = snap.statusText || session.statusText;
    session.namespaces = snap.namespaces || [];
    session.receiver = makeReceiver(snap);
    fireList(session.__updateListeners, true);
  }

  function applyStopped(handle) {
    var session = sessions[handle];
    if (!session) return;
    session.status =
      officialCast && officialCast.SessionStatus
        ? officialCast.SessionStatus.STOPPED
        : 'stopped';
    (session.media || []).forEach(function (media) {
      fireList(media.__updateListeners, false);
    });
    fireList(session.__updateListeners, false);
    delete sessions[handle];
    notifyCastSession();
  }

  function applyMediaStatus(session, raw) {
    var parsed = parseJson(raw);
    if (
      !parsed ||
      parsed.type !== 'MEDIA_STATUS' ||
      !Array.isArray(parsed.status)
    )
      return;
    parsed.status.forEach(function (status) {
      if (!status || status.mediaSessionId == null) return;
      var existing = null;
      for (var i = 0; i < session.media.length; i++) {
        if (session.media[i].mediaSessionId === status.mediaSessionId) {
          existing = session.media[i];
          break;
        }
      }
      var isNew = !existing;
      if (!existing) {
        existing = createMedia(session, status);
        session.media.push(existing);
      } else {
        applyMediaFields(existing, status);
      }
      if (isNew) fireList(session.__mediaListeners, existing);
      fireList(session.__mediaStatusListeners, existing);
      var idleDead =
        existing.playerState === 'IDLE' &&
        (existing.idleReason === 'FINISHED' ||
          existing.idleReason === 'ERROR' ||
          existing.idleReason === 'CANCELLED');
      fireList(existing.__updateListeners, !idleDead);
      if (idleDead) {
        session.media = session.media.filter(function (item) {
          return item !== existing;
        });
      }
    });
    fireList(session.__updateListeners, true);
  }

  function applyMessage(handle, namespace, data) {
    var session = sessions[handle];
    if (!session) return;
    if (namespace === MEDIA_NS) applyMediaStatus(session, data);
    var named = session.__messageListeners[namespace];
    if (named) {
      named.slice().forEach(function (fn) {
        try {
          fn(namespace, data);
        } catch (_e) {
          /* ignore */
        }
      });
    }
  }

  bridge.onEvent(function (evt) {
    if (!evt || !evt.type) return;
    if (evt.type === 'auto-connected') announceSession(evt.snapshot);
    else if (evt.type === 'update') applyUpdate(evt.handle, evt.snapshot);
    else if (evt.type === 'stopped') applyStopped(evt.handle);
    else if (evt.type === 'message')
      applyMessage(evt.handle, evt.namespace, evt.data);
  });

  // YouTube Music's connected Cast button opens Chrome's own Cast dialog.
  // Electron has no such dialog, so give the active session a stop control.
  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (
        !target ||
        typeof target.closest !== 'function' ||
        !target.closest('.right-content ytmusic-cast-button')
      )
        return;
      var handles = Object.keys(sessions);
      if (!handles.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      var handle = handles[handles.length - 1];
      bridge
        .confirmStop(handle)
        .then(function (confirmed) {
          if (confirmed) return bridge.stop(handle);
        })
        .catch(function (error) {
          window.alert('Could not stop casting: ' + String(error));
        });
    },
    true,
  );

  function ourInitialize(config, success, error) {
    apiConfig = config;
    var appId = config && config.sessionRequest && config.sessionRequest.appId;
    bridge
      .initialize({ appId: appId || '' })
      .then(function () {
        initialized = true;
        var availability =
          officialCast && officialCast.ReceiverAvailability
            ? officialCast.ReceiverAvailability.AVAILABLE
            : 'available';
        if (config && typeof config.receiverListener === 'function') {
          try {
            config.receiverListener(availability);
          } catch (_e) {
            /* ignore */
          }
        }
        if (success) success();
        if (!autoResumeRequested) {
          autoResumeRequested = true;
          bridge
            .resumeSession()
            .then(function (result) {
              if (result && result.snapshot) {
                announceSession(result.snapshot);
                return;
              }
              if (
                result &&
                result.fallbackUrl &&
                location.pathname === '/' &&
                !location.search
              ) {
                try {
                  var fallback = new URL(result.fallbackUrl);
                  if (
                    fallback.origin === 'https://music.youtube.com' &&
                    fallback.href !== location.href
                  )
                    location.replace(fallback.href);
                } catch (_e) {
                  /* ignore invalid saved URL */
                }
              }
            })
            .catch(function () {
              /* Manual casting remains available. */
            });
        }
      })
      .catch(function (err) {
        if (error)
          error(new CastError(ErrorCode.API_NOT_INITIALIZED, String(err)));
      });
  }

  function ourRequestSession(success, error) {
    if (!initialized) {
      if (error)
        error(new CastError(ErrorCode.API_NOT_INITIALIZED, 'not initialized'));
      return;
    }
    bridge
      .requestSession()
      .then(function (snap) {
        if (!snap) {
          if (error) error(new CastError(ErrorCode.CANCEL, 'cancelled'));
          return;
        }
        announceSession(snap, success);
      })
      .catch(function (err) {
        if (error) error(new CastError(ErrorCode.SESSION_ERROR, String(err)));
      });
  }

  function wrapOfficial(cast) {
    if (!cast || typeof cast !== 'object') return cast;
    officialCast = cast;
    cast.__ytmdProxied = true;
    cast.isAvailable = true;
    cast.initialize = ourInitialize;
    cast.requestSession = ourRequestSession;
    return cast;
  }

  function trapChrome(chromeObj) {
    if (!chromeObj || typeof chromeObj !== 'object') return;
    var held = chromeObj.cast;
    if (held) held = wrapOfficial(held);
    try {
      Object.defineProperty(chromeObj, 'cast', {
        configurable: true,
        enumerable: true,
        get: function () {
          return held;
        },
        set: function (value) {
          held = wrapOfficial(value);
        },
      });
    } catch (_e) {
      if (chromeObj.cast) wrapOfficial(chromeObj.cast);
    }
  }

  var chromeHost =
    window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
  trapChrome(chromeHost);
  try {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      enumerable: true,
      get: function () {
        return chromeHost;
      },
      set: function (next) {
        if (!next || typeof next !== 'object') return;
        chromeHost = next;
        trapChrome(chromeHost);
      },
    });
  } catch (_e) {
    window.chrome = chromeHost;
    trapChrome(window.chrome);
  }

  var gcastCb = window.__onGCastApiAvailable;
  function wrapGcastCb(fn) {
    if (typeof fn !== 'function') return fn;
    return function (available, err) {
      if (window.chrome && window.chrome.cast) wrapOfficial(window.chrome.cast);
      try {
        fn(available, err);
      } catch (_e) {
        /* ignore */
      }
    };
  }
  try {
    Object.defineProperty(window, '__onGCastApiAvailable', {
      configurable: true,
      enumerable: true,
      get: function () {
        return gcastCb;
      },
      set: function (fn) {
        gcastCb = wrapGcastCb(fn);
      },
    });
    if (typeof gcastCb === 'function') gcastCb = wrapGcastCb(gcastCb);
  } catch (_e) {
    /* ignore */
  }

  var polls = 0;
  var poll = window.setInterval(function () {
    polls += 1;
    if (window.chrome && window.chrome.cast) wrapOfficial(window.chrome.cast);
    if ((officialCast && officialCast.__ytmdProxied) || polls > 80)
      window.clearInterval(poll);
  }, 250);
})();
