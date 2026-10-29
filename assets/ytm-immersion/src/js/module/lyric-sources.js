// 標準の歌詞ソース(許可なしで使える取得元)の入切。
//
// 追加の取得元(extra-providers.js)は optional_host_permissions で、
// 「許可したかどうか」がそのまま入切になっている。こちらの5つは
// host_permissions(YTM はページ自身)なので許可では止められない。
// 代わりに「使わない」と選んだものの ID を storage に持つ。
//
// 持つのは「オフにしたもの」の方。新しい取得元を足した時に、既存の
// 利用者の分も既定でオンになるように。
//
// 読むのは3か所: background(取得の段取り)、options.js(設定の画面)、
// lyrics-ui.js(YTM の取得は content script でしかできないので、そこで止める)。
// lyrics-ui.js は classic script で import できないので、キー名を
// 同じ文字列で持っている。変える時は両方変えること。

export const DISABLED_LYRIC_SOURCES_KEY = 'ytm_disabled_lyric_sources';

// 並びは設定画面の表示順
export const BUILTIN_SOURCE_IDS = ['ytm', 'lrchub', 'lrclib', 'simpmusic', 'lyricsplus'];

// 設定画面に出す通信先。manifest の host_permissions と食い違わないこと
// (tests/lyric-sources.test.mjs が見ている)。
export const BUILTIN_SOURCE_HOSTS = {
  ytm: ['music.youtube.com'],
  lrchub: ['lrchub.coreone.work'],
  lrclib: ['lrclib.net'],
  simpmusic: ['api-lyrics.simpmusic.org'],
  lyricsplus: [
    'lyricsplus.prjktla.my.id',
    'lyricsplus.prjktla.workers.dev',
    'lyricsplus-seven.vercel.app',
  ],
};

export const normalizeDisabledSources = (value) => (
  Array.isArray(value)
    ? [...new Set(value.map(v => String(v || '').trim().toLowerCase()).filter(id => BUILTIN_SOURCE_IDS.includes(id)))]
    : []
);

export const loadDisabledSources = () => new Promise(resolve => {
  try {
    chrome.storage.local.get([DISABLED_LYRIC_SOURCES_KEY], res => {
      void chrome.runtime.lastError;
      resolve(new Set(normalizeDisabledSources(res?.[DISABLED_LYRIC_SOURCES_KEY])));
    });
  } catch (e) {
    // 読めない時は全部使う。止める側に倒すと歌詞が出なくなる
    resolve(new Set());
  }
});

export const saveDisabledSources = (ids) => new Promise(resolve => {
  try {
    chrome.storage.local.set({ [DISABLED_LYRIC_SOURCES_KEY]: normalizeDisabledSources(ids) }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  } catch (e) {
    resolve();
  }
});
