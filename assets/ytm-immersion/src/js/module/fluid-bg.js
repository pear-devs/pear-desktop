// Apple Music 風の背景(WebGL)。設定「Apple Music風の動的背景を使用する」の中身。
//
// Apple Music の歌詞画面の背景は、ジャケットの色が大きなかたまりのまま、ゆっくり
// 回りながら混ざり合う。ここでは、ぼかしたジャケット(64×64)を大きく拡大し、
// 時間で動くゆがみを掛けて流す(FRAG)。
//
// 軽くするための作り:
//  - 画面の 1/RES_DIV の大きさで描き、CSS で引き伸ばす。中身はなだらかな色の
//    かたまりだけなので、引き伸ばしがそのままぼかしになる(CSS の blur を使わない)。
//  - 描くのは 1 秒に FPS 回まで。Immersion を閉じている時・タブが裏の時・
//    一時停止中・動画モード・軽量モードの時は描かない(rAF も回さない)。
//  - 明るさ(背景の明るさ × ジャケットごとの減光)は描く時に掛ける。親の CSS
//    filter で掛けると、毎フレーム画面全体にもう 1 回効果を掛け直すことになる。
//    値は <html> の style に直接書かれた CSS 変数から読む(getComputedStyle と
//    違ってスタイルの計算を起こさない)。
//  - 以前の背景は画面の 2 倍角(200vmax)の 2 枚を回していて、合成用の面だけで
//    数百 MB 使っていた(実測でレンダラーのメモリが拡張なしより 200〜300MB 多い)。
//    これは 1/RES_DIV の canvas 1 枚。
//
// 以前の背景(ぼかした画像を CSS で 2 枚回す)は、WebGL が使えない時と
// 軽量モードの時の受け皿として残す(style.css)。
const FluidBg = (() => {
  const RES_DIV = 6;
  // 上に乗っているぼかし(ナビバー等の backdrop-filter)は、背景が変わるたびに
  // 計算し直しになる。以前の CSS の背景も 1 秒 10 回の階段にしていた
  // (lyrics-ui.js の quantizeBackgroundAnimations)。動きはゆっくりなので
  // この回数で足りる。
  const FPS = 12;
  const FADE_MS = 1600;   // 曲が変わった時、前のジャケットの色から移り変わる長さ
  const TEX = 64;

  let canvas = null;
  let gl = null;
  let prog = null;
  let uni = {};
  let texA = null;   // 今の色
  let texB = null;   // 移り変わる前の色
  let fadeStart = 0;
  let hasArtwork = false;
  let rafId = 0;
  // 次の 1 枚までの待ち。rAF を毎フレーム頼むと、描かないフレームでもページ全体の
  // フレームの組み立て(1 秒 60 回)を起こしてしまう。描く少し前まではタイマーで待つ
  let waitTimer = 0;
  let lastDraw = 0;
  let wanted = false;   // 動かす
  let shown = false;    // 出す
  let failed = false;
  let brightness = 0.65;
  // 動いている間だけ進む時計(秒)。一時停止の前後で動きが飛ばないように
  let clock = 0;
  let lastTick = 0;

  const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  // ジャケットを大きく拡大し、座標を 2 段にゆがませてから読む。ゆがみは時間で
  // ゆっくり動くので、ジャケットの色がかたまりのまま流れて混ざって見える。
  // 何枚も重ねて平均すると色が中間の茶色に寄って濁る(試作で確かめた)ので、
  // 読むのは主に 1 か所。少しずれた所をもう 1 か所だけ薄く混ぜて奥行きを出す。
  const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uNow;
uniform sampler2D uPrev;
uniform float uMix;
uniform float uTime;
uniform float uAspect;
uniform float uBright;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 flow(sampler2D tex, vec2 p, float t) {
  vec2 q = rot(p, t * 0.025);
  q += 0.20 * vec2(sin(q.y * 2.1 + t * 0.21), cos(q.x * 1.8 - t * 0.17));
  q += 0.09 * vec2(sin(q.y * 4.3 - t * 0.29 + 1.3), cos(q.x * 3.9 + t * 0.23 + 0.7));
  vec3 a = texture2D(tex, q * 0.62 + 0.5).rgb;
  vec2 r = rot(p, -t * 0.035 + 2.0);
  r += 0.15 * vec2(cos(r.y * 2.7 - t * 0.19), sin(r.x * 2.3 + t * 0.15));
  vec3 b = texture2D(tex, r * 0.48 + 0.5).rgb;
  return mix(a, b, 0.3);
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime;
  vec3 c = flow(uNow, p, t);
  if (uMix < 1.0) c = mix(flow(uPrev, p, t), c, uMix);
  // ぼかした色は彩度が落ちるので戻す
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.6);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * uBright, 1.0);
}`;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };

  const makeTexture = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 回した時に外へ出た所は、鏡映しで続ける(端の色が筋にならない)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 18, 22, 255]));
    return tex;
  };

  const init = (host) => {
    if (gl || failed) return !!gl;
    try {
      canvas = document.createElement('canvas');
      canvas.id = 'ytm-fluid-bg';
      canvas.setAttribute('aria-hidden', 'true');
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('no webgl');
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uNow', 'uPrev', 'uMix', 'uTime', 'uAspect', 'uBright'].forEach((n) => { uni[n] = gl.getUniformLocation(prog, n); });
      texA = makeTexture();
      texB = makeTexture();
      gl.uniform1i(uni.uNow, 0);
      gl.uniform1i(uni.uPrev, 1);
      canvas.addEventListener('webglcontextlost', (e) => {
        // GPU の都合で失われた。以前の背景に戻す(取り戻しは試みない)
        e.preventDefault();
        failed = true;
        stop();
        document.body.classList.remove('ytm-fluid-bg');
      });
      host.prepend(canvas);
      return true;
    } catch (e) {
      console.warn('[YTM] WebGL の背景を作れなかったので、以前の背景を使います', e);
      failed = true;
      gl = null;
      canvas?.remove();
      canvas = null;
      return false;
    }
  };

  const resize = () => {
    const w = Math.max(16, Math.ceil(window.innerWidth / RES_DIV));
    const h = Math.max(16, Math.ceil(window.innerHeight / RES_DIV));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };

  const readBrightness = () => {
    const st = document.documentElement.style;
    const b = parseFloat(st.getPropertyValue('--ytm-bg-brightness'));
    const d = parseFloat(st.getPropertyValue('--ytm-bg-art-dim'));
    brightness = (Number.isFinite(b) ? b : 0.65) * (Number.isFinite(d) ? d : 1);
  };

  const draw = (now) => {
    rafId = 0;
    if (!wanted || !gl) return;
    const early = 1000 / FPS - 2 - (now - lastDraw);
    if (early > 0) {
      // まだ早い(タイマーが少し早く来た時)。次のフレームでもう一度見る
      rafId = requestAnimationFrame(draw);
      return;
    }
    lastDraw = now;
    // タブが裏に回っていた等で間が空いても、一度に大きく進めない
    if (lastTick) clock += Math.min(now - lastTick, 200) / 1000;
    lastTick = now;
    drawOnce(now);
    // 次の 1 枚の 1 フレーム前までタイマーで待ってから rAF を頼む
    waitTimer = setTimeout(() => {
      waitTimer = 0;
      if (wanted && !rafId) rafId = requestAnimationFrame(draw);
    }, Math.max(0, 1000 / FPS - 20));
  };

  const drawOnce = (now) => {
    if (!gl) return;
    resize();
    readBrightness();
    const mix = Math.min(1, (now - fadeStart) / FADE_MS);
    gl.uniform1f(uni.uMix, mix);
    gl.uniform1f(uni.uTime, clock);
    gl.uniform1f(uni.uAspect, canvas.width / canvas.height);
    gl.uniform1f(uni.uBright, brightness);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const start = () => {
    if (!rafId && !waitTimer) rafId = requestAnimationFrame(draw);
  };

  const stop = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearTimeout(waitTimer);
    waitTimer = 0;
    lastTick = 0;
  };

  // 止まっている間(一時停止中)に描き直す。大きさが変わると canvas は消えるので、
  // その時と、明るさを変えた時に 1 枚だけ描く。
  const redraw = () => {
    if (!gl || !shown || wanted) return;
    requestAnimationFrame((now) => drawOnce(now));
  };
  window.addEventListener('resize', redraw);

  return {
    // show: 背景を出すか(Apple Music 風が入・軽量モードでない・Immersion を開いて
    //       いる・動画モードでない)。animate: 動かすか(show で、タブが表・再生中)。
    // 一時停止中は最後の 1 枚を出したまま止める(以前の背景に切り替えない)。
    // WebGL が使えなければ false を返し、以前の背景のまま。
    update: ({ show, animate, host }) => {
      const ok = !!show && !failed && !!host && init(host);
      wanted = ok && !!animate;
      document.body.classList.toggle('ytm-fluid-bg', ok && hasArtwork);
      if (wanted) start();
      else stop();
      shown = ok;
      return ok;
    },
    // ぼかしたジャケット(読み出せる canvas)を渡す。前の色から FADE_MS で移る
    setArtwork: (source) => {
      if (!gl || !source) return;
      const tmp = texB; texB = texA; texA = tmp;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texA);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch (e) {
        return;   // 読み出せない画像(CORS)。前の色のまま
      }
      // 初めての 1 枚は、何も無い所からではなく、いきなり出す
      fadeStart = hasArtwork ? performance.now() : -FADE_MS;
      hasArtwork = true;
      document.body.classList.toggle('ytm-fluid-bg', shown);
      // 止まっている間(一時停止中)に曲が変わった時も、新しい色を 1 枚描いておく
      if (!wanted && shown) requestAnimationFrame((now) => drawOnce(now));
    },
    isRunning: () => !!(rafId || waitTimer),
    redraw,
    TEX,
  };
})();
