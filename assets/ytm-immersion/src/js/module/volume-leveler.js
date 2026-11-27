// 小さい曲・動画の音量を上げて揃える。
//
// YouTube は目標(-7 LKFS)より大きい曲だけを下げ、小さい曲はそのまま流す。
// そのため同じ曲でも、MV が曲版より 7 dB ほど小さいことがあった
// (日向坂46「君はハニーデュー」: 曲版 -5.95 → 目標へ下げられる、MV -13.78 → そのまま。実機)。
// 小さい分だけ Web Audio で持ち上げ、目標に揃える。上げた時に割れないよう、
// 後ろにリミッターを置く。大きい曲は YouTube が下げているので触らない。
//
//  ・音の大きさは YouTube 自身の値(page/loudness-bridge.js が <html> に置く)
//  ・YTM の音量つまみ・ミュートはそのまま効く(要素の volume は Web Audio の
//    入口で掛かる。実機で確かめた)
//  ・Web Audio に通すのは、初めて上げる必要が出た時から。一度通すと
//    その video 要素では戻せないので、上げない時は素通しにつなぎ替える
//  ・AudioContext が動かせない時(まだ操作が無い等)は通さない。止まったまま
//    通すと音が消える
const VolumeLeveler = (() => {
  const MAX_BOOST_DB = 10;
  let enabled = true;
  let ctx = null;
  let starting = null;
  const graphs = new WeakMap();

  const boostDbFor = (raw, currentVideoId) => {
    const m = /^([\w-]+):(-?\d+(?:\.\d+)?)?$/.exec(String(raw || ''));
    if (!m || m[2] === undefined) return 0;
    if (currentVideoId && m[1] !== currentVideoId) return 0;
    const db = Number(m[2]);
    return db < 0 ? Math.min(-db, MAX_BOOST_DB) : 0;
  };

  const currentVideo = () => document.querySelector('#movie_player video') || document.querySelector('video');

  const readBoostDb = () => {
    const id = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
    return boostDbFor(document.documentElement.getAttribute('data-ytmi-loudness'), id);
  };

  const ensureContext = async () => {
    if (ctx && ctx.state === 'running') return ctx;
    if (starting) return starting;
    starting = (async () => {
      try {
        if (!ctx) {
          ctx = new AudioContext();
          // 通した後に止まると音が消えるので、止まったらすぐ動かし直す
          ctx.addEventListener('statechange', () => {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          });
        }
        if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 500))]);
        return ctx.state === 'running' ? ctx : null;
      } catch (e) {
        return null;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };

  const buildGraph = (audio, video) => {
    const source = audio.createMediaElementSource(video);
    const gain = audio.createGain();
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    gain.connect(limiter);
    limiter.connect(audio.destination);
    const graph = { source, gain, boosting: null };
    graphs.set(video, graph);
    return graph;
  };

  const route = (graph, boostDb) => {
    const boosting = boostDb > 0.1;
    const target = boosting ? Math.pow(10, boostDb / 20) : 1;
    graph.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
    if (graph.boosting === boosting) return;
    graph.source.disconnect();
    graph.source.connect(boosting ? graph.gain : ctx.destination);
    graph.boosting = boosting;
  };

  // 確かめる用(テストと実機の調査)
  let lastBoostDb = 0;

  let applying = false;
  let pending = false;
  const apply = async () => {
    if (applying) { pending = true; return; }
    applying = true;
    try {
      do {
        pending = false;
        const video = currentVideo();
        if (!video) break;
        const boostDb = enabled ? readBoostDb() : 0;
        let graph = graphs.get(video);
        if (!graph && boostDb <= 0.1) break;
        const audio = await ensureContext();
        if (!audio) {
          // 操作があれば動かせるようになる。その時にもう一度
          document.addEventListener('pointerdown', () => apply(), { once: true, capture: true });
          break;
        }
        graph = graphs.get(video) || buildGraph(audio, video);
        route(graph, boostDb);
        lastBoostDb = boostDb;
      } while (pending);
    } catch (e) {
      console.warn('[YTM] 音量を揃えられない', e);
    } finally {
      applying = false;
    }
  };

  new MutationObserver(() => apply())
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytmi-loudness'] });

  return {
    setEnabled(on) {
      enabled = !!on;
      apply();
    },
    apply,
    _boostDbFor: boostDbFor,
    _state: () => ({ context: ctx ? ctx.state : 'none', boostDb: lastBoostDb, routed: !!graphs.get(currentVideo()), gain: graphs.get(currentVideo())?.gain.gain.value ?? 1 }),
  };
})();
