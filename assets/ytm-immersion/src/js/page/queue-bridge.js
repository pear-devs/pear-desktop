// ページ側(MAIN world)で動く小さな橋渡し。キューの行に videoId とサムネイルを置く。
//
// YTM のキュー(ytmusic-player-queue-item)は画面外の行の img を 1x1 の
// data: のまま遅延読み込みしていて、DOM には videoId も残っていない。
// 本物は要素の data プロパティ(ページ側の JS の値)にだけあり、拡張の側
// (isolated world)からは見えない。InnerTube で引いたキューで補っていたが、
// それは「今の曲から始めたラジオ」で、実際に流れているキューとは中身が
// 違うことが多い(実機: 51 行中 33 行が記号のまま)。
// 拡張が描く前に ytmi-queue-stamp を投げるので、その場で属性に写すだけ。
// 何も送らず、何も変えない。
(() => {
  // Up Next の画像は 48px 前後なので、96px 以上で一番小さいものを使う
  const pickThumb = (thumbs) => {
    const list = Array.isArray(thumbs) ? thumbs.filter(t => t && t.url) : [];
    if (!list.length) return '';
    const big = list.filter(t => Number(t.width) >= 96).sort((a, b) => a.width - b.width);
    return (big[0] || list[list.length - 1]).url;
  };
  const stamp = () => {
    for (const item of document.querySelectorAll('ytmusic-player-queue-item')) {
      const data = item.data;
      if (!data) continue;
      const videoId = typeof data.videoId === 'string' ? data.videoId : '';
      const thumb = pickThumb(data.thumbnail && data.thumbnail.thumbnails);
      if (item.getAttribute('data-ytmi-video-id') !== videoId) item.setAttribute('data-ytmi-video-id', videoId);
      if (item.getAttribute('data-ytmi-thumb') !== thumb) item.setAttribute('data-ytmi-thumb', thumb);
    }
  };
  // DOM のイベントは両方の world のリスナーへその場で届くので、投げた側が
  // dispatchEvent から戻った時には属性が置かれている
  document.addEventListener('ytmi-queue-stamp', stamp);
})();
