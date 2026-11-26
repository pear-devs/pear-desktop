import { BrowserWindow } from 'electron';

import { createBackend } from '@/utils';

/*
 * Hidden second player for true overlap.
 *
 * A hidden window loads the next song in the official YouTube Music player
 * (same session, so the same signed-in Premium account). It is prepared muted:
 * it finds where the music starts and plays the first seconds muted to measure
 * the beat (see beat.ts). The renderer then parks it on a beat, starts it under
 * a fade with tempo matching, keeps it beat-locked, and later hands playback
 * back to the main player.
 */

// Plain JS injected into the hidden page. Kept as a string so the bundler
// can't rewrite it with helpers that don't exist in that page.
// The energy measuring loop mirrors EnvelopeRecorder in beat.ts.
const CONTROLLER = String.raw`(() => {
  if (window.__djHidden) return true;
  const BASS_CUT_DB = -24;
  const FRAME = 256;
  const BLOCK = 1024;
  const st = { ctx: null, src: null, shelf: null, gain: null, an: null, video: null, rec: null };
  const player = () => document.querySelector('#movie_player');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  // Wall-clock ms at which audio for context time t is heard (as outputWallMs in beat.ts).
  const outWall = (t) => {
    const ts = st.ctx.getOutputTimestamp();
    if (ts.performanceTime > 0) return performance.timeOrigin + ts.performanceTime + (t - ts.contextTime) * 1000;
    return performance.timeOrigin + performance.now() + (t - st.ctx.currentTime) * 1000;
  };

  const ensure = () => {
    const v = document.querySelector('video');
    const p = player();
    if (!v || !p || typeof p.getCurrentTime !== 'function') return false;
    if (st.video === v) return true;
    st.video = v;
    st.ctx = new AudioContext();
    st.src = st.ctx.createMediaElementSource(v);
    st.shelf = st.ctx.createBiquadFilter();
    st.shelf.type = 'lowshelf';
    st.shelf.frequency.value = 200;
    st.gain = st.ctx.createGain();
    st.gain.gain.value = 0;
    st.an = st.ctx.createAnalyser();
    st.an.fftSize = 2048;
    st.src.connect(st.an);
    st.src.connect(st.shelf);
    st.shelf.connect(st.gain);
    st.gain.connect(st.ctx.destination);

    // Two-band energy recorder (same as EnvelopeRecorder in beat.ts).
    const lp = st.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    const hp = st.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const merger = st.ctx.createChannelMerger(2);
    const sp = st.ctx.createScriptProcessor(BLOCK, 2, 1);
    const sink = st.ctx.createGain();
    sink.gain.value = 0;
    st.src.connect(lp);
    st.src.connect(hp);
    lp.connect(merger, 0, 0);
    hp.connect(merger, 0, 1);
    merger.connect(sp);
    sp.connect(sink);
    sink.connect(st.ctx.destination);
    sp.onaudioprocess = (e) => {
      const rec = st.rec;
      if (!rec) return;
      const lo = e.inputBuffer.getChannelData(0);
      const hi = e.inputBuffer.getChannelData(1);
      const offset = player().getCurrentTime() - st.ctx.currentTime;
      rec.blocks.push({ ctx: e.playbackTime, off: offset, i: rec.low.length, wall: outWall(e.playbackTime) });
      for (let f = 0; f < BLOCK / FRAME; f++) {
        let l = 0;
        let h = 0;
        for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
          l += lo[i] * lo[i];
          h += hi[i] * hi[i];
        }
        rec.low.push(l / FRAME);
        rec.high.push(h / FRAME);
      }
    };
    return true;
  };

  const waitPlaying = async () => {
    for (let i = 0; i < 150; i++) {
      if (!st.video.seeking && !st.video.paused && st.video.readyState >= 3) return;
      await sleep(20);
    }
  };

  // A freshly seeked stream can stall to buffer. The audio clock keeps
  // running through a stall while the song doesn't, which would stretch the
  // rhythm, so the song/audio clock offset is logged per block and only the
  // longest stretch where it stays steady is used.
  const record = async (seconds, minSeconds = 5) => {
    // Own buffer per recording: an overlapping job (fast skips) can replace
    // st.rec, but must not wipe this one.
    const rec = { low: [], high: [], blocks: [] };
    st.rec = rec;
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) await sleep(100);
    if (st.rec === rec) st.rec = null;
    const blocks = rec.blocks;
    if (!blocks.length) return null;
    let best = [0, 0];
    let start = 0;
    for (let k = 1; k <= blocks.length; k++) {
      if (k === blocks.length || Math.abs(blocks[k].off - blocks[k - 1].off) > 0.02) {
        if (k - start > best[1] - best[0]) best = [start, k];
        start = k;
      }
    }
    const seg = blocks.slice(best[0], best[1]);
    const dt = FRAME / st.ctx.sampleRate;
    const from = seg[0].i;
    const to = seg[seg.length - 1].i + BLOCK / FRAME;
    if ((to - from) * dt < minSeconds) return null;
    return {
      low: rec.low.slice(from, to),
      high: rec.high.slice(from, to),
      t0: seg[0].ctx + median(seg.map((b) => b.off)),
      wallT0: median(seg.map((b) => b.wall - ((b.i - from) * dt * 1000))),
      dt,
      stalls: blocks.length - seg.length,
    };
  };

  const rms = () => {
    const b = new Float32Array(st.an.fftSize);
    st.an.getFloatTimeDomainData(b);
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    return Math.sqrt(s / b.length);
  };

  // All muted: measure the tempo from a stretch of the song's body (intros
  // often have no drums), then play from the start until the music begins
  // (skips silent intros) and park there.
  const prepare = async (expectedId, bodySeconds) => {
    for (let i = 0; i < 200 && !ensure(); i++) await sleep(50);
    if (!st.video) return { ok: false, reason: 'no player' };
    const p = player();
    await st.ctx.resume();
    st.video.playbackRate = 1;
    if (st.video.paused) p.playVideo();
    await waitPlaying();
    const length =
      Number(p.getPlayerResponse()?.videoDetails?.lengthSeconds) || p.getDuration();

    let body = null;
    if (length > 60) {
      p.seekTo(Math.max(30, length * 0.35), true);
      await waitPlaying();
      await sleep(300);
      body = await record(bodySeconds);
    }

    p.seekTo(0, true);
    await waitPlaying();
    let onset = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      await sleep(40);
      if (!st.video.paused && rms() > 0.01) {
        onset = Math.max(0, p.getCurrentTime() - 0.15);
        break;
      }
    }
    p.pauseVideo();
    const id = p.getPlayerResponse()?.videoDetails?.videoId;
    return { ok: id === expectedId, id, onset, body };
  };

  // Look ahead in the song that's playing in the main window: loudness of a
  // stretch of its middle (reference) and of its last tailSeconds, played
  // muted at "rate" times normal speed so it is quick. Points: [song time, RMS].
  const scanTail = async (expectedId, tailSeconds, rate) => {
    for (let i = 0; i < 200 && !ensure(); i++) await sleep(50);
    if (!st.video) return { ok: false, reason: 'no player' };
    const p = player();
    await st.ctx.resume();
    if (st.video.paused) p.playVideo();
    await waitPlaying();
    const idNow = () => p.getPlayerResponse()?.videoDetails?.videoId;
    if (idNow() !== expectedId) return { ok: false, id: idNow() };
    const length =
      Number(p.getPlayerResponse()?.videoDetails?.lengthSeconds) || p.getDuration();

    const sample = async (from, songSeconds) => {
      p.seekTo(from, true);
      await waitPlaying();
      await sleep(150);
      st.video.preservesPitch = true;
      st.video.playbackRate = rate;
      const points = [];
      const end = Math.min(length, from + songSeconds);
      const deadline = Date.now() + ((songSeconds / rate) * 1000) + 8000;
      let complete = false;
      while (Date.now() < deadline) {
        await sleep(80);
        if (idNow() !== expectedId) break;
        if (st.video.ended) {
          complete = true;
          break;
        }
        const t = p.getCurrentTime();
        if (t >= end - 0.05) {
          complete = true;
          break;
        }
        if (!st.video.paused && !st.video.seeking) points.push([t, rms()]);
      }
      st.video.playbackRate = 1;
      return { points, complete };
    };

    const body = await sample(length * 0.4, 8);
    const tail = await sample(Math.max(0, length - tailSeconds), tailSeconds);
    p.pauseVideo();
    // A scan that stalled or switched songs would put the "end of the music"
    // where the scan stopped, not where the song ends: don't use it.
    const lastSampled = tail.points.length ? tail.points[tail.points.length - 1][0] : 0;
    if (!tail.complete || lastSampled < length - 3) {
      return { ok: false, reason: 'tail scan incomplete', length, body: [], tail: [] };
    }
    return {
      ok: true,
      length,
      body: body.points.map((x) => x[1]),
      tail: tail.points,
    };
  };

  const park = async (t) => {
    const p = player();
    p.pauseVideo();
    p.seekTo(t, true);
    for (let i = 0; i < 100 && st.video.seeking; i++) await sleep(20);
    return p.getCurrentTime();
  };

  // Start the incoming song and confirm it's really playing before reporting
  // success: if it stalls (buffering), the renderer must not fade out the
  // main player into silence.
  const start = async (fadeSeconds, bassSwap, swapAt, rate) => {
    const p = player();
    st.gain.gain.cancelScheduledValues(st.ctx.currentTime);
    st.gain.gain.setValueAtTime(0, st.ctx.currentTime);
    st.video.preservesPitch = true;
    st.video.playbackRate = rate;
    const from = p.getCurrentTime();
    p.playVideo();
    const until = Date.now() + 2000;
    let playing = false;
    while (Date.now() < until) {
      await sleep(20);
      if (!st.video.paused && p.getCurrentTime() > from + 0.02) {
        playing = true;
        break;
      }
    }
    if (!playing) {
      p.pauseVideo();
      return false;
    }
    const now = st.ctx.currentTime;
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.sin((Math.PI * i) / (2 * (n - 1)));
    st.gain.gain.cancelScheduledValues(now);
    st.gain.gain.setValueCurveAtTime(curve, now, fadeSeconds);
    st.shelf.gain.cancelScheduledValues(now);
    st.shelf.gain.setValueAtTime(bassSwap ? BASS_CUT_DB : 0, now);
    if (bassSwap) {
      // Ramp ends on the swap beat.
      st.shelf.gain.setValueAtTime(BASS_CUT_DB, now + Math.max(0, swapAt - 0.06));
      st.shelf.gain.linearRampToValueAtTime(0, now + swapAt);
    }
    return true;
  };

  const setRate = (rate) => {
    st.video.playbackRate = rate;
    return true;
  };

  const time = () => ({
    t: player().getCurrentTime(),
    at: Date.now(),
    rate: st.video.playbackRate,
    playing: !st.video.paused,
  });

  const release = async (seconds) => {
    if (!st.ctx) return true;
    const now = st.ctx.currentTime;
    st.gain.gain.cancelAndHoldAtTime(now);
    st.gain.gain.linearRampToValueAtTime(0, now + seconds);
    await sleep(seconds * 1000 + 50);
    player()?.pauseVideo();
    return true;
  };

  // A short recording of what this player sends to the speakers, for the
  // handoff check by ear (see audibleOffset in beat.ts).
  const capture = (seconds) => record(seconds, 1.5);

  window.__djHidden = { prepare, scanTail, park, start, setRate, time, release, capture };
  return true;
})()`;

