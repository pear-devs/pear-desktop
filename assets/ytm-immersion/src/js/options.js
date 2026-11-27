// 歌詞ソースの設定ページ。取得元ごとのオン・オフをここで切り替える。
//
// 取得元は2種類ある。
//   標準の取得元 : host_permissions に入っている(YTM はページ自身)。許可では
//                  止められないので、オフにしたものを storage に持つ
//                  (lyric-sources.js)。background と lyrics-ui.js がそれを読む。
//   追加の取得元 : 下に書いた理由で optional_host_permissions。許可の有無が
//                  そのままオン・オフになる。
//
// 以下は追加の取得元の話。
//
// 通信先を manifest の host_permissions に書くと、更新のたびに Chrome が
// 「権限が増えたので無効化しました」を出して、利用者が再承認するまで
// 拡張ごと止まる。判定はホスト集合の差分なので、既にいくつ持っていても
// 新しい1つで増加になる。だから optional_host_permissions に置き、
// ここで chrome.permissions.request() を使って許可を取る。
//
// このページが要る理由: permissions.request() はユーザー操作を起点に、
// かつ拡張のページからしか呼べない。設定 UI は content script として
// YouTube Music のページに差し込んでいるので、そこからは呼べない。
//
// 使われ方は2通り。
//   ?embed=1 : 設定パネルの「Lyrics Source」タブに iframe で差し込まれる
//              (lyrics-ui.js の mountExtraProvidersFrame)。iframe の中は
//              拡張のページなので、押したその場で許可のダイアログが出せる。
//              見た目は設定パネルに合わせ、高さは親に postMessage で伝える。
//   単体      : chrome://extensions の「拡張機能のオプション」から開く。
//              差し込みが読み込めなかった時の逃げ道でもある。
//
// 通信先の定義は extra-providers.js を単一の出どころにする。
// ここで書き写すと、許可したホストと実際に叩くホストが食い違って
// 「許可したのに動かない」になる。
import { PROVIDER_IDS, PROVIDER_ORIGINS } from './module/extra-providers.js';
import {
  BUILTIN_SOURCE_HOSTS, BUILTIN_SOURCE_IDS, loadDisabledSources, saveDisabledSources, DISABLED_LYRIC_SOURCES_KEY,
} from './module/lyric-sources.js';

