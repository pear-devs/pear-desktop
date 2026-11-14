// Real Chromium Web Audio and localhost socket checks; no Pear login or speakers.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const scratch = path.join(root, '.independent-audio-test');
app.setPath('userData', path.join(scratch, 'profile'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Test timed out');
    await delay(10);
  }
}
async function backendTest() {
  const { startAudioServer } = await import(
    require('node:url').pathToFileURL(path.join(scratch, 'backend.mjs')).href
  );
  const profile = fs.mkdtempSync(path.join(scratch, 'server-'));
  const gains = [];
  const server = await startAudioServer(profile, (gain) => gains.push(gain));
  let socket;
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(profile, 'independent-audio.json')),
    );
    assert.equal(settings.host, '127.0.0.1');
    const bad = net.connect(settings.port, settings.host);
    bad.on('error', () => {});
    bad.write(JSON.stringify({ token: 'wrong' }) + '\n');
    await until(() => bad.destroyed);
    assert.deepEqual(gains, []);
    socket = net.connect(settings.port, settings.host);
    let received = Buffer.alloc(0);
    socket.on('data', (data) => {
      received = Buffer.concat([received, data]);
    });
    socket.write(JSON.stringify({ token: settings.token }) + '\n');
    await until(() => received.includes(10));
    assert.equal(JSON.parse(received.toString()).frame_bytes, 3840);
    received = Buffer.alloc(0);
    socket.write('{"gain":0}\n');
    await until(() => gains.at(-1) === 0);
    const pcm = new Int16Array(1920);
    pcm.fill(1200);
    server.publish(pcm.buffer);
    await until(() => received.length >= 3844);
    assert.equal(received.readUInt32LE(), 3840);
    assert.equal(received.readInt16LE(4), 1200);
    socket.destroy();
    await until(() => gains.at(-1) === 1);
    socket = net.connect(settings.port, settings.host);
    socket.on('error', () => {});
    socket.write(JSON.stringify({ token: settings.token }) + '\n');
    socket.write('{"gain":0.25}\n');
    await until(() => gains.at(-1) === 0.25);
    await until(() => gains.at(-1) === 1);
    assert.equal(
      fs.existsSync(path.join(profile, 'independent-audio.json')),
      true,
    );
  } finally {
    socket?.destroy();
    await server.stop();
    await server.stop();
  }
  assert.equal(
    fs.existsSync(path.join(profile, 'independent-audio.json')),
    false,
  );
  return {
    authentication: true,
    pcm_while_locally_muted: true,
    disconnect_restore: true,
    watchdog_restore: true,
  };
}
app
  .whenReady()
  .then(async () => {
    let ipcFrames = 0;
    ipcMain.handle('independent-audio:test-pcm', (_, frame) => {
      assert.ok(frame instanceof ArrayBuffer);
      assert.equal(frame.byteLength, 3840);
      ipcFrames++;
    });
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(__dirname, 'test-preload.cjs'),
      },
    });
    await window.loadFile(path.join(__dirname, 'test.html'));
    const bundle = fs.readFileSync(path.join(scratch, 'graph.js'), 'utf8');
    const rendered = await window.webContents.executeJavaScript(
      bundle +
        `
    (async () => {
      const context = new AudioContext({ sampleRate: 48000, sinkId: { type: 'none' } });
      const oscillator = context.createOscillator(); oscillator.frequency.value = 440;
      const source = context.createGain(); source.gain.value = 0.02; oscillator.connect(source);
      const captured = [];
      const ipcFailures = [];
      const graph = await IndependentAudio.attachGraph(context, source, frame => {
        if (frame.byteLength !== 3840) throw new Error('Invalid worklet frame');
        const values = new Int16Array(frame);
        captured.push(Math.sqrt(values.reduce((sum, x) => sum + x*x, 0) / values.length) / 32767);
        void window.independentTestPCM(frame).catch(error => ipcFailures.push(String(error)));
      });
      const analyser = context.createAnalyser(); analyser.fftSize = 2048; graph.monitor.connect(analyser);
      oscillator.start(); await context.resume();
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const windows = [];
      for (const gain of [1, 0.25, 0, 1]) {
        graph.setGain(gain); await sleep(400); captured.length = 0;
        const levels = [];
        for (let i=0; i<12; i++) {
          await sleep(25); const samples = new Float32Array(2048); analyser.getFloatTimeDomainData(samples);
          levels.push(Math.sqrt(samples.reduce((sum,x) => sum+x*x, 0) / samples.length));
        }
        if (captured.length < 5) throw new Error('Too few captured frames');
        windows.push({ gain, capture: captured.reduce((a,b)=>a+b,0)/captured.length,
                       monitor: levels.reduce((a,b)=>a+b,0)/levels.length });
      }
      graph.stop(); graph.stop(); oscillator.stop(); await context.close();
      return { windows, ipcFailures };
    })()
  `,
      true,
    );
    const result = rendered.windows;
    assert.deepEqual(rendered.ipcFailures, []);
    assert.ok(ipcFrames > 100);
    const baseline = result[0];
    assert.ok(baseline.capture > 0.01 && baseline.monitor > 0.01);
    for (const sample of result)
      assert.ok(Math.abs(sample.capture / baseline.capture - 1) < 0.02);
    assert.ok(Math.abs(result[1].monitor / baseline.monitor - 0.25) < 0.03);
    assert.ok(result[2].monitor < 0.00001);
    assert.ok(Math.abs(result[3].monitor / baseline.monitor - 1) < 0.03);
    const report = {
      graph: result,
      ipc_frames: ipcFrames,
      backend: await backendTest(),
    };
    fs.writeFileSync(
      path.join(scratch, 'result.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
