import * as CloudSync from './module/bg-cloud-sync.js';
import * as API from './module/api.js';
import * as Extra from './module/extra-providers.js';
import * as Sources from './module/lyric-sources.js';
import * as Agreement from './module/lyrics-agreement.js';
import * as LocalLyrics from './module/local-lyrics.js';

// ── デバッグログ ────────────────────────────────────────────
// Service Worker には localStorage が無いので chrome.storage を見る。
// 既定は無効。有効化は content script 側と同じ ytm_debug キー。
const YTMLog = (() => {
  let enabled = false;
  const noop = () => { };
  const api = {
    enabled: false,
    log: (...a) => { if (enabled) console.log('[YTM]', ...a); },
    info: (...a) => { if (enabled) console.info('[YTM]', ...a); },
    debug: (...a) => { if (enabled) console.debug('[YTM]', ...a); },
  };
  try {
    chrome.storage.local.get(['ytm_debug'], (res) => {
      enabled = res && (res.ytm_debug === '1' || res.ytm_debug === true);
      api.enabled = enabled;
    });
  } catch (e) { /* 読めなければ無効のまま */ }
  return api;
})();


// フォールバック段で「先着した方」を確定させる前に置く猶予。
// 表示前に一度だけ待つ値なので、伸ばすとそのまま歌詞の初回表示が遅れる。
const FALLBACK_GRACE_MS = 600;

// LRCHub の一次問い合わせをどこまで待って「先に出す」判断をするか。
const EARLY_HUB_WAIT_MS = 1500;
// LRCHub が早く答えた時、他の取得元の答え(突き合わせの相手)を待つ上限。
// LrcLib / SimpMusic / YouTube Music は同時に走っていて、たいていこの間に届く。
const FIRST_OPINION_WAIT_MS = 500;
// 「単語同期 優先」で、単語同期の候補を集めてから1つ選ぶまでの待ち。
// 以前は最初に届いたものがそのまま採られ、後から届いたより確かなものに替わらなかった。
const WORDSYNC_COLLECT_MS = 1000;

// LRCHub の経路の名前(makeRawHubTask の source)。動画 ID で引く経路と、
// 曲名で探す経路を見分ける(pushHubUpgrade)
const VIDEO_KEYED_HUB_SOURCES = new Set(['LRCHub', 'LRCHub retry']);
const HUB_TITLE_SEARCH_SOURCE = 'LRCHub search';

// content script から届く YouTube Music の歌詞(突き合わせの票)を、
// 走っている GET_LYRICS へ渡す口。キーは request_id。
// 時計で消すと Service Worker を起こし続けるので、数で抑える(古いものから消す)。
const lyricsReferenceSinks = new Map();
const pendingLyricsReferences = new Map();
const LYRICS_REFERENCE_KEEP = 4;
const rememberLimited = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > LYRICS_REFERENCE_KEEP) map.delete(map.keys().next().value);
};

// 待ちを重ねない。上の猶予は「最初の有効な結果が出てから」の総量として
// 使い、段ごとに足し算しない。以前は 1.5 秒 + 0.6 秒 + 0.8 秒と積み上がり、
// LrcLib の歌詞が手元にあるのに最大 2.9 秒あとまで出せなかった。
const POST_FALLBACK_GRACE_MS = 800;

// 文字(語)単位の時刻を実際に持っているか。本体は api.js。
// GET_LYRICS と FIND_ALTERNATE_LYRICS の両方から使うのでモジュール直下に置く。
const hasCharacterSyncedLines = API.hasCharacterSyncedLines;

// ── 別の曲のデータを弾く ──────────────────────────────────
// 取得元によっては、videoId に紐づいたレコードの中身が別の曲ということが
// ある。実測: 夢灯籠(S6kjwLlKXnk / 131秒)のレコードに「夏のせい」の歌詞が
// 入っていた。songTitle も artistName も正しく「夢灯籠 / RADWIMPS」なので、
// メタデータを突き合わせても気づけない。
//
// 手がかりは時刻。歌詞の最後の行が曲の終わりを大きく超えていたら、
// その歌詞はこの曲のものではない。上の例では歌詞が 317 秒まで続いていた
// (曲の 2.4 倍)。曲の長さは <video>.duration の実測値なので信用できる。
//
// 版違いで数十秒ずれる正しいデータを巻き込まないよう、弾くのは
// 「明らかに別物」だけに絞る。手元の正しい5曲での超過は最大 62 秒だった。
const LYRICS_OVERSHOOT_RATIO = 1.25;
const LYRICS_OVERSHOOT_MARGIN_SEC = 30;

const lastLyricTimeSec = (lyrics) => {
  const text = String(lyrics ?? '');
  if (!text) return null;
  let last = null;
  // [mm:ss.xx] と [hh:mm:ss.xx] の両方
  const re = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  let m;
  while ((m = re.exec(text))) {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const sec = Number(String(m[3]).replace(':', '.'));
    if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
    const t = h * 3600 + min * 60 + sec;
    if (last === null || t > last) last = t;
  }
  return last;
};

const lyricsBelongToTrack = (lyrics, durationSec) => {
  const duration = Number(durationSec);
  // 長さが分からない時は判断しない。弾く方に倒すと歌詞が出なくなる
  if (!Number.isFinite(duration) || duration <= 0) return true;
  const last = lastLyricTimeSec(lyrics);
  if (last === null) return true;   // 時刻なしの歌詞は対象外
  return last <= duration * LYRICS_OVERSHOOT_RATIO + LYRICS_OVERSHOOT_MARGIN_SEC;
};

// 取得元をまたいだ候補メニューの表示名
const PROVIDER_CANDIDATE_LABELS = {
  lrchub: 'LRC Hub',
  lrclib: 'LrcLib',
  simpmusic: 'SimpMusic',
  lyricsplus: 'LyricsPlus',
  amll: 'AMLL DB',
  netease: 'NetEase',
  kugou: 'KuGou',
  liriqo: 'LiriQo',
  buaaa: 'BuaaaBot',
};

// 取得元1つぶんを候補メニューの1項目に均す。
// 選んだ時に追加取得が要らないよう、歌詞本文まで持たせておく。
const buildProviderCandidate = (providerId, res) => {
  const lyrics = typeof res?.lyrics === 'string' ? res.lyrics.trim() : '';
  if (!lyrics) return null;
  return {
    id: `provider_${providerId}`,
    label: PROVIDER_CANDIDATE_LABELS[providerId] || providerId,
    providerCandidate: true,
    lyricsSource: providerId,
    lyrics,
    dynamicLines: hasCharacterSyncedLines(res.dynamicLines) ? res.dynamicLines : null,
    animated_lyrics: res.animated_lyrics || res.timedtext || res.timed_text || null,
    record_id: providerId === 'lrchub' ? getLrchubRecordId(res) : null,
    lyricsComplete: true,
    has_synced: /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics),
    offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
  };
};

// 本体は api.js。ここで二重に持つと、拾うキーが片方だけ増えた時に食い違う。
const getLrchubRecordId = API.getLrchubRecordId;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(CloudSync.CLOUD_STORAGE_KEY, (items) => {
    if (!items || !items[CloudSync.CLOUD_STORAGE_KEY]) {
      chrome.storage.local.set({ [CloudSync.CLOUD_STORAGE_KEY]: CloudSync.DEFAULT_CLOUD_STATE });
    }
  });
});