// namespace.js の辞書は content script のスコープに置かれた素の const で、
// 拡張のページからは読めない。ここで要るのは数行なので持たせる。
// 言語は設定パネルと同じ4つ。差し込まれた時にパネルと言語が食い違わないように。
const TEXT = {
  ja: {
    title: '歌詞ソース',
    lead: '歌詞をどこから取るかを選びます。オフにした取得元には通信しません。',
    privacy: '<strong>追加の取得元に送るもの:</strong> 曲名・アーティスト名・曲の長さ。' +
      'LiriQo と BuaaaBot にはこれに加えて YouTube の動画IDを送ります。' +
      'アカウント情報や再生履歴は送りません。許可はいつでもここで取り消せます。',
    granted: '許可済み',
    denied: '許可されませんでした。',
    removed: '許可を取り消しました。',
    sharedWith: '{name} が同じ接続先を使っているので、そちらを切るまでは無効にできません。',
    saved: '許可しました。次に再生する曲から使われます。',
    groupBuiltin: '標準の取得元',
    groupBuiltinNote: '許可なしで使えます。使わないものはオフにできます。',
    groupExtra: '追加の取得元',
    groupExtraNote: '単語ごとに光る歌詞(文字同期)を持っている取得元です。オンにする時に Chrome の許可を求めます。',
    builtinOn: 'オンにしました。次に再生する曲から使われます。',
    builtinOff: 'オフにしました。次に再生する曲から使いません。',
    // 設定パネルに差し込まれている時。閉じた時に今の曲も取り直す
    savedEmbed: '許可しました。設定を閉じると、今の曲から使われます。',
    builtinOnEmbed: 'オンにしました。設定を閉じると、今の曲から使われます。',
    builtinOffEmbed: 'オフにしました。設定を閉じると、今の曲から使いません。',
    allOff: 'すべての取得元がオフです。このままでは歌詞が表示されません。',
    providers: {
      ytm: {
        name: 'YouTube Music',
        desc: 'YouTube Music 自身が持っている歌詞。動画IDで引くので曲の取り違えが起きない。行同期(持っていない曲は時刻なし)。',
      },
      lrchub: {
        name: 'LRC Hub',
        desc: '歌詞に加え、翻訳・解説・歌手ごとの色のデータも提供します。' +
          'オフにしても、翻訳は翻訳タブの設定どおりに取得します。',
      },
      lrclib: {
        name: 'LrcLib',
        desc: '公開されている行同期の歌詞データベース。収録が広く、他で見つからない曲の受け皿になる。',
      },
      simpmusic: {
        name: 'SimpMusic',
        desc: '動画IDで引く歌詞サーバー。単語同期を持っている曲がある。',
      },
      lyricsplus: {
        name: 'LyricsPlus',
        desc: 'Apple Music などを束ねた無料の共用サーバー。混み合っていて返ってこないことが多い。',
      },
      kugou: {
        name: 'KuGou',
        desc: '対応している曲がいちばん広く、応答も速い。日本語の曲も単語同期で返ってくる。',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: '有志が手で打った単語同期(CC0)。当たれば質はいちばん高い。収録は3千曲ほど。' +
          '曲を割り出すのに NetEase の検索を使う。',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: '単語同期(yrc)を持っている曲があり、無い曲も行同期で返る。' +
          'AMLL と同じ検索を使うので、AMLL を許可するとこちらも一緒に有効になる。',
      },
      liriqo: {
        name: 'LiriQo',
        desc: 'Apple Music などを束ねた API。1曲あたり数秒かかるので、' +
          '他が見つけられなかった時だけ使う。',
      },
      buaaa: {
        name: 'BuaaaBot',
        desc: '日本語の曲を中心に単語同期の歌詞を提供します。' +
          '動画IDでも引くので、登録のあるカバー動画はそのカバーの時刻に合います。',
      },
    },
  },
  en: {
    title: 'Lyrics sources',
    lead: 'Choose where lyrics come from. Sources you turn off are never contacted.',
    privacy: '<strong>What is sent to extra sources:</strong> track title, artist and track length. ' +
      'LiriQo and BuaaaBot also receive the YouTube video ID. ' +
      'No account details or listening history are sent. You can revoke access here at any time.',
    granted: 'Allowed',
    denied: 'Permission was not granted.',
    removed: 'Access revoked.',
    sharedWith: '{name} uses the same connection, so this stays on until you turn that off.',
    saved: 'Allowed. It will be used from the next song.',
    groupBuiltin: 'Standard sources',
    groupBuiltinNote: 'Work without extra permission. Turn off any you do not want.',
    groupExtra: 'Extra sources',
    groupExtraNote: 'These can return word-by-word synced lyrics. Chrome asks for permission when you turn one on.',
    builtinOn: 'Turned on. It will be used from the next song.',
    builtinOff: 'Turned off. It will not be used from the next song.',
    savedEmbed: 'Allowed. It will be used from the current song once you close Settings.',
    builtinOnEmbed: 'Turned on. It will be used from the current song once you close Settings.',
    builtinOffEmbed: 'Turned off. It will not be used from the current song once you close Settings.',
    allOff: 'Every source is off, so no lyrics will be shown.',
    providers: {
      ytm: {
        name: 'YouTube Music',
        desc: 'The lyrics YouTube Music itself has. Looked up by video ID, so it never picks the wrong song. Line sync (unsynced when that is all it has).',
      },
      lrchub: {
        name: 'LRC Hub',
        desc: 'Provides translations, annotations and singer colours along with lyrics. ' +
          'Turning it off does not stop translations; those follow the Translation tab.',
      },
      lrclib: {
        name: 'LrcLib',
        desc: 'A public database of line-synced lyrics. Wide coverage; catches songs the others miss.',
      },
      simpmusic: {
        name: 'SimpMusic',
        desc: 'A lyrics server looked up by video ID. Has word sync for some songs.',
      },
      lyricsplus: {
        name: 'LyricsPlus',
        desc: 'A free shared server bundling Apple Music and others. Often too busy to answer.',
      },
      kugou: {
        name: 'KuGou',
        desc: 'The widest coverage and the fastest to answer. Returns word sync for Japanese songs too.',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: 'Hand-timed word sync from volunteers (CC0). The best quality when it has the song. ' +
          'About 3,000 songs. Uses NetEase search to identify the track.',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: 'Word sync (yrc) for some songs, line sync for the rest. ' +
          'It shares its search with AMLL, so allowing AMLL turns this on as well.',
      },
      liriqo: {
        name: 'LiriQo',
        desc: 'An API bundling Apple Music and others. Takes a few seconds per song, ' +
          'so it is only used when nothing else found the lyrics.',
      },
      buaaa: {
        name: 'BuaaaBot',
        desc: 'Provides word-synced lyrics, mainly for Japanese songs. It also looks up by video ID, ' +
          'so registered cover videos get the timing of that cover.',
      },
    },
  },
  ko: {
    title: '가사 소스',
    lead: '가사를 어디에서 가져올지 선택합니다. 꺼 둔 소스에는 연결하지 않습니다.',
    privacy: '<strong>추가 소스에 보내는 정보:</strong> 곡 제목, 아티스트 이름, 곡 길이. ' +
      'LiriQo와 BuaaaBot에는 YouTube 동영상 ID도 함께 보냅니다. ' +
      '계정 정보나 재생 기록은 보내지 않습니다. 권한은 언제든 여기에서 취소할 수 있습니다.',
    granted: '허용됨',
    denied: '권한이 허용되지 않았습니다.',
    removed: '권한을 취소했습니다.',
    sharedWith: '{name}이(가) 같은 연결 대상을 사용하고 있어서, 그쪽을 끄기 전까지는 끌 수 없습니다.',
    saved: '허용했습니다. 다음에 재생하는 곡부터 사용됩니다.',
    groupBuiltin: '기본 소스',
    groupBuiltinNote: '별도 권한 없이 사용할 수 있습니다. 쓰지 않을 소스는 끌 수 있습니다.',
    groupExtra: '추가 소스',
    groupExtraNote: '단어 단위로 빛나는 가사(글자 동기화)를 가진 소스입니다. 켤 때 Chrome 권한을 요청합니다.',
    builtinOn: '켰습니다. 다음에 재생하는 곡부터 사용됩니다.',
    builtinOff: '껐습니다. 다음에 재생하는 곡부터 사용하지 않습니다.',
    savedEmbed: '허용했습니다. 설정을 닫으면 지금 곡부터 사용됩니다.',
    builtinOnEmbed: '켰습니다. 설정을 닫으면 지금 곡부터 사용됩니다.',
    builtinOffEmbed: '껐습니다. 설정을 닫으면 지금 곡부터 사용하지 않습니다.',
    allOff: '모든 소스가 꺼져 있어 가사가 표시되지 않습니다.',
    providers: {
      ytm: {
        name: 'YouTube Music',
        desc: 'YouTube Music 자체가 가진 가사. 동영상 ID로 찾기 때문에 곡을 잘못 고르지 않습니다. 줄 단위 동기화(없는 곡은 시간 정보 없음).',
      },
      lrchub: {
        name: 'LRC Hub',
        desc: '가사와 함께 번역, 해설, 가수별 색상 데이터도 제공합니다. ' +
          '꺼도 번역은 번역 탭 설정대로 가져옵니다.',
      },
      lrclib: {
        name: 'LrcLib',
        desc: '공개된 줄 단위 동기화 가사 데이터베이스. 수록곡이 많아 다른 곳에 없는 곡을 받쳐 줍니다.',
      },
      simpmusic: {
        name: 'SimpMusic',
        desc: '동영상 ID로 찾는 가사 서버. 단어 동기화가 있는 곡도 있습니다.',
      },
      lyricsplus: {
        name: 'LyricsPlus',
        desc: 'Apple Music 등을 묶은 무료 공용 서버. 붐벼서 응답하지 않는 경우가 많습니다.',
      },
      kugou: {
        name: 'KuGou',
        desc: '지원하는 곡이 가장 많고 응답도 빠릅니다. 일본어 곡도 단어 동기화로 돌아옵니다.',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: '자원봉사자가 직접 타이밍을 맞춘 단어 동기화(CC0). 곡이 있으면 품질이 가장 좋습니다. ' +
          '수록곡은 약 3천 곡. 곡을 찾을 때 NetEase 검색을 사용합니다.',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: '단어 동기화(yrc)가 있는 곡이 있고, 없는 곡도 줄 단위 동기화로 돌아옵니다. ' +
          'AMLL과 같은 검색을 쓰므로 AMLL을 허용하면 이쪽도 함께 켜집니다.',
      },
      liriqo: {
        name: 'LiriQo',
        desc: 'Apple Music 등을 묶은 API. 곡마다 몇 초씩 걸리므로, ' +
          '다른 소스가 찾지 못했을 때만 사용합니다.',
      },
      buaaa: {
        name: 'BuaaaBot',
        desc: '일본어 곡을 중심으로 단어 동기화 가사를 제공합니다. ' +
          '동영상 ID로도 찾기 때문에 등록된 커버 영상은 그 커버의 타이밍에 맞습니다.',
      },
    },
  },
  zh: {
    title: '歌词来源',
    lead: '选择从哪里获取歌词。关闭的来源不会被连接。',
    privacy: '<strong>发送给额外来源的内容：</strong>歌曲名、艺人名和歌曲时长。' +
      '对 LiriQo 和 BuaaaBot 还会额外发送 YouTube 视频 ID。' +
      '不会发送账户信息或播放记录。可以随时在这里撤销权限。',
    granted: '已允许',
    denied: '未获得权限。',
    removed: '已撤销权限。',
    sharedWith: '{name} 使用相同的连接目标，在关闭它之前无法关闭此项。',
    saved: '已允许。将从下一首歌开始使用。',
    groupBuiltin: '标准来源',
    groupBuiltinNote: '无需额外权限即可使用。不需要的可以关闭。',
    groupExtra: '额外来源',
    groupExtraNote: '这些来源提供逐字点亮的歌词（逐字同步）。打开时会请求 Chrome 权限。',
    builtinOn: '已打开。将从下一首歌开始使用。',
    builtinOff: '已关闭。从下一首歌开始不再使用。',
    savedEmbed: '已允许。关闭设置后，从当前歌曲开始使用。',
    builtinOnEmbed: '已打开。关闭设置后，从当前歌曲开始使用。',
    builtinOffEmbed: '已关闭。关闭设置后，从当前歌曲开始不再使用。',
    allOff: '所有来源都已关闭，将不会显示歌词。',
    providers: {
      ytm: {
        name: 'YouTube Music',
        desc: 'YouTube Music 自带的歌词。按视频 ID 查找，不会找错歌曲。逐行同步（没有时间轴的歌曲则无时间）。',
      },
      lrchub: {
        name: 'LRC Hub',
        desc: '除歌词外，还提供翻译、解说和歌手配色数据。' +
          '关闭后，翻译仍按翻译标签页的设置获取。',
      },
      lrclib: {
        name: 'LrcLib',
        desc: '公开的逐行同步歌词数据库。收录广泛，可接住其他来源找不到的歌曲。',
      },
      simpmusic: {
        name: 'SimpMusic',
        desc: '按视频 ID 查找的歌词服务器。部分歌曲有逐字同步。',
      },
      lyricsplus: {
        name: 'LyricsPlus',
        desc: '聚合 Apple Music 等来源的免费共享服务器。经常因繁忙而无响应。',
      },
      kugou: {
        name: 'KuGou',
        desc: '支持的歌曲最多，响应也最快。日语歌曲也会返回逐字同步。',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: '由志愿者手工打轴的逐字同步（CC0）。有收录时质量最好。约收录 3 千首。' +
          '使用 NetEase 的搜索来定位歌曲。',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: '部分歌曲有逐字同步（yrc），没有的也会返回逐行同步。' +
          '与 AMLL 共用搜索，因此允许 AMLL 后这里也会一起启用。',
      },
      liriqo: {
        name: 'LiriQo',
        desc: '聚合 Apple Music 等来源的 API。每首歌需要几秒，因此只在其他来源都找不到时使用。',
      },
      buaaa: {
        name: 'BuaaaBot',
        desc: '主要提供日语歌曲的逐字同步歌词。' +
          '也会按视频 ID 查找，已登记的翻唱视频会使用该翻唱的时间轴。',
      },
    },
  },
};