const BODY_SECONDS = 16; // s of the song body recorded for tempo (stalls trimmed)
const TAIL_SECONDS = 60; // s at the end of the current song scanned for its outro
const SCAN_RATE = 2; // tail scan playback speed (muted)

let hidden: BrowserWindow | null = null;
let preparedId: string | null = null;
/** Bumped by every load of the hidden window, so a slow release from an
 *  earlier transition can't blank a song loaded after it. */
let generation = 0;

const getHidden = (main: BrowserWindow) => {
  if (hidden && !hidden.isDestroyed()) return hidden;
  hidden = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      session: main.webContents.session,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  hidden.webContents.userAgent = main.webContents.userAgent;
  hidden.webContents.setAudioMuted(true);
  return hidden;
};

const run = <T>(code: string) =>
  hidden && !hidden.isDestroyed()
    ? (hidden.webContents.executeJavaScript(code, true) as Promise<T>)
    : Promise.reject(new Error('hidden player not available'));

const cleanup = () => {
  preparedId = null;
  if (hidden && !hidden.isDestroyed()) {
    hidden.webContents.setAudioMuted(true);
    hidden.webContents.loadURL('about:blank');
  }
};

/**
 * Load a song page in the hidden window. YouTube Music sometimes redirects
 * while loading, which Electron reports as ERR_ABORTED even though the page
 * then loads fine — so that error is waited out, not treated as a failure.
 */