// ── Immersion の入口(ツールバーのアイコン・ショートカット) ──
// プレイヤーバーの IMMERSION ボタンは YTM の作り次第で出せないことがある。
// こちらは YTM の画面と関係なく必ず押せる入口。
//  ・YTM のタブで押した → そのタブで開く/閉じる
//  ・別のタブで押した   → YTM のタブへ移って開く(無ければ YTM を開く)
const YTM_ORIGIN = 'https://music.youtube.com/';
const sendImmersionAction = async (tabId, action) => {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'YTMI_IMMERSION', action });
  } catch (e) {
    // 拡張を入れ直した直後など、ページを読み直すまで受け手がいない
    YTMLog.log('Immersion の切り替えを届けられなかった:', e && e.message);
  }
};
const openImmersionFrom = async (tab) => {
  if (tab && tab.id != null && typeof tab.url === 'string' && tab.url.startsWith(YTM_ORIGIN)) {
    await sendImmersionAction(tab.id, 'toggle');
    return;
  }
  const [ytm] = await chrome.tabs.query({ url: `${YTM_ORIGIN}*` });
  if (ytm) {
    await sendImmersionAction(ytm.id, 'open');
    return;
  }
  chrome.runtime.sendMessage({ type: 'YTMI_OPEN_URL', url: YTM_ORIGIN });
};
chrome.action?.onClicked.addListener((tab) => {
  openImmersionFrom(tab).catch(e => console.warn('[YTM] Immersion を開けなかった', e));
});
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-immersion') return;
  openImmersionFrom(tab).catch(e => console.warn('[YTM] Immersion を開けなかった', e));
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !req.type) {
    return;
  }

  if (req.type === 'GET_CLOUD_STATE') {
    CloudSync.loadCloudState()
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SAVE_RECOVERY_TOKEN') {
    const token = typeof req.token === 'string' ? req.token.trim() : '';
    CloudSync.saveCloudState({ recoveryToken: token || null })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'OPEN_LOGIN_PAGE') {
    (async () => {
      try {
        const state = await CloudSync.loadCloudState();
        const base = (state.serverBaseUrl || CloudSync.DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
        const loginPath = state.loginPath || CloudSync.DEFAULT_CLOUD_STATE.loginPath || '/auth/discord';
        const url = base + loginPath;
        chrome.runtime.sendMessage({ type: 'YTMI_OPEN_URL', url });
        sendResponse({ ok: true, url });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // 追加の歌詞サーバーの許可ページを開く。
  //
  // 通信先が optional_host_permissions なので、許可は
  // chrome.permissions.request() で取る。あれはユーザー操作を起点に、
  // かつ拡張のページからしか呼べない。設定 UI は content script として
  // YouTube Music のページに差し込んでいるので、そこからは呼べない。
  // ふだんは設定パネルが許可ページを iframe で差し込んで、その中で許可を
  // 取る(lyrics-ui.js の mountExtraProvidersFrame)。これは差し込みが
  // 読み込めなかった時の逃げ道で、パネルのボタンから投げてもらう。
  if (req.type === 'OPEN_EXTRA_PROVIDERS_SETUP') {
    try {
      chrome.runtime.sendMessage({ type: 'YTMI_OPEN_OPTIONS' });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }

  // YouTube Music の歌詞。表示には使わず、他の取得元の歌詞が合っているかを
  // 確かめる票にする(content script でしか取れないので、届いたら渡してもらう)。
  if (req.type === 'LYRICS_REFERENCE') {
    const { request_id, lyrics } = req.payload || {};
    if (request_id && typeof lyrics === 'string' && lyrics.trim()) {
      const sink = lyricsReferenceSinks.get(request_id);
      if (sink) sink(lyrics);
      else rememberLimited(pendingLyricsReferences, request_id, lyrics);
    }
    sendResponse({ ok: true });
    return;
  }

  // いま使わない取得元の一覧。content script はキャッシュを出す前にこれを見て、
  // 切られた取得元の歌詞を出さない。追加の取得元の入切は Chrome の許可で、
  // content script からは chrome.permissions が見えないのでここで答える。
  if (req.type === 'GET_OFF_LYRIC_SOURCES') {
    (async () => {
      const off = new Set(await Sources.loadDisabledSources());
      for (const providerId of Extra.PROVIDER_IDS) {
        if (!Extra.EXTRA_PROVIDERS_ENABLED || Extra.PROVIDER_SWITCHES[providerId] === false ||
          !await Extra.hasProviderPermission(providerId)) {
          off.add(providerId);
        }
      }
      sendResponse({ success: true, off: [...off] });
    })().catch(() => sendResponse({ success: false, off: [] }));
    return true;
  }

  // 手元の歌詞ファイル(拡張 LRC・TTML)を語同期の形に組む。lyrics-ui.js の handleUpload から。
  if (req.type === 'PARSE_LOCAL_LYRICS') {
    try {
      const parsed = LocalLyrics.parseLocalLyricsFile(req.payload?.text);
      sendResponse({ success: !!parsed, parsed: parsed || null });
    } catch (e) {
      sendResponse({ success: false, parsed: null, error: String(e) });
    }
    return false;
  }

  if (req.type === 'GET_LYRIC_SINGERS') {
    const { record_id, video_id, youtube_url, url } = req.payload || {};
    (async () => {
      try {
        const singerMetadata = await API.withTimeout(
          API.fetchLrchubSingerMetadata({ record_id, video_id, youtube_url, url }),
          5000,
          'lrchub singers'
        );
        if (!singerMetadata) {
          sendResponse({ success: false, singerMetadata: null });
          return;
        }
        sendResponse({ success: true, singerMetadata });
      } catch (e) {
        sendResponse({ success: false, singerMetadata: null, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'SYNC_HISTORY') {
    const history = Array.isArray(req.history) ? req.history : (req.payload && Array.isArray(req.payload.history) ? req.payload.history : []);
    (async () => {
      try {
        const result = await CloudSync.cloudSyncHistory(history);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'TRANSLATE') {
    const { text, apiKey, targetLang, useSharedTranslateApi } = req.payload || {};
    const target = targetLang || 'JA';
    const texts = Array.isArray(text) ? text : [text];

    const translateViaDeepL = async () => {
      if (!apiKey) throw new Error('DeepL API key is missing');
      const endpoint = apiKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      const body = { text: texts, target_lang: target };

      const res = await API.withTimeout(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        20000,
        'deepl translate timeout'
      );

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`DeepL translate failed: ${res.status} ${msg}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.translations)) {
        throw new Error('DeepL translate: invalid response');
      }
      return {
        translations: data.translations,
        engine: 'deepl',
        plan: apiKey.endsWith(':fx') ? 'free' : 'pro',
      };
    };

    (async () => {
      try {
        if (useSharedTranslateApi) {
          sendResponse({ success: false, error: 'Shared translation is fetched from LRCHub /api/lyrics.' });
          return;
        }
        const deepl = await translateViaDeepL();
        sendResponse({
          success: true,
          translations: deepl.translations,
          engine: deepl.engine,
          plan: deepl.plan,
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  // 歌詞取得
  if (req.type === 'GET_LYRICS') {
    const {
      track,
      artist,
      youtube_url,
      video_id,
      album,
      duration_sec,
      use_lrclib = true,
      offset_ms,
      translate_to,
      translation_source,
      lyric_source_mode = 'standard',
      request_id,
      track_key,
      artist_alt,
      title_full,
      lookup_video_id,
    } = req.payload || {};
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const resolvedVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
    // 動画モードでは、歌詞を MV ではなく音源(曲版)の videoId で引く(lyrics-ui.js の
    // resolveMovieLookupSong)。resolvedVideoId は「どの動画への答えか」の照合に使うので
    // MV のまま返し、取得元へ渡す videoId / URL だけ音源に替える。
    const lookupVideoId = lookup_video_id || resolvedVideoId;
    const lookupUrl = lookup_video_id ? `https://youtu.be/${lookup_video_id}` : youtube_url;
    const hasTranslateRequest = Array.isArray(translate_to) ? translate_to.length > 0 : !!translate_to;
    const lrchubLyricsMethod = hasTranslateRequest ? 'GET' : 'POST';
    // 「単語同期 優先」。'ytm' / 'lrchub' が「どこに先に聞くか」なのに対し、
    // これだけは「どのサーバーでもいいから単語同期を持っている方を採る」。
    // 出した歌詞を後から単語同期で差し替えることまで含む(翻訳や解説が
    // 乗っていた歌詞から入れ替わることがある、と設定画面に明記してある)。
    const preferWordSync = lyric_source_mode === 'wordsync';

    YTMLog.log('[BG] GET_LYRICS', { track, artist, artist_alt, lyric_source_mode });

    let responded = false;
    const sendOnce = (payload) => {
      if (responded) return;
      responded = true;
      sendResponse(payload);
    };

    (async () => {
      const requestIdentity = {
        request_id: request_id || null,
        track_key: track_key || null,
        track: track || '',
        artist: artist || '',
        video_id: resolvedVideoId || null,
      };

      // 設定の「歌詞ソース」タブでオフにされた標準の取得元は叩かない。
      // 追加の取得元は許可の有無がそのまま入切なので、ここでは見ない。
      const disabledSources = await Sources.loadDisabledSources();
      const sourceOn = (providerId) => !disabledSources.has(providerId);
      const lrchubOn = sourceOn('lrchub');

      const getHubLyricsQuality = (hubRes) => {
        const animated = hubRes?.animated_lyrics || hubRes?.timedtext || hubRes?.timed_text;
        // srv3 はアニメーション表示そのもの。DynamicLRC が先着していても
        // 後着の srv3 を content script へ届けられるよう最上位にする。
        if (typeof animated === 'string' && animated.trim()) return 5;
        if (hasCharacterSyncedLines(hubRes?.dynamicLines)) return 4;
        if (typeof hubRes?.lyrics === 'string' && /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(hubRes.lyrics)) return 2;
        return typeof hubRes?.lyrics === 'string' && hubRes.lyrics.trim() ? 1 : 0;
      };

      const buildLrcLibPayload = (lrcLibRes, fallbackUsed) => ({
        success: true,
        record_id: null,
        lyrics: lrcLibRes.lyrics,
        animated_lyrics: null,
        dynamicLines: null,
        subLyrics: '',
        hasSelectCandidates: Array.isArray(lrcLibRes.candidates) && lrcLibRes.candidates.length > 1,
        candidates: lrcLibRes.candidates || [],
        lyricsSource: 'lrclib',
        fallbackUsed: !!fallbackUsed,
        offset_ms: 0,
        ...requestIdentity,
      });

      // providerId は content script 側が「今どこの歌詞か」を見る値。
      // 既定は 'lrchub'。LRCHub 以外のプロバイダーは自分の ID を渡す。
      const buildHubLyricsPayload = (hubRes, sourceLabel, providerId = 'lrchub') => {
        const candidates = Array.isArray(hubRes.candidates) ? hubRes.candidates : [];
        const meaningData = hubRes.meaningData || API.normalizeLrchubMeaningPayload(hubRes);
        return {
          success: true,
          record_id: getLrchubRecordId(hubRes),
          lyrics: hubRes.lyrics,
          animated_lyrics: hubRes.animated_lyrics || hubRes.timedtext || hubRes.timed_text || null,
          dynamicLines: hasCharacterSyncedLines(hubRes.dynamicLines) ? hubRes.dynamicLines : null,
          subLyrics: typeof hubRes.subLyrics === 'string' ? hubRes.subLyrics : '',
          hasSelectCandidates: candidates.length > 1,
          candidates,
          config: hubRes.config || null,
          requests: hubRes.requests || [],
          meaningData,
          songSummary: hubRes.songSummary || hubRes.song_summary || hubRes.final_summary || null,
          comments: Array.isArray(hubRes.comments) ? hubRes.comments : [],
          rating: hubRes.rating || null,
          translations: hubRes.translations || null,
          lrcMap: {
            ...API.normalizeLrchubTranslations(hubRes.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes.translations),
            // normalizeLrchubLyricsResponse has already aligned timed
            // translations to the selected video's timeline.
            ...API.normalizeLrchubTranslations(hubRes.lrcMap)
          },
          lyricsSource: providerId,
          sourceLabel,
          fallbackUsed: false,
          lyricsQuality: getHubLyricsQuality(hubRes),
          offset_ms: Number.isFinite(Number(hubRes.offset_ms)) ? Number(hubRes.offset_ms) : 0,
          ...requestIdentity,
        };
      };

      const pushLyricsUpdate = async (payload) => {
        if (!tabId) return false;
        try {
          const sent = chrome.tabs.sendMessage(tabId, {
            type: 'LYRICS_DATA_UPDATE',
            payload,
          });
          if (sent && typeof sent.then === 'function') await sent;
          return true;
        } catch (e) {
          YTMLog.debug('[BG] Late lyrics update skipped:', e);
          return false;
        }
      };

      // ── 取得元をまたいだ候補 ────────────────────────────
      // 自動選択が1つを選んだあとも、他の取得元が返した歌詞は捨てずに
      // 候補メニューへ流しておく。上流のデータが壊れている・別テイクの
      // タイムラインが入っている、といった自動判定では気付けない外れを、
      // その場で1クリックで乗り換えられるようにするため。
      //
      // 表示中の歌詞には触れない専用の経路(LYRICS_META_UPDATE)で送る。
      // 出したものが後から勝手に入れ替わる方が体験としては悪い。
      const offeredProviderCandidates = new Set();
      const offerProviderCandidate = (providerId, res) => {
        if (!tabId || !res || offeredProviderCandidates.has(providerId)) return;
        const candidate = buildProviderCandidate(providerId, res);
        if (!candidate) return;
        offeredProviderCandidates.add(providerId);
        try {
          chrome.tabs.sendMessage(tabId, {
            type: 'LYRICS_META_UPDATE',
            payload: {
              video_id: resolvedVideoId || null,
              mergeCandidates: [candidate],
            },
          });
        } catch (e) {
          YTMLog.debug('[BG] Provider candidate offer skipped:', e);
        }
      };

      const asHubResult = (source, res, providerId = 'lrchub') => {
        if (!(res && typeof res.lyrics === 'string' && res.lyrics.trim())) return null;
        // 中身が別の曲のレコードはここで落とす。候補メニューにも出さない
        // (この関門を通った結果にだけ offerProviderCandidate が掛かる)。
        if (!lyricsBelongToTrack(res.lyrics, duration_sec)) {
          YTMLog.log(
            `[BG] ${source} の歌詞は別の曲とみなして不採用 ` +
            `(歌詞は ${Math.round(lastLyricTimeSec(res.lyrics))}秒まで / 曲は ${duration_sec}秒)`
          );
          return null;
        }
        return { source, res, providerId };
      };

      const firstValidResult = (tasks) => new Promise(resolve => {
        const pendingTasks = tasks.filter(Boolean);
        if (!pendingTasks.length) {
          resolve(null);
          return;
        }
        let pending = pendingTasks.length;
        let settled = false;
        pendingTasks.forEach(task => {
          Promise.resolve(task)
            .then(result => {
              pending -= 1;
              if (result && !settled) {
                settled = true;
                resolve(result);
              } else if (pending === 0 && !settled) {
                settled = true;
                resolve(null);
              }
            })
            .catch(() => {
              pending -= 1;
              if (pending === 0 && !settled) {
                settled = true;
                resolve(null);
              }
            });
        });
      });

      let deliveredHubQuality = 0;
      let deliveredProviderId = null;
      const resolvedHubResults = [];

      // ── 取得元どうしの突き合わせ ──────────────────────────
      // 取得元に登録されている中身そのものが違うことがある(別の曲・ローマ字・
      // 切れ端・訳が混ざったもの)。届いた歌詞を全部ここに溜めて互いに比べ、
      // 他と合わないものは出さない。出した後で外れと分かったら、合っている
      // 歌詞へ替える(品質が下がっても。間違った歌詞より正しい行同期の方がいい)。
      // 詳しくは lyrics-agreement.js。
      const pool = new Map();   // source → result
      const voters = [];        // YouTube Music の歌詞(票だけ)
      let deliveredResult = null;
      const opinionWaiters = new Set();
      const entryOf = (r) => ({
        key: r.source,
        providerId: r.providerId,
        lyrics: r.res?.lyrics,
        quality: getHubLyricsQuality(r.res),
      });
      const verdictOf = (r) => (
        r ? Agreement.judgeLyrics([...[...pool.values()].map(entryOf), ...voters], { track }).get(r.source) : undefined
      );
      const bestAgreedResult = (among = [...pool.values()]) => {
        const others = [...pool.values()].filter(r => !among.includes(r)).map(entryOf);
        const pick = Agreement.pickAgreedLyrics(among.map(entryOf), [...others, ...voters], { track });
        return pick ? pool.get(pick.key) || null : null;
      };
      const waitForOpinion = (ms) => Promise.race([
        API.delay(ms),
        new Promise(resolve => opinionWaiters.add(resolve)),
      ]);
      const addOpinion = () => {
        for (const wake of opinionWaiters) wake();
        opinionWaiters.clear();
        reviewDelivered();
      };
      const noteResult = (r) => {
        if (!r || pool.has(r.source)) return;
        pool.set(r.source, r);
        addOpinion();
      };
      if (request_id) {
        rememberLimited(lyricsReferenceSinks, request_id, (lyrics) => {
          voters.splice(0, voters.length, { key: 'ytm', providerId: 'ytm', lyrics });
          addOpinion();
        });
        const early = pendingLyricsReferences.get(request_id);
        if (early) {
          pendingLyricsReferences.delete(request_id);
          voters.push({ key: 'ytm', providerId: 'ytm', lyrics: early });
        }
      }

      const payloadOf = (r) => ({
        ...(r.providerId === 'lrclib'
          ? buildLrcLibPayload(r.res, true)
          : buildHubLyricsPayload(r.res, r.source, r.providerId)),
        agreement: verdictOf(r) || 'unknown',
      });

      const sendHubLyrics = (hubRes, sourceLabel, providerId = 'lrchub') => {
        YTMLog.log(`[BG] Won: ${sourceLabel}`);
        deliveredHubQuality = Math.max(deliveredHubQuality, getHubLyricsQuality(hubRes));
        deliveredProviderId = providerId;
        deliveredResult = pool.get(sourceLabel) || { source: sourceLabel, providerId, res: hubRes };
        sendOnce({ ...buildHubLyricsPayload(hubRes, sourceLabel, providerId), agreement: verdictOf(deliveredResult) || 'unknown' });
      };

      const sendLrcLibLyrics = (result) => {
        deliveredProviderId = 'lrclib';
        deliveredResult = result;
        sendOnce(payloadOf(result));
      };

      // 出そうとしたものが既に外れと分かっていれば、合っている方を出す
      const deliver = (result) => {
        let chosen = result;
        if (verdictOf(result) === 'contradicted') {
          chosen = bestAgreedResult() || result;
          if (chosen !== result) YTMLog.log(`[BG] ${result.source} は他の取得元と合わないので ${chosen.source} を出す`);
        }
        if (chosen.providerId === 'lrclib') sendLrcLibLyrics(chosen);
        else sendHubLyrics(chosen.res, chosen.source, chosen.providerId);
      };

      // 外れと分かっているものしか手元に無い時は、代わりが届くまで少し待つ
      // (実測: Blinding Lights の LRC Hub はクレジット1行だけで、YouTube Music の
      //  歌詞と比べた時点で外れと分かるが、代わりの SimpMusic はまだ届いていない)。
      // 同時に走っている取得元が全部答え終えたら、それ以上は待たない。
      const deliverChecked = async (result) => {
        for (let i = 0; i < 3; i++) {
          if (verdictOf(result) !== 'contradicted' || bestAgreedResult()) break;
          const settled = await Promise.race([
            waitForOpinion(FIRST_OPINION_WAIT_MS).then(() => false),
            Promise.allSettled([lrcLibTask, simpMusicRawTask].filter(Boolean)).then(() => true),
          ]);
          if (settled && !bestAgreedResult()) break;
        }
        if (!responded) deliver(result);
      };

      // 出した歌詞が、あとから届いた答えと合わないと分かったら替える
      function reviewDelivered() {
        if (!responded || !deliveredResult) return;
        if (verdictOf(deliveredResult) !== 'contradicted') return;
        const alt = bestAgreedResult();
        if (!alt || alt === deliveredResult) return;
        const replaces = deliveredProviderId;
        YTMLog.log(`[BG] ${deliveredResult.source} は他の取得元と合わないので ${alt.source} に替える`);
        deliveredResult = alt;
        deliveredProviderId = alt.providerId;
        deliveredHubQuality = alt.providerId === 'lrclib' ? 0 : getHubLyricsQuality(alt.res);
        void pushLyricsUpdate({ ...payloadOf(alt), correction: true, replaces });
      }

      // 「単語同期 優先」で届いた単語同期は、少し集めてから選ぶ
      const wordSyncPending = [];
      let wordSyncFlushTimer = null;
      const flushWordSync = () => {
        wordSyncFlushTimer = null;
        const best = bestAgreedResult(wordSyncPending.splice(0));
        if (!best) return;
        best.collected = true;
        void pushHubUpgrade(best);
      };

      const pushHubUpgrade = async (hubResult) => {
        if (!responded || !hubResult?.res) return false;
        const providerId = hubResult.providerId || 'lrchub';
        // LRCHub には 2 つの引き方がある。動画 ID で引く本来の経路(手動で
        // 登録した歌詞はここに来る)と、曲名で探す検索。検索は推測なので、
        // 当たる曲が違うことがある。LRCHub が混んで本来の経路が遅れた回に
        // 検索が先に出し、後から本来の経路が正しい歌詞を返しても、品質が
        // 同じだと替えずに外れを出し続けていた(実機: 星野源のライブ映像で
        // 別の曲の歌詞。手動登録した歌詞が出ない)。
        //  ・検索で出した歌詞と中身の違う歌詞が本来の経路から届いたら、
        //    品質が下がっても訂正として替える
        //  ・本来の経路で出した歌詞を、中身の違う検索結果では替えない
        const disagreesWithShown = () => !!(
          deliveredResult?.res?.lyrics && typeof hubResult.res.lyrics === 'string' &&
          Agreement.lyricsAgreement(hubResult.res.lyrics, deliveredResult.res.lyrics) < Agreement.LYRICS_AGREE_MIN
        );
        if (providerId === 'lrchub' && deliveredProviderId === 'lrchub') {
          const fromVideo = VIDEO_KEYED_HUB_SOURCES.has(hubResult.source);
          const shownFromVideo = VIDEO_KEYED_HUB_SOURCES.has(deliveredResult?.source);
          if (fromVideo && deliveredResult?.source === HUB_TITLE_SEARCH_SOURCE && disagreesWithShown()) {
            const replaces = deliveredProviderId;
            deliveredHubQuality = getHubLyricsQuality(hubResult.res);
            deliveredResult = hubResult;
            YTMLog.log(`[BG] 曲名検索で出した歌詞を、動画に結び付いた ${hubResult.source} の歌詞に替える`);
            return pushLyricsUpdate({
              ...buildHubLyricsPayload(hubResult.res, hubResult.source, providerId),
              agreement: verdictOf(hubResult) || 'unknown',
              correction: true,
              replaces,
            });
          }
          if (hubResult.source === HUB_TITLE_SEARCH_SOURCE && shownFromVideo && disagreesWithShown()) return false;
        }
        // LRCHub の歌詞には翻訳・解説・候補が同じタイムラインで乗っている。
        // 外部プロバイダーが単語同期という一点だけで上書きすると、
        // 表示済みの翻訳ごと消えてしまうので、ふだんは差し替えない。
        // (逆向き、LRCHub が外部を上書きするのは品質が上がるので許す)
        //
        // 「単語同期 優先」を選んだ回だけはこれを解く。翻訳より単語同期を
        // 採るという意思表示なので、行同期止まりの LRCHub は譲る。
        // 単語同期を持ってこない相手には、この回でも譲らない。
        if (providerId !== 'lrchub' && deliveredProviderId === 'lrchub') {
          const bringsWordSync = preferWordSync && hasCharacterSyncedLines(hubResult.res?.dynamicLines);
          if (!bringsWordSync) return false;
        }
        const quality = getHubLyricsQuality(hubResult.res);
        if (quality <= deliveredHubQuality) return false;
        // 他の取得元と合わないものへは替えない
        const verdict = verdictOf(hubResult);
        if (verdict === 'contradicted') return false;
        // 表示中の歌詞と中身が違うものへは、他の取得元が裏付けている時か、
        // 表示中より信頼できる取得元の時しか替えない(品質が上がるだけの
        // 差し替えのはずが、確かでない別の曲に入れ替わるのを防ぐ)
        if (
          verdict !== 'confirmed' && deliveredResult?.res?.lyrics &&
          Agreement.lyricsTrustRank(providerId) > Agreement.lyricsTrustRank(deliveredResult.providerId) &&
          Agreement.lyricsAgreement(hubResult.res.lyrics, deliveredResult.res.lyrics) < Agreement.LYRICS_AGREE_MIN
        ) return false;
        if (preferWordSync && !hubResult.collected && quality >= 4 && deliveredHubQuality < 4) {
          if (!wordSyncPending.includes(hubResult)) wordSyncPending.push(hubResult);
          if (!wordSyncFlushTimer) wordSyncFlushTimer = API.delay(WORDSYNC_COLLECT_MS).then(flushWordSync);
          return false;
        }
        deliveredHubQuality = quality;
        deliveredProviderId = providerId;
        deliveredResult = hubResult;
        YTMLog.log(`[BG] Upgrading lyrics quality to ${hubResult.source} (${quality})`);
        return pushLyricsUpdate({ ...buildHubLyricsPayload(hubResult.res, hubResult.source, providerId), agreement: verdict || 'unknown' });
      };

      const pushBestResolvedHubUpgrade = () => {
        const best = resolvedHubResults
          .slice()
          .sort((a, b) => getHubLyricsQuality(b.res) - getHubLyricsQuality(a.res))[0];
        if (best) void pushHubUpgrade(best);
      };

      const makeRawHubTask = (source, promise, warningLabel, providerId = 'lrchub') => (
        Promise.resolve(promise)
          .then(res => asHubResult(source, res, providerId))
          .then(result => {
            if (result) {
              resolvedHubResults.push(result);
              noteResult(result);
              offerProviderCandidate(providerId, result.res);
              if (responded) void pushHubUpgrade(result);
            }
            return result;
          })
          .catch(e => {
            console.warn(`[BG] ${warningLabel} fetch failed:`, e);
            return null;
          })
      );

      // Keep the raw promise as well as the timeout-limited selection promise.
      // The raw promise can still upgrade a temporary LrcLib result later.
      const primaryRawTask = lrchubOn
        ? makeRawHubTask(
          'LRCHub',
          API.fetchFromLrchub({
            track,
            artist,
            youtube_url: lookupUrl,
            video_id: lookupVideoId,
            offset_ms,
            translate_to,
            translation_source,
            method: lrchubLyricsMethod,
          }),
          'LRCHub'
        )
        : Promise.resolve(null);
      const primarySelectionTask = API.withTimeout(primaryRawTask, 8000, 'lrchub')
        .catch(e => {
          console.warn('[BG] LRCHub selection timed out:', e);
          return null;
        });

      // LrcLib は LRCHub と同時に走らせる。
      //
      // 以前はこの下の「LRCHub を待つ 1.5 秒」が明けてから作っていたので、
      // LRCHub が遅い回はその 1.5 秒ぶん、まるごと何も始まっていなかった。
      // 行同期止まりの歌詞しか無い曲ほどこの待ちが体感に直結する。
      // LrcLib は公開 API で、無料枠の共用サーバー(SimpMusic / LyricsPlus)を
      // 気遣う理由もないため、常時並走させてよい。
      let lrcLibSettled = null;
      const lrcLibTask = (use_lrclib && sourceOn('lrclib'))
        ? API.withTimeout(API.fetchFromLrcLib(track, artist, duration_sec), 8000, 'lrclib')
          // 他の取得元と同じ関門を通す(別の曲のデータをここでも弾く)
          .then(res => asHubResult('LrcLib', res, 'lrclib'))
          .then(result => {
            if (result) {
              lrcLibSettled = result;
              noteResult(result);
              offerProviderCandidate('lrclib', result.res);
            }
            return result;
          })
          .catch(e => {
            console.warn('[BG] LrcLib fetch failed:', e);
            return null;
          })
        : Promise.resolve(null);

      // SimpMusic も LRCHub と同時に走らせる。
      //
      // 以前は下の「LRCHub を待つ 1.5 秒」が明けてから作っていた。実測では
      // LRCHub の応答は 212ms 〜 4933ms とばらつきが大きく、4曲中2曲で
      // 1.5 秒を超えた。その回、SimpMusic は 336〜683ms で答えられたのに
      // 1.5 秒待たされていた。
      //
      // videoId ひとつの単純な GET で、しかもキャッシュがあるので1曲につき
      // 生涯1回しか叩かない。文字同期の主力でもあるので常時並走させる。
      // LyricsPlus はこの下のまま据え置く。track/artist/album/duration の
      // 検索をミラー横断で投げる重い経路で、実測でも3ミラーとも歌詞を
      // 返さない(502 / 429 / 402)。毎曲叩いても得るものが無い。
      let simpMusicSettled = null;
      const simpMusicRawTask = (sourceOn('simpmusic') && typeof API.fetchFromSimpMusic === 'function' && lookupVideoId)
        ? makeRawHubTask(
          'SimpMusic',
          API.fetchFromSimpMusic({ video_id: lookupVideoId }),
          'SimpMusic',
          'simpmusic',
        ).then(result => {
          if (result) simpMusicSettled = result;
          return result;
        })
        : null;
      const simpMusicSelectionTask = simpMusicRawTask
        ? API.withTimeout(simpMusicRawTask, 6000, 'simpmusic').catch(() => null)
        : null;

      // ── 単語同期を返せる取得元 ────────────────────────────
      //   LyricsPlus : Apple Music などを束ねたサーバー(無料枠)
      //   AMLL       : GitHub の静的ファイル。落ちない・速い・質が最上
      //   NetEase    : yrc(単語)があれば単語、無ければ行同期
      //   KuGou      : krc(単語)。中国系カタログと日本語曲に強い
      //   BuaaaBot   : 独自に起こした単語同期。日本語曲が中心で収録は少ない。
      //                videoId でも引け、カバー動画はカバーの時刻で返る
      // AMLL / NetEase / KuGou は「曲名で検索して1件選ぶ」経路なので、
      // extra-providers 側で曲名・アーティスト・長さに点数を付けて
      // 確からしいものだけ返している。BuaaaBot も videoId で外れた時は
      // 曲名検索になるので、同じように突き合わせてから返す。
      //
      // 起こすのを遅らせているのは、LRCHub が答えられる大半の曲で
      // よそのサーバーを無駄に叩かないため。ふだんは下のフォールバック段で
      // 初めて起こす。ただし「単語同期 優先」の時だけは、LRCHub が速かった
      // 回でも起こす(行同期で確定させず、単語同期が届いたら差し替えるため)。
      const extraArgs = { track, artist, album, durationSec: duration_sec, video_id: lookupVideoId };
      const extraTask = (fn, label, providerId) => (
        (Extra.EXTRA_PROVIDERS_ENABLED && typeof fn === 'function')
          ? makeRawHubTask(label, fn(extraArgs), label, providerId)
          : null
      );
      const withLimit = (task, ms, label) => (
        task ? API.withTimeout(task, ms, label).catch(() => null) : null
      );

      let richProviders = null;
      const startRichProviders = () => {
        if (richProviders) return richProviders;
        const raw = [
          (sourceOn('lyricsplus') && typeof API.fetchFromLyricsPlus === 'function')
            ? makeRawHubTask(
              'LyricsPlus',
              API.fetchFromLyricsPlus({ track, artist, album, duration: duration_sec }),
              'LyricsPlus',
              'lyricsplus',
            )
            : null,
          extraTask(Extra.fetchFromAmll, 'AMLL', 'amll'),
          extraTask(Extra.fetchFromNetease, 'NetEase', 'netease'),
          extraTask(Extra.fetchFromKugou, 'KuGou', 'kugou'),
          extraTask(Extra.fetchFromBuaaa, 'BuaaaBot', 'buaaa'),
        ];
        const limits = [8000, 6000, 7000, 7000, 6000];
        const labels = ['lyricsplus', 'amll', 'netease', 'kugou', 'buaaa'];
        richProviders = {
          raw,
          selections: raw.map((task, i) => withLimit(task, limits[i], labels[i])),
        };
        return richProviders;
      };

      // LiriQo だけは別扱い。1曲あたり 500KB 前後・応答も数秒かかるので、
      // ここまでで単語同期が1つも手に入らなかった回にだけ起こす。
      let liriqoStarted = null;
      const startLiriqo = () => {
        if (!liriqoStarted && Extra.EXTRA_PROVIDERS_ENABLED && typeof Extra.fetchFromLiriqo === 'function') {
          liriqoStarted = makeRawHubTask('LiriQo', Extra.fetchFromLiriqo(extraArgs), 'LiriQo', 'liriqo');
        }
        return liriqoStarted;
      };

      const earlyMarker = {};
      const earlyPrimary = await Promise.race([
        primarySelectionTask,
        API.delay(EARLY_HUB_WAIT_MS).then(() => earlyMarker),
      ]);
      if (earlyPrimary && earlyPrimary !== earlyMarker) {
        // 比べる相手がまだ無ければ、少しだけ待つ(外れを出してから替えるより良い)
        // 同時に走っている取得元が全部答え終えていれば、それ以上は待たない。
        if (pool.size + voters.length < 2) {
          await Promise.race([
            waitForOpinion(FIRST_OPINION_WAIT_MS),
            Promise.allSettled([lrcLibTask, simpMusicRawTask].filter(Boolean)),
          ]);
        }
        await deliverChecked(earlyPrimary);
        pushBestResolvedHubUpgrade();
        // DynamicLRC (4) が先着していても、最上位の srv3 (5) を検索する。
        if (getHubLyricsQuality(earlyPrimary.res) < 5) {
          const earlySearchTask = makeRawHubTask(
            HUB_TITLE_SEARCH_SOURCE,
            API.fetchFromLrchubSearch({ track, artist, artist_alt, title_full, limit: 30, translate_to, video_id: lookupVideoId }),
            'LRCHub search'
          );
          await API.withTimeout(earlySearchTask, 5000, 'lrchub search upgrade').catch(() => null);
        }
        // 「単語同期 優先」で、出したものが行同期止まりならここで諦めない。
        // ふだんはこの回で打ち切っている(LRCHub が速く答えた曲で、よその
        // サーバーを叩く理由が無いため)が、この設定の時だけは単語同期を
        // 探しにいく。届いたぶんは pushHubUpgrade が差し替える。
        if (preferWordSync && deliveredHubQuality < 4) {
          await Promise.allSettled([
            ...startRichProviders().selections,
            simpMusicSelectionTask,
          ].filter(Boolean));
          // それでも単語同期が1つも無ければ、重い LiriQo まで手を伸ばす。
          // fetch 自体には期限が無いので、待ちには必ず上限を付ける。
          // 集めている途中の単語同期があれば、それを待つ(選ぶ前に重い LiriQo を起こさない)
          if (wordSyncFlushTimer) await wordSyncFlushTimer;
          if (deliveredHubQuality < 4) await withLimit(startLiriqo(), 15000, 'liriqo');
        }
        return;
      }

      // 先出しするのは LRCHub が「遅かった」回だけ。
      // 「持っていない」と即答した回まで先出しすると、そのあと来る
      // 単語同期(SimpMusic / LyricsPlus)に勝たせる機会を奪ってしまう。
      // その判定は下のフォールバック段に任せる。
      //
      // 遅かった回にかぎっては、もう手元にある歌詞を出してしまう。
      // 白紙のまま数秒待たせるよりは早く出す方がいい。
      // あとから LRCHub が届けば、品質を見て差し替わる。
      //
      // 出す順は「文字同期を持っている SimpMusic」→「LrcLib」。
      // SimpMusic を同時に走らせるようにしたので、遅い回ではたいてい
      // 先に届いている。ここで行同期の LrcLib を挟むと、すぐ下の
      // フォールバック段が SimpMusic を選び直して一瞬ちらつく。
      // 文字同期を要求するのは下の段と同じ基準。上流の取り込みが崩れた
      // レコードに「速かった」というだけで勝たせないため。
      if (earlyPrimary === earlyMarker) {
        if (simpMusicSettled && hasCharacterSyncedLines(simpMusicSettled.res?.dynamicLines)) {
          YTMLog.log('[BG] Won temporarily: SimpMusic (LRCHub slow)');
          deliver(simpMusicSettled);
        } else if (lrcLibSettled) {
          YTMLog.log('[BG] Won temporarily: LrcLib (LRCHub slow)');
          deliver(lrcLibSettled);
        }
      }

      const searchRawTask = lrchubOn
        ? makeRawHubTask(
          HUB_TITLE_SEARCH_SOURCE,
          API.fetchFromLrchubSearch({ track, artist, artist_alt, title_full, limit: 30, translate_to, video_id: lookupVideoId }),
          'LRCHub search'
        )
        : null;
      // 引き直しは primary が答えられなかった時だけ。
      // 以前は同じパラメータの2本を必ず同時に投げていたので、LRCHub が
      // 素直に答えた曲でも1曲あたり常に2往復していた。
      let retryStarted = null;
      const startRetry = () => {
        if (!lrchubOn) return null;
        if (!retryStarted) {
          retryStarted = makeRawHubTask(
            'LRCHub retry',
            API.fetchFromLrchub({
              track,
              artist,
              youtube_url: lookupUrl,
              video_id: lookupVideoId,
              offset_ms,
              translate_to,
              translation_source,
              method: lrchubLyricsMethod,
            }),
            'LRCHub retry'
          );
        }
        return retryStarted;
      };
      // 関門は primarySelectionTask(8秒で必ず決着する)側に置く。生の
      // primaryRawTask を待つと、LRCHub が黙り込んだ時に引き直しも
      // それを待つ形になり、下の allSettled がいつまでも返らない。
      const searchSelectionTask = searchRawTask
        ? API.withTimeout(searchRawTask, 5000, 'lrchub search').catch(() => null)
        : null;
      const retryRawTask = primarySelectionTask.then(result => (result ? null : startRetry()));
      const retrySelectionTask = primarySelectionTask.then(result => (
        (result || !lrchubOn) ? null : API.withTimeout(startRetry(), 5000, 'lrchub retry').catch(() => null)
      ));
      const hubSelectionTask = firstValidResult([
        primarySelectionTask,
        searchSelectionTask,
        retrySelectionTask,
      ]);
      const rawHubTask = firstValidResult([
        primaryRawTask,
        searchRawTask,
        retryRawTask,
      ]);
      // ── 追加プロバイダー ──────────────────────────────────
      // LRCHub がここまでで歌詞を返せなかった曲だけが対象。
      // (「単語同期 優先」の回は、上の早出しのところで既に起きている)
      const { raw: richRawTasks, selections: richSelectionTasks } = startRichProviders();

      // フォールバック段の中では、単語同期を返せる取得元を LrcLib より優先したい。
      // ただ firstValidResult は純粋な早い者勝ちなので、ほぼ同時に返ると
      // 行同期止まりの LrcLib が勝ってしまう。LrcLib が先着した時だけ、
      // 短い猶予を置いて2つを待つ(LRCHub 対 LrcLib と同じ考え方)。
      const richFallbackTask = firstValidResult([
        simpMusicSelectionTask,
        ...richSelectionTasks,
      ]);
      const fallbackSelectionTask = (async () => {
        const first = await firstValidResult([richFallbackTask, lrcLibTask]);
        if (!first) return first;

        if (first.providerId !== 'lrclib') {
          // 上の2つを LrcLib より前に置いている理由は「単語同期を返せるから」
          // の一点なので、行同期しか持って来なかった回はその理由が消える。
          // 実際、上流の取り込みが崩れて全行が1文字ずつ欠けたまま配信されて
          // いる曲があり、それでも「速かった」というだけで勝っていた。
          // 同じ品質どうしなら、より枯れている LrcLib に譲る。
          // 待つのは表示前の一度きり。画面に出たあとで差し替えはしない。
          if (hasCharacterSyncedLines(first.res?.dynamicLines)) return first;
          const lrcLibMarker = {};
          const lrcLib = await Promise.race([
            lrcLibTask,
            API.delay(FALLBACK_GRACE_MS).then(() => lrcLibMarker),
          ]);
          return (lrcLib && lrcLib !== lrcLibMarker) ? lrcLib : first;
        }

        const richMarker = {};
        const rich = await Promise.race([
          richFallbackTask,
          API.delay(FALLBACK_GRACE_MS).then(() => richMarker),
        ]);
        // ここでも条件は同じ。単語同期を持って来た時だけ LrcLib を追い越せる。
        if (rich && rich !== richMarker && hasCharacterSyncedLines(rich.res?.dynamicLines)) {
          return rich;
        }
        return first;
      })();

      const winner = await firstValidResult([hubSelectionTask, fallbackSelectionTask]);
      if (winner && winner.providerId === 'lrchub') {
        deliver(winner);
        pushBestResolvedHubUpgrade();
        await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
        return;
      }

      if (winner) {
        // すでに LrcLib を先に出してある回は、ここで待つ意味が無い。
        // 表示は済んでいるので、あとは pushHubUpgrade が差し替える。
        // ここで待つと「出ているのに待たされる」時間が積み上がるだけ。
        if (!responded) {
          const graceMarker = {};
          const graceHub = await Promise.race([
            hubSelectionTask,
            API.delay(POST_FALLBACK_GRACE_MS).then(() => graceMarker),
          ]);
          if (graceHub && graceHub !== graceMarker) {
            deliver(graceHub);
            pushBestResolvedHubUpgrade();
            await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
            return;
          }

          YTMLog.log(`[BG] Won temporarily: ${winner.source}`);
          // LrcLib は行同期止まりなので、あとから LRCHub が届いたら譲る前提の
          // 「暫定表示」として扱う(fallbackUsed = true。deliver の中で分ける)。
          deliver(winner);
        }
        pushBestResolvedHubUpgrade();

        // 出せたのが行同期止まりなら、重い LiriQo を起こす価値がある。
        // 表示は済んでいるので、届いたら pushHubUpgrade が差し替える。
        if (!hasCharacterSyncedLines(winner.res?.dynamicLines)) startLiriqo();

        const lateHub = await rawHubTask;
        if (lateHub) {
          YTMLog.log(`[BG] Upgrading ${winner.source} lyrics to ${lateHub.source}`);
          await pushHubUpgrade(lateHub);
        }
        if (liriqoStarted) await liriqoStarted;
        return;
      }

      YTMLog.log('[BG] No lyrics found');
      sendOnce({
        success: false,
        lyrics: '',
        ...requestIdentity,
      });

      const lateHub = await firstValidResult([
        rawHubTask,
        simpMusicRawTask,
        ...richRawTasks,
        // 1件も見つからなかった回は、重さを気にする理由がもう無い。
        // それでも待ちは切る(fetch は放っておくと戻ってこない)。
        withLimit(startLiriqo(), 15000, 'liriqo'),
      ]);
      if (lateHub) {
        await pushHubUpgrade(lateHub);
      }
    })().catch((error) => {
      console.error('[BG] GET_LYRICS failed unexpectedly:', error);
      sendOnce({
        success: false,
        lyrics: '',
        request_id: request_id || null,
        track_key: track_key || null,
        track: track || '',
        artist: artist || '',
        video_id: resolvedVideoId || null,
      });
    });
    return true;
  }

  // 取得元をまたいだ候補のオンデマンド取得。
  //
  // GET_LYRICS は LRCHub が答えた時点で他へ問い合わせずに切り上げる
  // (答えられる大半の曲で無料の共用サーバーを無駄に叩かないため)。
  // その代わり、表示中の歌詞が曲に合っていない時に乗り換え先が
  // 1件も無い状態になる。ユーザーがメニューから明示的に頼んだ時だけ、
  // まだ聞いていない取得元を叩きにいく。自動では走らせない。
  if (req.type === 'FIND_ALTERNATE_LYRICS') {
    const {
      track,
      artist,
      album,
      duration_sec,
      youtube_url,
      video_id,
      exclude,
    } = req.payload || {};
    const alternateVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
    const skip = new Set(
      (Array.isArray(exclude) ? exclude : [])
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );

    (async () => {
      // 設定でオフにされた標準の取得元は、ここでも聞かない
      for (const providerId of await Sources.loadDisabledSources()) skip.add(providerId);

      const tasks = [];
      const collect = (providerId, makePromise, label) => {
        if (skip.has(providerId)) return;
        tasks.push(
          Promise.resolve()
            .then(makePromise)
            .then(res => buildProviderCandidate(providerId, res))
            .catch(e => {
              console.warn(`[BG] ${label} alternate fetch failed:`, e);
              return null;
            })
        );
      };

      collect('lrchub', () => API.withTimeout(
        API.fetchFromLrchub({
          track,
          artist,
          youtube_url,
          video_id: alternateVideoId,
          method: 'POST',
        }),
        8000,
        'lrchub alternate'
      ), 'LRCHub');

      if (alternateVideoId && typeof API.fetchFromSimpMusic === 'function') {
        collect('simpmusic', () => API.withTimeout(
          API.fetchFromSimpMusic({ video_id: alternateVideoId }),
          8000,
          'simpmusic alternate'
        ), 'SimpMusic');
      }

      if (typeof API.fetchFromLyricsPlus === 'function') {
        collect('lyricsplus', () => API.withTimeout(
          API.fetchFromLyricsPlus({ track, artist, album, duration: duration_sec }),
          10000,
          'lyricsplus alternate'
        ), 'LyricsPlus');
      }

      collect('lrclib', () => API.withTimeout(
        API.fetchFromLrcLib(track, artist, duration_sec),
        8000,
        'lrclib alternate'
      ), 'LrcLib');

      // 追加プロバイダー。ここはユーザーが明示的に「別の歌詞を探す」を
      // 押した場面なので、重い LiriQo も含めて全部聞きにいく。
      if (Extra.EXTRA_PROVIDERS_ENABLED) {
        const alternateArgs = {
          track,
          artist,
          album,
          durationSec: duration_sec,
          video_id: alternateVideoId,
        };
        const extras = [
          ['amll', Extra.fetchFromAmll, 'AMLL', 8000],
          ['netease', Extra.fetchFromNetease, 'NetEase', 8000],
          ['kugou', Extra.fetchFromKugou, 'KuGou', 8000],
          ['buaaa', Extra.fetchFromBuaaa, 'BuaaaBot', 8000],
          ['liriqo', Extra.fetchFromLiriqo, 'LiriQo', 15000],
        ];
        for (const [providerId, fn, label, timeout] of extras) {
          if (typeof fn !== 'function') continue;
          collect(providerId, () => API.withTimeout(
            fn(alternateArgs),
            timeout,
            `${providerId} alternate`
          ), label);
        }
      }

      const candidates = (await Promise.all(tasks)).filter(Boolean);
      YTMLog.log('[BG] FIND_ALTERNATE_LYRICS ->', candidates.map(c => c.lyricsSource));
      sendResponse({ success: true, candidates });
    })();
    return true;
  }

  if (req.type === 'GET_CANDIDATE_LYRICS') {
    const { candidate, translate_to, video_id, youtube_url } = req.payload || {};

    (async () => {
      try {
        const resolvedCandidateVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
        const candRes = await API.fetchLrchubCandidateLyrics(candidate, translate_to, resolvedCandidateVideoId);
        if (candRes && candRes.lyrics && candRes.lyrics.trim()) {
          sendResponse({
            success: true,
            record_id: getLrchubRecordId(candRes) || getLrchubRecordId(candidate),
            lyrics: candRes.lyrics,
            lyricsComplete: true,
            animated_lyrics: candRes.animated_lyrics || candRes.timedtext || candRes.timed_text || null,
            dynamicLines: candRes.dynamicLines || null,
            offset_ms: Number.isFinite(Number(candRes.offset_ms)) ? Number(candRes.offset_ms) : 0,
            lyricsSource: 'lrchub',
            fallbackUsed: false,
            meaningData: candRes.meaningData || API.normalizeLrchubMeaningPayload(candRes),
            songSummary: candRes.songSummary || candRes.song_summary || candRes.final_summary || null,
            comments: Array.isArray(candRes.comments) ? candRes.comments : [],
            rating: candRes.rating || null,
            translations: candRes.translations || null,
            lrcMap: {
              ...API.normalizeLrchubTranslations(candRes.lrc_map),
              ...API.normalizeLrchubTranslations(candRes.translations),
              ...API.normalizeLrchubTranslations(candRes.lrcMap)
            },
            has_synced: /\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(candRes.lyrics)
          });
          return;
        }
        sendResponse({ success: false, lyrics: '' });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'GET_TRANSLATION') {
    const payload = req.payload || {};
    const { track, artist, youtube_url, video_id, lang, langs, translation_source } = payload;

    (async () => {
      const vid = video_id || API.extractVideoIdFromUrl(youtube_url);
      const reqLangs = Array.isArray(langs) && langs.length ? langs : (lang ? [lang] : []);
      const translateTo = reqLangs.map(API.toLrchubTranslateLang).filter(Boolean);
      
      try {
        let lrcMap = {};
        if (translateTo.length) {
          const hubRes = await API.withTimeout(
            API.fetchFromLrchub({
              track,
              artist,
              youtube_url,
              video_id: video_id || vid,
              translate_to: translateTo,
              translation_source,
              method: 'GET'
            }),
            20000,
            'lrchub translation'
          );
          lrcMap = {
            ...API.normalizeLrchubTranslations(hubRes?.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes?.translations),
            ...API.normalizeLrchubTranslations(hubRes?.lrcMap)
          };
        }

        if (Object.keys(lrcMap).length) {
          sendResponse({
            success: true,
            lrcMap,
            missing: reqLangs.filter(l => !lrcMap[API.toUiLangKey(l)])
          });
          return;
        }

        sendResponse({
          success: true,
          lrcMap: {},
          missing: reqLangs
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

});