const PARAMS = new URLSearchParams(location.search);

// 設定パネルに差し込まれている時(?embed=1 で、かつ枠の中にいる)。
// 親のオリジンまでは確かめない。web_accessible_resources で出している先が
// music.youtube.com だけなので、枠に入れられるのは実質 YouTube Music だけ。
// 仮に別の親だったとしても、下の postMessage は宛先を YouTube Music に
// 固定しているので、よその親には届かない。
const EMBEDDED = PARAMS.get('embed') === '1' && window.parent !== window;

// 差し込み先。postMessage の宛先を固定して、ほかのページに中身を漏らさない。
const EMBED_PARENT_ORIGIN = 'https://music.youtube.com';
const EMBED_MESSAGE_TYPE = 'ytm-immersion:extra-providers';

const postToParent = (message) => {
  if (!EMBEDDED) return;
  try {
    window.parent.postMessage({ type: EMBED_MESSAGE_TYPE, ...message }, EMBED_PARENT_ORIGIN);
  } catch (e) { /* 親がいなくなった(タブを閉じた等) */ }
};

// 取得元を切り替えた(その場で保存済み)ことを親に知らせる。
// 親の設定パネルは、閉じた時に今の曲を取り直す。追加の取得元は Chrome の
// 許可なので、親(content script)の側からは変化を見られない。
const notifySourcesChanged = () => postToParent({ kind: 'sources-changed' });

