// 動画のタイトルを曲名に整える(動画モードの曲名の表示用)。
//
// YouTube の動画のタイトルは「乃木坂46 『ごめんね ずっと･･･』Short Ver.」
// 「【MV】曲名 / アーティスト (Official Music Video)」のように、曲名のまわりに
// アーティスト名や動画の種類が付いている。動画モードではこれがそのまま
// 曲名の欄に出ていたので、YT-Immersion の整形(content.js の
// getCleanedMetadata・cleanArtistName、同じ作者の MIT)と同じ考えで曲名だけにする。
//
// YT-Immersion から変えた所:
//  - 「MV」「full」は語として出てくる時だけ消す(元は語の中でも消していて、
//    「Wonderful」が「Wonder」になっていた)
//  - アーティスト名は、タイトルの頭か終わりにある時だけ消す(元は途中でも消していた)
//  - 丸括弧は、中身が動画の種類(MV・Short Ver. 等)の時だけ消す。
//    「(2022 Remaster)」「(feat. 〜)」のような曲名の一部は残す
//  - 'シングルクォート' は、前後が空白か端の時だけ括りとして扱う(Don't のアポストロフィと分ける)
const VideoTitle = (() => {
  // 「乃木坂46 OFFICIAL YouTube CHANNEL」→「乃木坂46」。
  // 英語の語は区切り(空白・記号)の直後にある時だけ剥がす(「Rich」の ch などを壊さない)
  const cleanArtistName = (name) => {
    const original = String(name || '').trim();
    let s = original.replace(/^[【\[(（]\s*(?:公式|official)\s*[】\])）]\s*/i, '');
    const tails = [
      /(?:^|[\s\-_|/・:：]+)(?:official|offical|youtube|channel|ch\.?|topic)\s*$/i,
      /(?:公式|オフィシャル|チャンネル|ちゃんねる)\s*$/,
      /VEVO\s*$/,
    ];
    for (let i = 0; i < 8; i++) {
      let next = s;
      for (const re of tails) next = next.replace(re, '');
      next = next.replace(/[\s\-_|/・:：]+$/, '').trim();
      if (next === s) break;
      s = next;
    }
    return s || original;
  };

  // 動画の種類を表す言葉(括りの中身がこれだけなら曲名ではない)
  const KIND = String.raw`(?:official\s*)?(?:music\s*video|video|mv|m\/v|audio|lyric\s*video|lyrics?|visualizer|teaser|trailer|performance\s*video|special\s*film|dance\s*(?:practice|video)|live|short\s*ver(?:sion)?\.?|full\s*ver(?:sion)?\.?|full|ver(?:sion)?\.?|公式|歌詞|リリック(?:ビデオ)?|ミュージックビデオ)`;
  const KIND_ONLY = new RegExp(`^(?:${KIND}[\\s\\-/・]*)+$`, 'i');
  // 括りの外に付いている動画の種類(語の区切りを見て消す)。「Live」「Video」のような
  // 曲名にも使う語は、括りの中にある時(KIND_ONLY)だけ消し、ここには入れない
  const TAIL = String.raw`(?:official\s*(?:music\s*video|video|audio|mv)|music\s*video|lyric\s*video|performance\s*video|special\s*film|mv|m\/v|short\s*ver(?:sion)?\.?|full\s*ver(?:sion)?\.?|公式|ミュージックビデオ|リリックビデオ)`;
  const KIND_TAIL = new RegExp(`(?:^|[\\s\\-/|:：・])${TAIL}(?=$|[\\s\\-/|:：・])`, 'gi');

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trimSeparators = (s) => s.replace(/^[\s\-–—:：|/・]+|[\s\-–—:：|/・]+$/g, '').trim();

  // 『』「」“”"" の中身。動画の種類だけ・1 文字だけの時は曲名ではない
  const bracketTitle = (raw) => {
    // 'シングルクォート' は、前後が空白か端の時だけ括りとみなす(曲名の中のアポストロフィと分ける。
    // K-POP の「NewJeans (뉴진스) 'Ditto' Official MV」の形)
    for (const re of [/『([^』]+)』/, /「([^」]+)」/, /“([^”]+)”/, /"([^"]+)"/, /(?:^|\s)[‘']([^'’]+)['’](?=\s|$)/]) {
      const m = raw.match(re);
      if (!m) continue;
      const inner = m[1].trim();
      if (inner.length >= 2 && !KIND_ONLY.test(inner)) return inner;
    }
    return null;
  };

  const formatTitle = (rawTitle, rawArtist) => {
    const raw = String(rawTitle || '').trim();
    if (!raw) return raw;
    const fromBracket = bracketTitle(raw);
    if (fromBracket) return fromBracket;

    let s = raw
      // 【MV】[Official] のような角括弧は、曲名には使われないので中身ごと消す
      .replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］/g, ' ')
      // 丸括弧・『』「」は、中身が動画の種類の時だけ
      .replace(/[(（『「]([^()（）『』「」]*)[)）』」]/g, (all, inner) => (KIND_ONLY.test(inner.trim()) ? ' ' : all));
    // 頭か終わりにあるアーティスト名(区切りの記号とともに)
    const artists = [cleanArtistName(rawArtist), String(rawArtist || '').trim()]
      .flatMap(a => a.split(/\s*[&、,]\s*/))
      .map(a => a.trim())
      .filter(a => a.length >= 2)
      .sort((a, b) => b.length - a.length);
    for (const a of artists) {
      const e = escapeRe(a);
      s = s.replace(new RegExp(`^\\s*${e}(?:\\s*[\\-–—:：|/・]\\s*|\\s+)`, 'i'), '')
        .replace(new RegExp(`\\s*[\\-–—:：|/・]\\s*${e}\\s*$`, 'i'), '');
    }
    for (let i = 0; i < 4; i++) {
      const next = trimSeparators(s.replace(KIND_TAIL, ' ').replace(/\s{2,}/g, ' '));
      if (next === s) break;
      s = next;
    }
    s = trimSeparators(s);
    return s || raw;
  };

  return { formatTitle, cleanArtistName };
})();
