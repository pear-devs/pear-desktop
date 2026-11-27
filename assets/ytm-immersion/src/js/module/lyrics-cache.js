/* globals chrome, YTMLog */

// ── 歌詞キャッシュの後始末 ──────────────────────────────────
//
// 歌詞は「曲名///アーティスト」をキーに chrome.storage.local へ溜まる。
// 消す手段は設定の「全削除」しか無いので、聴いた曲のぶんだけ増え続ける。
// しかも 1 件の中に候補一覧(最大 30 件ぶんの歌詞本文)まで入っていた。
//
// ここでは 2 つだけやる:
//   1. 保存する候補一覧から、引き直せる歌詞本文を落とす
//   2. 起動時に 1 回、古いものから上限まで間引く
//
// 本人が決めたもの(手動アップロード / 候補の選択)は間引かない。
// 取り直せないので、消すと利用者の作業が消える。

const LyricsCache = (() => {
  // 1 件あたり数 KB〜数十 KB。1000 件で概ね数十 MB に収まる。
  const MAX_ENTRIES = 1000;

  // LRCHub のレコードを指しているか。指していれば GET_CANDIDATE_LYRICS で
  // 引き直せるので、歌詞本文を保存しなくてよい。
  const hasRecordReference = (cand) => !!(
    cand?.record_id || cand?.recordId || cand?.candidate_id || cand?.lyrics_id ||
    cand?.lyric_id || cand?.record?.id || cand?.record?.record_id || cand?.record?.recordId
  );

  // 保存用に候補一覧を軽くする。
  // 引き直せない候補(YouTube Music / SimpMusic / LyricsPlus など、レコードを
  // 持たないもの)の本文は残す。落とすと選び直せなくなる。
  const stripCandidateLyrics = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return candidates;
    return candidates.map(cand => {
      if (!cand || typeof cand !== 'object') return cand;
      if (!hasRecordReference(cand)) return cand;
      const { lyrics, animated_lyrics, dynamicLines, ...rest } = cand;
      return {
        ...rest,
        // 次に開いた時、本文が要ることを ensureCandidateLyricsLoaded に伝える
        lyricsComplete: false,
      };
    });
  };

  const isUserOwned = (record) => !!(
    record && typeof record === 'object' &&
    (record.manualLyrics || record.manualChoice)
  );

  const savedAt = (record) => {
    const n = Number(record && typeof record === 'object' ? record.fetchedAt : 0);
    return Number.isFinite(n) ? n : 0;
  };

  // 起動時に 1 回だけ。古い順に間引いて上限に収める。
  const prune = () => new Promise((resolve) => {
    const api = chrome?.storage?.local;
    if (!api) { resolve(0); return; }
    api.get(null, (items) => {
      if (chrome.runtime?.lastError) { resolve(0); return; }
      const entries = Object.keys(items || {})
        .filter(key => key.includes('///'))
        .map(key => ({ key, record: items[key] }))
        .filter(entry => !isUserOwned(entry.record));

      if (entries.length <= MAX_ENTRIES) { resolve(0); return; }

      entries.sort((a, b) => savedAt(a.record) - savedAt(b.record));
      const doomed = entries.slice(0, entries.length - MAX_ENTRIES).map(e => e.key);
      api.remove(doomed, () => {
        if (typeof YTMLog !== 'undefined') {
          YTMLog.log(`[Cache] 歌詞キャッシュを ${doomed.length} 件間引きました`);
        }
        resolve(doomed.length);
      });
    });
  });

  return { MAX_ENTRIES, stripCandidateLyrics, isUserOwned, prune };
})();
