// 動画モードの画質を YouTube のように選べるようにする。
//
// YouTube の「自動」はプレイヤーの大きさで画質を決めるので、窓が小さいと
// 480p〜720p に留まり、映像が粗く見えた。選んだ画質は覚えておき、
// 動画モードの間だけ当てる(曲モードの映像はジャケットの静止画なので
// 自動に戻す)。画質を読む・変えるのはページ側の page/quality-bridge.js。
const VideoQuality = (() => {
  const STORAGE_KEY = 'ytm_video_quality';
  const root = document.documentElement;
  let choice = 'auto';
  let inMovieMode = false;

  const parse = (raw) => {
    const [current = '', label = '', list = ''] = String(raw || '').split('|');
    const levels = list.split(',').filter(Boolean).map((item) => {
      const [quality, qualityLabel] = item.split(':');
      return { quality, label: qualityLabel || quality };
    });
    return { current, label, levels };
  };

  // 動画モードかどうかが変わった時・選び直した時に呼ぶ
  const sync = (movieMode = inMovieMode) => {
    inMovieMode = !!movieMode;
    const want = inMovieMode ? choice : 'auto';
    if (root.getAttribute('data-ytmi-quality-want') !== want) root.setAttribute('data-ytmi-quality-want', want);
    document.dispatchEvent(new CustomEvent('ytmi-quality-apply'));
  };

  // 今の画質と選べる画質(高い順)
  const read = () => {
    document.dispatchEvent(new CustomEvent('ytmi-quality-read'));
    return parse(root.getAttribute('data-ytmi-quality'));
  };

  const setChoice = (quality) => {
    choice = quality && typeof quality === 'string' ? quality : 'auto';
    try { storage.set(STORAGE_KEY, choice); } catch (e) { }
    sync();
  };

  const init = async () => {
    try {
      const saved = await storage.get(STORAGE_KEY);
      if (typeof saved === 'string' && saved) choice = saved;
    } catch (e) { }
    sync();
  };

  return { init, sync, read, setChoice, getChoice: () => choice, _parse: parse };
})();