// 表示に使うホスト名。許可ダイアログに出るものと揃える。
const hostLabel = (providerId) => PROVIDER_ORIGINS[providerId]
  .map(origin => origin.replace(/^https:\/\//, '').replace(/\/\*$/, ''))
  .join('  /  ');

const toSupportedLang = (value) => {
  const code = String(value || '').toLowerCase();
  if (code.startsWith('ja')) return 'ja';
  if (code.startsWith('ko')) return 'ko';
  if (code.startsWith('zh')) return 'zh';
  if (code.startsWith('en')) return 'en';
  return '';
};

const pickLang = async () => {
  // 差し込み時は、設定パネルがいま表示している言語を渡してくる。
  // パネルでは保存前に言語を切り替えられるので、storage より優先する。
  const fromParent = toSupportedLang(PARAMS.get('lang'));
  if (fromParent) return fromParent;
  try {
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['ytm_ui_lang'], res => {
        void chrome.runtime.lastError;
        resolve(res?.ytm_ui_lang || '');
      });
    });
    const lang = toSupportedLang(stored);
    if (lang) return lang;
  } catch (e) { /* 読めなければ下のブラウザ設定で決める */ }
  const ui = (chrome.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase();
  return toSupportedLang(ui) || 'en';
};

const contains = (origins) => new Promise(resolve => {
  if (!chrome.permissions?.contains) {
    chrome.storage.local.get(['ytmi_pear_provider_origins'], items => {
      const granted = new Set(items?.ytmi_pear_provider_origins || []);
      resolve(origins.every(origin => granted.has(origin)));
    });
    return;
  }
  chrome.permissions.contains({ origins }, granted => {
    void chrome.runtime.lastError;
    resolve(!!granted);
  });
});

