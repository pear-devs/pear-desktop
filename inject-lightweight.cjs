#!/usr/bin/env node
// Injects audio-only mode + memory management into running YouTube Music via CDP
// Run after the app is started with --remote-debugging-port=9222

const http = require('http');
const { WebSocket } = require('ws');

const CDP_PORT = 9222;
let msgId = 1;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${msg}`);
}

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
    setTimeout(() => { ws.removeListener('message', handler); reject(new Error('timeout')); }, 15000);
  });
}

async function main() {
  log('Connecting to YouTube Music...');

  var pages;
  try {
    pages = await getPages();
  } catch (e) {
    log('ERROR: Cannot connect. Run diagnose.bat first.');
    process.exit(1);
  }

  var target = pages.find(function(p) {
    return p.type === 'page' && (p.url.includes('music.youtube') || p.title.includes('YouTube Music'));
  });

  if (!target) {
    log('ERROR: YouTube Music page not found');
    process.exit(1);
  }

  log('Found: ' + target.title);
  var ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise(function(resolve, reject) {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  await send(ws, 'Runtime.enable');
  await send(ws, 'Network.enable');

  log('Injecting lightweight mode...');

  // Block video network requests via CDP Network.setBlockedURLs
  // Block googlevideo URLs that serve video (not audio) segments
  await send(ws, 'Network.setBlockedURLs', {
    urls: [
      '*googlevideo.com/videoplayback*mime=video*',
      '*googlevideo.com/videoplayback*itag=13*',
      '*googlevideo.com/videoplayback*itag=17*',
      '*googlevideo.com/videoplayback*itag=18*',
      '*googlevideo.com/videoplayback*itag=22*',
      '*googlevideo.com/videoplayback*itag=36*',
      '*googlevideo.com/videoplayback*itag=37*',
      '*googlevideo.com/videoplayback*itag=38*',
      '*googlevideo.com/videoplayback*itag=82*',
      '*googlevideo.com/videoplayback*itag=83*',
      '*googlevideo.com/videoplayback*itag=84*',
      '*googlevideo.com/videoplayback*itag=85*',
      '*googlevideo.com/videoplayback*itag=133*',
      '*googlevideo.com/videoplayback*itag=134*',
      '*googlevideo.com/videoplayback*itag=135*',
      '*googlevideo.com/videoplayback*itag=136*',
      '*googlevideo.com/videoplayback*itag=137*',
      '*googlevideo.com/videoplayback*itag=160*',
      '*googlevideo.com/videoplayback*itag=242*',
      '*googlevideo.com/videoplayback*itag=243*',
      '*googlevideo.com/videoplayback*itag=244*',
      '*googlevideo.com/videoplayback*itag=245*',
      '*googlevideo.com/videoplayback*itag=246*',
      '*googlevideo.com/videoplayback*itag=247*',
      '*googlevideo.com/videoplayback*itag=248*',
      '*googlevideo.com/videoplayback*itag=271*',
      '*googlevideo.com/videoplayback*itag=278*',
      '*googlevideo.com/videoplayback*itag=298*',
      '*googlevideo.com/videoplayback*itag=299*',
      '*googlevideo.com/videoplayback*itag=302*',
      '*googlevideo.com/videoplayback*itag=303*',
      '*googlevideo.com/videoplayback*itag=308*',
      '*googlevideo.com/videoplayback*itag=313*',
      '*googlevideo.com/videoplayback*itag=315*',
      '*googlevideo.com/videoplayback*itag=330*',
      '*googlevideo.com/videoplayback*itag=331*',
      '*googlevideo.com/videoplayback*itag=332*',
      '*googlevideo.com/videoplayback*itag=333*',
      '*googlevideo.com/videoplayback*itag=334*',
      '*googlevideo.com/videoplayback*itag=335*',
      '*googlevideo.com/videoplayback*itag=336*',
      '*googlevideo.com/videoplayback*itag=337*',
      '*googlevideo.com/videoplayback*itag=394*',
      '*googlevideo.com/videoplayback*itag=395*',
      '*googlevideo.com/videoplayback*itag=396*',
      '*googlevideo.com/videoplayback*itag=397*',
      '*googlevideo.com/videoplayback*itag=398*',
      '*googlevideo.com/videoplayback*itag=399*',
      '*googlevideo.com/videoplayback*itag=400*',
      '*googlevideo.com/videoplayback*itag=401*',
      '*googlevideo.com/videoplayback*itag=402*',
      '*googlevideo.com/videoplayback*itag=571*',
      '*googlevideo.com/videoplayback*itag=694*',
      '*googlevideo.com/videoplayback*itag=695*',
      '*googlevideo.com/videoplayback*itag=696*',
      '*googlevideo.com/videoplayback*itag=697*',
      '*googlevideo.com/videoplayback*itag=698*',
      '*googlevideo.com/videoplayback*itag=699*',
      '*googlevideo.com/videoplayback*itag=700*',
      '*googlevideo.com/videoplayback*itag=701*',
      '*googlevideo.com/videoplayback*itag=702*'
    ]
  });

  log('Video stream URLs blocked via CDP Network');

  // Inject renderer-side code: force ATV mode, memory management, fetch interception
  var result = await send(ws, 'Runtime.evaluate', {
    expression: `
    (function() {
      if (self['__ytm_lightweight']) return 'already active';
      self['__ytm_lightweight'] = true;

      var LOG = '[LIGHTWEIGHT]';

      // 1. Force audio-only playback mode
      var player = document.querySelector('ytmusic-player');
      if (player) {
        player.setAttribute('playback-mode', 'ATV_PREFERRED');
        // Hide video element, show album art
        var songVideo = document.querySelector('#song-video.ytmusic-player');
        if (songVideo) songVideo.style.display = 'none';
        var songImage = document.querySelector('#song-image');
        if (songImage) songImage.style.display = 'block';
        console.log(LOG, 'Forced ATV_PREFERRED mode (audio-only display)');
      }

      // 2. Intercept fetch to block video segments at the JS level too
      var origFetch = self['fetch'];
      var blockedCount = 0;
      self['fetch'] = function() {
        var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
        // Block video segments (mime=video in URL or video itags)
        if (url.includes('googlevideo.com') || url.includes('videoplayback')) {
          if (url.includes('mime=video') || url.match(/itag=(1[3-8]|2[2]|3[6-8]|8[2-5]|13[3-7]|16[0]|24[2-8]|27[18]|29[89]|30[23]|30[8]|31[35]|33[0-7]|39[4-9]|40[0-2]|571|69[4-9]|70[0-2])(&|$)/)) {
            blockedCount++;
            if (blockedCount % 10 === 1) {
              console.log(LOG, 'Blocked ' + blockedCount + ' video segment requests');
            }
            return Promise.resolve(new Response('', { status: 204 }));
          }
        }
        return origFetch.apply(self, arguments);
      };

      // 3. Memory management between songs
      var video = document.querySelector('video');
      if (video) {
        video.addEventListener('emptied', function() {
          console.log(LOG, 'Song ended/changed - clearing old data');
          // Clear any image caches by forcing src reload on non-visible images
          var imgs = document.querySelectorAll('img[src*="data:"]');
          imgs.forEach(function(img) { img.removeAttribute('src'); });
        });

        video.addEventListener('loadeddata', function() {
          // Set lowest quality after each song load to minimize video data
          try {
            var playerApi = document.querySelector('#movie_player');
            if (playerApi && playerApi.setPlaybackQualityRange) {
              playerApi.setPlaybackQualityRange('tiny');
              console.log(LOG, 'Quality set to tiny (audio-focused)');
            }
          } catch(e) {}
        });
      }

      // 4. Periodic memory pressure check
      setInterval(function() {
        // Force minor GC hint by releasing references
        if (typeof gc === 'function') {
          gc();
          console.log(LOG, 'GC triggered');
        }

        var v = document.querySelector('video');
        if (v && v.buffered.length > 0) {
          var bufferedEnd = v.buffered.end(v.buffered.length - 1);
          var current = v.currentTime;
          var aheadSec = bufferedEnd - current;
          console.log(LOG, 'Buffer: ' + aheadSec.toFixed(0) + 's ahead | Blocked ' + blockedCount + ' video reqs');
        }
      }, 30000);

      console.log(LOG, 'Lightweight mode active - video streams blocked, memory management on');
      return 'lightweight mode injected';
    })()
    `,
    returnByValue: true
  });

  log('Injection result: ' + (result.result && result.result.value));
  log('');
  log('=== LIGHTWEIGHT MODE ACTIVE ===');
  log('- Video streams: BLOCKED (network + fetch level)');
  log('- Display: audio-only with album art');
  log('- Memory: cleanup on song change');
  log('- Buffer status: logged every 30s');
  log('');
  log('Watch memory usage drop. Press Ctrl+C to disconnect (injection stays active).');

  // Monitor blocked requests
  ws.on('message', function(raw) {
    var msg = JSON.parse(raw);

    if (msg.method === 'Runtime.consoleAPICalled') {
      var args = msg.params.args.map(function(a) { return a.value || a.description || ''; }).join(' ');
      if (args.includes('[LIGHTWEIGHT]')) {
        log(args.replace('[LIGHTWEIGHT] ', ''));
      }
    }

    if (msg.method === 'Network.requestWillBeSent') {
      var url = msg.params.request.url;
      if (url.includes('googlevideo') && url.includes('mime=video')) {
        log('BLOCKED VIDEO REQUEST: ' + url.substring(0, 100) + '...');
      }
    }
  });

  ws.on('close', function() {
    log('Disconnected from app');
    process.exit(0);
  });
}

main().catch(function(e) {
  log('ERROR: ' + e.message);
  process.exit(1);
});
