#!/usr/bin/env node
// YouTube Music Playback Monitor
// Connects via Chrome DevTools Protocol and watches for anything that stops playback.

const http = require('http');
const { WebSocket } = require('ws');

const CDP_PORT = 9222;
let msgId = 1;

function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function log(tag, msg) {
  const colors = {
    INFO: '\x1b[36m',
    PLAY: '\x1b[32m',
    PAUSE: '\x1b[31m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31;1m',
    EVENT: '\x1b[35m',
    DIALOG: '\x1b[33;1m',
    NET: '\x1b[34m',
    CONSOLE: '\x1b[90m',
  };
  const c = colors[tag] || '\x1b[0m';
  console.log(`${c}[${timestamp()}] [${tag}]\x1b[0m ${msg}`);
}

// Get list of debuggable pages from CDP
function getPages() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Send a CDP command over WebSocket
function send(ws, method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        ws.removeListener('message', handler);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('timeout')); }, 10000);
  });
}

async function main() {
  log('INFO', 'Connecting to CDP on port ' + CDP_PORT + '...');

  let pages;
  try {
    pages = await getPages();
  } catch (e) {
    log('ERROR', 'Cannot connect to YouTube Music. Is it running with --remote-debugging-port=' + CDP_PORT + '?');
    log('ERROR', 'Run diagnose.bat to start it in debug mode.');
    process.exit(1);
  }

  // Find the YouTube Music page (not devtools, not extensions)
  const target = pages.find(p =>
    p.type === 'page' && (p.url.includes('music.youtube') || p.title.includes('YouTube Music'))
  ) || pages.find(p => p.type === 'page');

  if (!target) {
    log('ERROR', 'No suitable page found. Pages available:');
    pages.forEach(p => log('INFO', '  ' + p.type + ': ' + p.title + ' - ' + p.url));
    process.exit(1);
  }

  log('INFO', 'Found target: "' + target.title + '" - ' + target.url);
  log('INFO', 'Connecting WebSocket...');

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('INFO', 'Connected. Enabling CDP domains...');

  // Enable domains we need
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Network.enable');

  log('INFO', 'Injecting playback monitor into page...');

  // Inject a comprehensive flicker-aware monitor into the page
  await send(ws, 'Runtime.evaluate', {
    expression: `
    (function() {
      if (self['__ytm_mon']) return 'already running';
      self['__ytm_mon'] = true;

      var LOG_PREFIX = '[YTM-MONITOR]';

      // === FLICKER DETECTION STATE ===
      var eventLog = [];           // rolling window of recent events
      var flickerWindow = 5000;    // 5 second window to detect rapid cycling
      var videoElementCount = 0;   // track video element creation
      var lastSrc = '';            // track source changes
      var lastReadyState = -1;     // track readyState drops

      function logFlicker(msg) {
        console.warn(LOG_PREFIX, 'FLICKER: ' + msg);
      }

      function recordEvent(name) {
        var now = Date.now();
        eventLog.push({ name: name, ts: now });
        // keep only last 10 seconds
        while (eventLog.length > 0 && now - eventLog[0].ts > 10000) {
          eventLog.shift();
        }
        // Check for rapid play/pause cycling
        var recentWindow = eventLog.filter(function(e) { return now - e.ts < flickerWindow; });
        var plays = recentWindow.filter(function(e) { return e.name === 'play' || e.name === 'playing'; });
        var pauses = recentWindow.filter(function(e) { return e.name === 'pause'; });
        var waits = recentWindow.filter(function(e) { return e.name === 'waiting'; });
        if (plays.length >= 3 && pauses.length >= 2) {
          logFlicker('RAPID-CYCLE: ' + plays.length + ' plays + ' + pauses.length + ' pauses in ' + flickerWindow + 'ms window');
        }
        if (waits.length >= 3) {
          logFlicker('REPEAT-BUFFERING: ' + waits.length + ' waiting events in ' + flickerWindow + 'ms window');
        }
      }

      function getVideo() {
        return document.querySelector('video') || document.querySelector('audio');
      }

      function watchVideo(video) {
        if (video['__mon']) return;
        video['__mon'] = true;
        videoElementCount++;

        if (videoElementCount > 1) {
          logFlicker('VIDEO-ELEMENT-RECREATED: this is element #' + videoElementCount + ' (previous was destroyed)');
        }

        console.log(LOG_PREFIX, 'ATTACHED to video element #' + videoElementCount + '. State:',
          'paused=' + video.paused,
          'readyState=' + video.readyState,
          'networkState=' + video.networkState,
          'currentTime=' + video.currentTime,
          'duration=' + video.duration,
          'src=' + (video.src || '(none)').substring(0, 100)
        );

        lastSrc = video.src || '';
        lastReadyState = video.readyState;

        var mediaEvents = [
          'play', 'playing', 'pause', 'ended', 'waiting', 'stalled',
          'suspend', 'emptied', 'abort', 'error', 'seeked', 'seeking',
          'loadstart', 'loadeddata', 'canplay', 'canplaythrough',
          'timeupdate', 'volumechange', 'ratechange'
        ];

        var lastTime = 0;
        var lastTimeUpdate = Date.now();

        mediaEvents.forEach(function(evt) {
          video.addEventListener(evt, function(e) {
            if (evt === 'timeupdate') {
              var now = Date.now();
              var timeDelta = video.currentTime - lastTime;
              var wallDelta = now - lastTimeUpdate;

              // Check for stall
              if (timeDelta === 0 && wallDelta > 3000 && !video.paused) {
                console.warn(LOG_PREFIX, 'STALL-DETECTED: currentTime frozen for ' + wallDelta + 'ms but not paused!',
                  'readyState=' + video.readyState,
                  'networkState=' + video.networkState,
                  'buffered=' + (video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1).toFixed(1) : '0')
                );
              }

              // Check for readyState drops (4→2 or 4→1 = lost data)
              if (video.readyState < lastReadyState && lastReadyState >= 3) {
                logFlicker('READYSTATE-DROP: ' + lastReadyState + ' -> ' + video.readyState + ' (lost buffered data)');
              }
              lastReadyState = video.readyState;

              // Check for source change mid-song
              var curSrc = video.src || '';
              if (curSrc && lastSrc && curSrc !== lastSrc && video.currentTime > 0) {
                logFlicker('SRC-CHANGED-MID-SONG: at time=' + video.currentTime.toFixed(1) +
                  ' old=' + lastSrc.substring(0, 80) + ' new=' + curSrc.substring(0, 80));
              }
              if (curSrc) lastSrc = curSrc;

              lastTime = video.currentTime;
              lastTimeUpdate = now;
              return;
            }

            // Record for flicker detection
            recordEvent(evt);

            var info = [
              'paused=' + video.paused,
              'readyState=' + video.readyState,
              'networkState=' + video.networkState,
              'time=' + video.currentTime.toFixed(1) + '/' + (video.duration || 0).toFixed(1),
            ];

            // Extra detail for flicker-related events
            if (video.buffered.length > 0) {
              info.push('bufEnd=' + video.buffered.end(video.buffered.length - 1).toFixed(1));
            }

            if (evt === 'error' && video.error) {
              info.push('errorCode=' + video.error.code, 'errorMsg=' + video.error.message);
            }

            if (evt === 'pause') {
              var stack = new Error().stack;
              info.push('\\nCALLSTACK:\\n' + stack);
            }

            if (evt === 'waiting') {
              info.push('(BUFFERING - may cause flicker)');
            }

            if (evt === 'loadstart') {
              info.push('src=' + (video.src || '(none)').substring(0, 100));
            }

            var level = ['pause', 'error', 'abort', 'emptied', 'stalled', 'suspend', 'ended', 'waiting'].includes(evt) ? 'warn' : 'log';
            console[level](LOG_PREFIX, evt.toUpperCase(), info.join(' '));
          });
        });

        // === WATCH FOR CSS VISIBILITY CHANGES ON PLAYER ===
        var playerEl = document.querySelector('ytmusic-player');
        var songVideo = document.querySelector('#song-video');
        var songImage = document.querySelector('#song-image');
        [playerEl, songVideo, songImage].forEach(function(el) {
          if (!el || el['__visMon']) return;
          el['__visMon'] = true;
          var visObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
              if (m.type === 'attributes') {
                var tag = el.id || el.tagName;
                if (m.attributeName === 'style') {
                  console.warn(LOG_PREFIX, 'STYLE-CHANGE: ' + tag + ' style="' + (el.getAttribute('style') || '').substring(0, 150) + '"');
                }
                if (m.attributeName === 'playback-mode') {
                  console.warn(LOG_PREFIX, 'PLAYBACK-MODE-CHANGE: ' + tag + ' mode=' + el.getAttribute('playback-mode'));
                }
                if (m.attributeName === 'class') {
                  console.warn(LOG_PREFIX, 'CLASS-CHANGE: ' + tag + ' class="' + el.className + '"');
                }
                if (m.attributeName === 'hidden') {
                  console.warn(LOG_PREFIX, 'HIDDEN-CHANGE: ' + tag + ' hidden=' + el.hidden);
                }
              }
            });
          });
          visObserver.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'playback-mode', 'hidden'] });
        });

        // Monitor for the "Are you still listening?" popup
        var observer = new MutationObserver(function(mutations) {
          for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            for (var j = 0; j < m.addedNodes.length; j++) {
              var node = m.addedNodes[j];
              if (node.nodeType === 1) {
                var text = node.textContent || '';
                if (text.includes('still listening') || text.includes('still watching') ||
                    text.includes('Video paused') || text.includes('Continue watching') ||
                    text.includes('still there')) {
                  console.warn(LOG_PREFIX, 'POPUP-DETECTED:', text.substring(0, 200));
                }
                if (node.tagName === 'TP-YT-PAPER-DIALOG' || node.tagName === 'YTD-POPUP-CONTAINER' ||
                    (node.classList && node.classList.contains('ytmusic-popup-container')) ||
                    (node.classList && node.classList.contains('dialog')) ||
                    (node.getAttribute && node.getAttribute('role') === 'dialog')) {
                  console.warn(LOG_PREFIX, 'DIALOG-ELEMENT-ADDED:', node.tagName, node.className, text.substring(0, 200));
                }
              }
            }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }

      // === WATCH FOR VIDEO ELEMENT DESTRUCTION/RECREATION ===
      var bodyObserver = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          for (var j = 0; j < m.removedNodes.length; j++) {
            var node = m.removedNodes[j];
            if (node.nodeType === 1 && (node.tagName === 'VIDEO' || node.tagName === 'AUDIO')) {
              logFlicker('VIDEO-ELEMENT-REMOVED from DOM');
            }
          }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1 && (node.tagName === 'VIDEO' || node.tagName === 'AUDIO')) {
              logFlicker('VIDEO-ELEMENT-ADDED to DOM — will re-attach monitor');
              watchVideo(node);
            }
          }
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });

      // Intercept fetch for media segment failures
      var origFetch = self['fetch'];
      self['fetch'] = function() {
        var args = arguments;
        return origFetch.apply(self, args).then(function(resp) {
          var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (!resp.ok && (url.includes('googlevideo') || url.includes('videoplayback'))) {
            console.error(LOG_PREFIX, 'MEDIA-FETCH-FAILED:', resp.status, resp.statusText, url.substring(0, 120));
          }
          return resp;
        }).catch(function(err) {
          var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (url.includes('googlevideo') || url.includes('videoplayback')) {
            console.error(LOG_PREFIX, 'MEDIA-FETCH-ERROR:', err.message, url.substring(0, 120));
          }
          throw err;
        });
      };

      setInterval(function() {
        var v = getVideo();
        if (v) watchVideo(v);
      }, 2000);

      var v = getVideo();
      if (v) watchVideo(v);

      return 'flicker monitor injected';
    })()
    `,
    returnByValue: true
  });

  log('INFO', '');
  log('INFO', '========================================');
  log('INFO', '  MONITORING ACTIVE - Play some music');
  log('INFO', '  Watching for pause/stop events...');
  log('INFO', '========================================');
  log('INFO', '');

  // Listen to all CDP events
  ws.on('message', function(raw) {
    var msg = JSON.parse(raw);
    if (!msg.method) return;

    // Console messages from the page (our injected monitor logs here)
    if (msg.method === 'Runtime.consoleAPICalled') {
      var args = msg.params.args.map(function(a) { return a.value || a.description || ''; }).join(' ');
      if (args.includes('[YTM-MONITOR]')) {
        var clean = args.replace('[YTM-MONITOR] ', '');
        if (clean.startsWith('FLICKER')) {
          log('WARN', '>>> ' + clean);
        } else if (clean.startsWith('PAUSE') || clean.startsWith('STALL')) {
          log('PAUSE', clean);
        } else if (clean.startsWith('PLAY')) {
          log('PLAY', clean);
        } else if (clean.startsWith('POPUP') || clean.startsWith('DIALOG')) {
          log('DIALOG', clean);
        } else if (clean.startsWith('MEDIA-FETCH')) {
          log('NET', clean);
        } else if (clean.startsWith('STYLE-CHANGE') || clean.startsWith('PLAYBACK-MODE') || clean.startsWith('CLASS-CHANGE') || clean.startsWith('HIDDEN-CHANGE')) {
          log('EVENT', clean);
        } else if (clean.startsWith('READYSTATE') || clean.startsWith('SRC-CHANGED') || clean.startsWith('VIDEO-ELEMENT')) {
          log('WARN', '>>> ' + clean);
        } else {
          log('EVENT', clean);
        }
      }
    }

    // Page-level JavaScript errors
    if (msg.method === 'Runtime.exceptionThrown') {
      var ex = msg.params.exceptionDetails;
      var text = (ex.exception && ex.exception.description) || ex.text || 'unknown';
      log('ERROR', 'JS Exception: ' + text.substring(0, 300));
    }

    // Log entries (warnings/errors from the browser)
    if (msg.method === 'Log.entryAdded') {
      var entry = msg.params.entry;
      if (entry.level === 'error' || entry.level === 'warning') {
        log('WARN', '[' + entry.source + '] ' + (entry.text || '').substring(0, 200));
      }
    }

    // JavaScript dialog (alert/confirm/prompt)
    if (msg.method === 'Page.javascriptDialogOpening') {
      log('DIALOG', 'JS Dialog: type=' + msg.params.type + ' message="' + msg.params.message + '"');
    }

    // Network failures on media resources
    if (msg.method === 'Network.loadingFailed') {
      var p = msg.params;
      if (p.type === 'Media' || p.type === 'XHR' || p.type === 'Fetch') {
        log('NET', 'Loading failed: ' + p.errorText + ' type=' + p.type + ' canceled=' + p.canceled);
      }
    }
  });

  // Keep alive
  ws.on('close', function() {
    log('ERROR', 'WebSocket closed - app may have exited.');
    process.exit(1);
  });

  ws.on('error', function(e) {
    log('ERROR', 'WebSocket error: ' + e.message);
  });

  // Periodic status check every 15 seconds
  setInterval(async function() {
    try {
      var result = await send(ws, 'Runtime.evaluate', {
        expression: `
          (function() {
            var v = document.querySelector('video') || document.querySelector('audio');
            if (!v) return 'NO VIDEO ELEMENT';
            return JSON.stringify({
              paused: v.paused,
              currentTime: v.currentTime.toFixed(1),
              duration: (v.duration || 0).toFixed(1),
              readyState: v.readyState,
              networkState: v.networkState,
              playbackRate: v.playbackRate,
              volume: v.volume.toFixed(2),
              muted: v.muted,
              ended: v.ended,
              buffered: v.buffered.length > 0 ? v.buffered.end(v.buffered.length - 1).toFixed(1) : '0'
            });
          })()
        `,
        returnByValue: true
      });
      var state = result.result && result.result.value;
      if (state && state !== 'NO VIDEO ELEMENT') {
        var s = JSON.parse(state);
        var icon = s.paused ? 'PAUSED' : 'PLAYING';
        log('INFO', icon + ' ' + s.currentTime + '/' + s.duration + 's | ready=' + s.readyState + ' net=' + s.networkState + ' buf=' + s.buffered + 's rate=' + s.playbackRate + ' vol=' + s.volume + ' muted=' + s.muted + ' ended=' + s.ended);
      }
    } catch (e) {}
  }, 15000);
}

main().catch(function(e) {
  log('ERROR', e.message);
  process.exit(1);
});