const request = (origins) => new Promise(resolve => {
  if (!chrome.permissions?.request) {
    chrome.storage.local.get(['ytmi_pear_provider_origins'], items => {
      const granted = new Set(items?.ytmi_pear_provider_origins || []);
      origins.forEach(origin => granted.add(origin));
      chrome.storage.local.set({ ytmi_pear_provider_origins: [...granted] }, () => resolve(true));
    });
    return;
  }
  chrome.permissions.request({ origins }, granted => {
    void chrome.runtime.lastError;
    resolve(!!granted);
  });
});

// 取り消しは、他の取得元がまだ使っているホストを巻き込まない。
// AMLL と NetEase はどちらも music.163.com を使うので、AMLL だけ切った時に
// NetEase まで動かなくなると分かりにくい。
//
// 逆に、AMLL が付いたままだと NetEase を切っても接続先は残る。
// 黙ってチェックが戻るだけだと理由が分からないので、誰が握っているかを返す。
const remove = async (providerId) => {
  const holders = new Map();
  for (const other of PROVIDER_IDS) {
    if (other === providerId) continue;
    if (!await contains(PROVIDER_ORIGINS[other])) continue;
    for (const origin of PROVIDER_ORIGINS[other]) {
      if (!holders.has(origin)) holders.set(origin, other);
    }
  }
  const origins = PROVIDER_ORIGINS[providerId].filter(origin => !holders.has(origin));
  const blockedBy = [...new Set(
    PROVIDER_ORIGINS[providerId].filter(origin => holders.has(origin)).map(origin => holders.get(origin)),
  )];
  if (!origins.length) return { removed: false, blockedBy };
  if (!chrome.permissions?.remove) {
    const granted = new Set();
    await new Promise(resolve => chrome.storage.local.get(['ytmi_pear_provider_origins'], items => {
      (items?.ytmi_pear_provider_origins || []).forEach(origin => granted.add(origin));
      origins.forEach(origin => granted.delete(origin));
      chrome.storage.local.set({ ytmi_pear_provider_origins: [...granted] }, resolve);
    }));
    return { removed: true, blockedBy };
  }
  const removed = await new Promise(resolve => {
    chrome.permissions.remove({ origins }, ok => {
      void chrome.runtime.lastError;
      resolve(!!ok);
    });
  });
  return { removed, blockedBy };
};

