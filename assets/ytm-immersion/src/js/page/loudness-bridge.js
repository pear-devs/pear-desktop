// ページ側(MAIN world)で動く小さな橋渡し。
//
// YouTube は曲ごとに音の大きさ(loudnessDb = 目標の音量との差)を持っていて、
// 大きい曲だけを下げる。小さい曲は上げないので、同じ曲でも MV が曲版より
// 7 dB ほど小さいことがある(日向坂46「君はハニーデュー」、実機)。
// その値はプレイヤーの getPlayerResponse() からしか読めず、拡張の側
// (isolated world)からは見えない。読んだ値を <html> の属性に置くだけで、
// 何も送らず、何も変えない。音量を揃えるのは拡張側の volume-leveler.js。
(() => {
  const publish = () => {
    const player = document.getElementById('movie_player');
    const response = player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
    const videoId = response?.videoDetails?.videoId;
    if (!videoId) return;
    const db = Number(response?.playerConfig?.audioConfig?.loudnessDb);
    const value = `${videoId}:${Number.isFinite(db) ? db.toFixed(2) : ''}`;
    if (document.documentElement.getAttribute('data-ytmi-loudness') !== value) {
      document.documentElement.setAttribute('data-ytmi-loudness', value);
    }
  };
  // メディアのイベントは泡立たないが、捕獲なら document で受けられる。
  // 曲が変わった時、getPlayerResponse() が新しい曲になるのは loadeddata・playing
  // より後のことがある。その 2 つだけで読んでいたので前の曲の値のまま残り、
  // 小さい曲が上がらないまま流れ、次に一時停止→再生した時に急に大きくなっていた。
  // timeupdate(再生中 1 秒 4 回ほど)でも読み直す。値が同じなら何も書かない。
  for (const type of ['loadeddata', 'playing', 'timeupdate']) document.addEventListener(type, publish, true);
  publish();
})();
