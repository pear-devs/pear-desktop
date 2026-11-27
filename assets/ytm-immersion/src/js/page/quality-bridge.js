// ページ側(MAIN world)で動く小さな橋渡し。動画の画質を読み、選ばれた画質にする。
//
// YouTube の「自動」画質はプレイヤーの大きさと回線で決まり、窓が小さいと
// 480p〜720p に留まる。YTM には画質を選ぶ所が無い。画質を読む・変える口
// (getAvailableQualityData / setPlaybackQualityRange)はプレイヤーの
// ページ側の JS にしか無く、拡張の側(isolated world)からは呼べない。
//  ・拡張が <html> の data-ytmi-quality-want に選んだ画質を置き、
//    ytmi-quality-apply を投げる。曲モードの時は auto を置く
//  ・ytmi-quality-read を受けたら、今の画質と選べる画質を
//    data-ytmi-quality に書く(DOM のイベントは両方の world のリスナーへ
//    その場で届くので、投げた側が戻った時には書けている)
//  ・動画が変わると YouTube は画質を選び直すので、読み込むたびに当て直す
// 何も送らない。
(() => {
  const root = document.documentElement;
  // 高い順。選んだ画質が無い動画では、それより低い中で一番高いものにする
  const RANK = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const rank = (q) => { const i = RANK.indexOf(q); return i < 0 ? RANK.length : i; };
  // こちらで画質を決めた動画と画質。自動に戻す時に、決めていなければ触らない
  let forced = null;

  const player = () => document.getElementById('movie_player');
  const videoIdOf = (p) => {
    try { return (p.getVideoData && p.getVideoData().video_id) || ''; } catch (e) { return ''; }
  };

  const publish = () => {
    const p = player();
    if (!p || typeof p.getAvailableQualityData !== 'function') return;
    let data = [];
    try { data = p.getAvailableQualityData() || []; } catch (e) { data = []; }
    const levels = data
      .filter(d => d && d.quality && d.quality !== 'auto' && d.isPlayable !== false)
      .map(d => `${d.quality}:${String(d.qualityLabel || '').replace(/[|,:]/g, '')}`)
      .join(',');
    const current = typeof p.getPlaybackQuality === 'function' ? p.getPlaybackQuality() : '';
    const label = typeof p.getPlaybackQualityLabel === 'function' ? p.getPlaybackQualityLabel() : '';
    root.setAttribute('data-ytmi-quality', `${current || ''}|${String(label || '').replace(/[|,:]/g, '')}|${levels}`);
  };

  const apply = () => {
    const p = player();
    if (!p || typeof p.setPlaybackQualityRange !== 'function') return;
    const want = root.getAttribute('data-ytmi-quality-want') || 'auto';
    if (want === 'auto') {
      if (forced) {
        forced = null;
        p.setPlaybackQualityRange('auto', 'auto');
      }
      return;
    }
    const levels = (typeof p.getAvailableQualityLevels === 'function' ? p.getAvailableQualityLevels() : [])
      .filter(q => q && q !== 'auto')
      .sort((a, b) => rank(a) - rank(b));
    if (!levels.length) return;   // まだ読み込み中。loadeddata でもう一度来る
    const pick = levels.find(q => q === want)
      || levels.find(q => rank(q) > rank(want))
      || levels[levels.length - 1];
    const videoId = videoIdOf(p);
    if (forced && forced.videoId === videoId && forced.quality === pick) return;
    forced = { videoId, quality: pick };
    p.setPlaybackQualityRange(pick, pick);
  };

  const applyAndPublish = () => { apply(); publish(); };
  document.addEventListener('ytmi-quality-read', publish);
  document.addEventListener('ytmi-quality-apply', applyAndPublish);
  // メディアのイベントは泡立たないが、捕獲なら document で受けられる
  for (const type of ['loadeddata', 'playing']) document.addEventListener(type, applyAndPublish, true);
})();