// 親に中身の高さを伝え続ける。iframe は別オリジンなので、親からは測れない。
// 測るのは <html> の箱。scrollHeight は iframe の表示域より小さくならないので、
// 一度広げると縮められなくなる。
//
// 測った時の横幅も一緒に送る。iframe は横幅が決まる前に一度並べられることがあり、
// その時の高さはとても大きい(実測 2964px。本来は 634px)。親はいまの横幅と
// 合わない知らせを捨てる。そのまま受けて広げると、iframe がパネルの見えない
// 位置まではみ出し、Chrome が見えない別オリジンの枠の描画を止めるので、
// 正しい高さの知らせがスクロールして見えるまで届かなくなる。
const reportHeightToParent = () => {
  let last = '';
  const send = () => {
    const width = Math.round(window.innerWidth || 0);
    if (!width) return;                     // まだ横幅が無い(パネルが閉じている等)
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    const key = `${width}x${height}`;
    if (key === last) return;
    last = key;
    postToParent({ kind: 'size', height, width });
  };
  new ResizeObserver(send).observe(document.body);
  send();
};

const main = async () => {
  if (EMBEDDED) document.documentElement.classList.add('embed');

  const lang = await pickLang();
  const t = TEXT[lang] || TEXT.en;
  // 差し込まれている時は「設定を閉じると今の曲から」、別タブでは「次の曲から」
  const statusText = (key) => (EMBEDDED && t[`${key}Embed`]) || t[key];
  document.documentElement.lang = lang;
  document.title = `${t.title} — YTM-Immersion`;
  document.getElementById('title').textContent = t.title;
  document.getElementById('lead').textContent = t.lead;
  document.getElementById('note-privacy').innerHTML = t.privacy;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText('group-builtin-title', t.groupBuiltin);
  setText('group-builtin-note', t.groupBuiltinNote);
  setText('group-extra-title', t.groupExtra);
  setText('group-extra-note', t.groupExtraNote);

  const status = document.getElementById('status');
  const builtinList = document.getElementById('providers-builtin');
  const list = document.getElementById('providers');
  const boxes = new Map();
  const builtinBoxes = new Map();

  // 1行ぶん(トグル・名前・説明・通信先)を組む
  const makeRow = (id, hostText) => {
    const item = t.providers[id];

    const li = document.createElement('li');
    li.className = 'provider';

    const head = document.createElement('label');
    head.className = 'provider-head';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.provider = id;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    badge.textContent = t.granted;

    head.append(box, name, badge);

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = item.desc;

    const hosts = document.createElement('p');
    hosts.className = 'hosts';
    hosts.textContent = hostText;

    li.append(head, desc, hosts);
    return { li, box, badge };
  };

  // 全部オフだと歌詞がまったく出ない。気付けるように添える。
  const warnIfAllOff = async (message) => {
    const anyBuiltinOn = [...builtinBoxes.values()].some(box => box.checked);
    const anyExtraOn = [...boxes.values()].some(({ box }) => box.checked);
    status.textContent = (anyBuiltinOn || anyExtraOn) ? message : `${message} ${t.allOff}`;
  };

  // ── 標準の取得元 ──
  // 許可では止められないので、オフにしたものを storage に持つ。
  if (builtinList) {
    for (const id of BUILTIN_SOURCE_IDS) {
      if (!t.providers[id]) continue;
      const { li, box } = makeRow(id, BUILTIN_SOURCE_HOSTS[id].join('  /  '));
      builtinList.append(li);
      builtinBoxes.set(id, box);

      box.addEventListener('change', async () => {
        box.disabled = true;
        const disabled = await loadDisabledSources();
        if (box.checked) disabled.delete(id);
        else disabled.add(id);
        await saveDisabledSources([...disabled]);
        notifySourcesChanged();
        box.disabled = false;
        await warnIfAllOff(box.checked ? statusText('builtinOn') : statusText('builtinOff'));
      });
    }
  }

  // ── 追加の取得元 ──
  // 追加の取得元の表示順。
  const order = ['kugou', 'amll', 'netease', 'liriqo', 'buaaa'];

  for (const id of order) {
    if (!PROVIDER_ORIGINS[id]) continue;
    const { li, box, badge } = makeRow(id, hostLabel(id));
    list.append(li);
    boxes.set(id, { box, badge });

    box.addEventListener('change', async () => {
      box.disabled = true;
      let message;
      if (box.checked) {
        const granted = await request(PROVIDER_ORIGINS[id]);
        box.checked = granted;
        message = granted ? statusText('saved') : t.denied;
      } else {
        const { removed, blockedBy } = await remove(id);
        if (!removed && blockedBy.length) {
          const names = blockedBy.map(other => t.providers[other]?.name || other).join('・');
          message = t.sharedWith.replace('{name}', names);
        } else {
          message = t.removed;
        }
      }
      box.disabled = false;
      notifySourcesChanged();
      await refresh();
      await warnIfAllOff(message);
    });
  }

  const refresh = async () => {
    for (const [id, { box, badge }] of boxes) {
      const granted = await contains(PROVIDER_ORIGINS[id]);
      box.checked = granted;
      badge.hidden = !granted;
    }
    const disabled = await loadDisabledSources();
    for (const [id, box] of builtinBoxes) box.checked = !disabled.has(id);
  };

  // 別のタブや chrome://extensions から変えられることもある。
  // 設定パネルの「設定をリセット」で storage から消えることもある。
  chrome.permissions?.onAdded?.addListener(() => void refresh());
  chrome.permissions?.onRemoved?.addListener(() => void refresh());
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[DISABLED_LYRIC_SOURCES_KEY]) void refresh();
    });
  } catch (e) { /* 拾えなければ開き直した時に反映される */ }

  await refresh();

  if (EMBEDDED) {
    // iframe の中でキーを押している間は、親の Esc(設定を閉じる)が効かない。
    // 同じ操作で閉じられるように親へ伝える。
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') postToParent({ kind: 'escape' });
    });
    // 読み込めたことを先に伝える。パネルが閉じている間は高さが測れない
    // (描画されない)ので、高さとは別に知らせる。
    postToParent({ kind: 'ready' });
    reportHeightToParent();
  }
};

void main();