const loadSong = async (win: BrowserWindow, videoId: string) => {
  try {
    await win.webContents.loadURL(
      `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    );
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw error;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (!win.webContents.isLoading()) return done();
      win.webContents.once('did-stop-loading', done);
      setTimeout(done, 8000);
    });
  }
};

/** Run a hidden-player job; on any failure, stop and blank the hidden page. */
const guarded = async <T>(job: () => Promise<T>) => {
  try {
    return await job();
  } catch (error) {
    cleanup();
    throw error;
  }
};

const HANDLERS = [
  'prepare',
  'scan-tail',
  'park',
  'start',
  'rate',
  'time',
  'release',
  'cancel',
  'queue-next',
  'capture',
] as const;

export default createBackend({
  start({ ipc: { handle }, window }) {
    // Transitions are timed with page timers (tempo ramp, blend start, beat
    // lock). Chromium slows timers in background windows to ~1 tick per
    // 400 ms, which throws that timing off by hundreds of ms while you
    // listen with the app in the background, so keep the main window's
    // timers running at full rate while the plugin is on.
    window.webContents.setBackgroundThrottling(false);

    handle('dj-transitions:prepare', (videoId: string) =>
      guarded(async () => {
        generation++;
        const win = getHidden(window);
        win.webContents.setAudioMuted(true);
        preparedId = null;
        await loadSong(win, videoId);
        await run(CONTROLLER);
        const result = await run<{ ok: boolean; id?: string; onset?: number }>(
          `window.__djHidden.prepare(${JSON.stringify(videoId)}, ${BODY_SECONDS})`,
        );
        if (result.ok) preparedId = videoId;
        else cleanup();
        return result;
      }),
    );

    handle('dj-transitions:scan-tail', (videoId: string) =>
      guarded(async () => {
        generation++;
        const win = getHidden(window);
        win.webContents.setAudioMuted(true);
        preparedId = null;
        await loadSong(win, videoId);
        await run(CONTROLLER);
        const result = await run<{ ok: boolean }>(
          `window.__djHidden.scanTail(${JSON.stringify(videoId)}, ${TAIL_SECONDS}, ${SCAN_RATE})`,
        );
        // Stop the scanned song; prepare loads the next one right after.
        await run('document.querySelector("#movie_player")?.pauseVideo()');
        return result;
      }),
    );

    handle('dj-transitions:park', (t: number) =>
      run<number>(`window.__djHidden.park(${Number(t)})`),
    );

    handle(
      'dj-transitions:start',
      async (
        videoId: string,
        fadeSeconds: number,
        bassSwap: boolean,
        swapAt: number,
        rate: number,
      ) => {
        if (preparedId !== videoId) return false;
        hidden?.webContents.setAudioMuted(false);
        const started = await run<boolean>(
          `window.__djHidden.start(${Number(fadeSeconds)}, ${Boolean(bassSwap)}, ${Number(swapAt)}, ${Number(rate)})`,
        ).catch(() => false);
        if (!started) hidden?.webContents.setAudioMuted(true);
        return started;
      },
    );

    handle('dj-transitions:rate', (rate: number) =>
      run<boolean>(`window.__djHidden?.setRate(${Number(rate)}) ?? false`),
    );

    handle('dj-transitions:capture', (seconds: number) =>
      run(`window.__djHidden.capture(${Number(seconds)})`),
    );

    handle('dj-transitions:time', () =>
      run<{ t: number; at: number; rate: number; playing: boolean }>(
        'window.__djHidden.time()',
      ),
    );

    handle('dj-transitions:release', async (seconds: number) => {
      const mine = generation;
      try {
        await run(`window.__djHidden?.release(${Number(seconds)})`);
      } finally {
        // Only if nothing new was loaded meanwhile.
        if (mine === generation) cleanup();
      }
      return true;
    });

    handle('dj-transitions:cancel', () => {
      cleanup();
      return true;
    });

    // Pin a song as "play next" through the app's own add-to-queue (as its
    // song controls do), so autoplay can't swap it at the last moment.
    handle('dj-transitions:queue-next', (videoId: string) => {
      window.webContents.send(
        'peard:add-to-queue',
        videoId,
        'INSERT_AFTER_CURRENT_VIDEO',
      );
      return true;
    });
  },

  stop({ ipc: { removeHandler }, window }) {
    window.webContents.setBackgroundThrottling(true); // Electron's default
    for (const name of HANDLERS) removeHandler(`dj-transitions:${name}`);
    if (hidden && !hidden.isDestroyed()) hidden.destroy();
    hidden = null;
    preparedId = null;
  },
});
