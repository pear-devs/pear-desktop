// Chrome に組み込まれた翻訳(Translator API / LanguageDetector API)。
//
// 共有翻訳も DeepL のキーも無い時の受け皿。訳はパソコンの中で作るので、
// API キーも料金も要らず、歌詞が外へ送られることもない。パソコン版の
// Chrome 138 以降だけが持つ API なので、無い環境では何もしない(今まで通り)。
//
// Chrome 155 での実測(2026-10):
//  - 言語データは「英語との組」ごと。en_ja 76MB・en_ko 75MB と共通部 21MB。
//    韓国語→日本語は英語を経由するので、en_ko と en_ja の両方が落ちる。
//  - 初めての組み合わせは、利用者の操作(クリック)の中でしか作れない
//    (NotAllowedError)。落とし済みでも、このサイトで初めて作るまでは
//    downloadable と返る(どの言語を入れているかを隠すため)。
//  - 複数行をまとめて渡すと改行が消えて 1 文に繋がる。1 行ずつ訳す
//    (1 行 40ms ほど、1 曲で 2〜3 秒)。
//  - LanguageDetector は最初から available で、操作なしで作れた。
//    「Oh yeah」くらいの短い行でも en 0.88 と出る。
const BuiltinTranslate = (() => {
  const translators = new Map();   // 'ko>ja' -> Promise<Translator>
  const downloading = new Map();   // 'ko>ja' -> 0..1
  const listeners = new Set();
  const results = new Map();       // 歌詞と言語ごとの訳(新しい 8 曲分)
  const inflight = new Map();
  const RESULTS_MAX = 8;
  let detectorPromise = null;

  const isSupported = () => typeof globalThis.Translator === 'function';

  // API に渡す言語コード。訳す先の 'zh' は簡体字。
  const apiLang = (code) => {
    const c = String(code || '').trim();
    if (/^zh[-_](hant|tw|hk)/i.test(c)) return 'zh-Hant';
    if (/^zh/i.test(c)) return 'zh';
    return c.toLowerCase().split(/[-_]/)[0];
  };
  const baseLang = (code) => String(code || '').toLowerCase().split(/[-_]/)[0];
  const pairKey = (from, to) => `${from}>${to}`;

  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* 聞き手の失敗は無視 */ } });

  const getDetector = () => {
    if (typeof globalThis.LanguageDetector !== 'function') return Promise.resolve(null);
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const state = await LanguageDetector.availability();
        // 判定のデータまで落とさせることはしない。無ければ字の種類だけで決める。
        if (state !== 'available' && !navigator.userActivation?.isActive) return null;
        return LanguageDetector.create();
      })().catch(() => null);
      detectorPromise.then((d) => { if (!d) detectorPromise = null; });
    }
    return detectorPromise;
  };

  const HAS_KANA = /[぀-ヿ]/;
  const HAS_HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
  const HAS_HAN = /[一-鿿]/;
  const HAS_LETTER = /\p{L}/u;

  // 行ごとの言語。字の種類で決まるもの(かな・ハングル)は判定に頼らない。
  // 漢字だけの行は、曲のどこかにかながあれば日本語、無ければ中国語とみる。
  const detectLines = async (texts) => {
    const songHasKana = texts.some((s) => HAS_KANA.test(s));
    const detector = await getDetector();
    const out = [];
    for (const raw of texts) {
      const s = String(raw || '').trim();
      if (!s || !HAS_LETTER.test(s)) { out.push(null); continue; }
      if (HAS_KANA.test(s)) { out.push('ja'); continue; }
      if (HAS_HANGUL.test(s)) { out.push('ko'); continue; }
      if (HAS_HAN.test(s) && songHasKana) { out.push('ja'); continue; }
      let lang = HAS_HAN.test(s) ? 'zh' : 'en';
      if (detector) {
        try {
          const top = (await detector.detect(s))[0];
          if (top && top.detectedLanguage !== 'und' && top.confidence >= 0.5) lang = top.detectedLanguage;
        } catch (e) { /* 判定できなければ字の種類で決めた方を使う */ }
      }
      out.push(apiLang(lang));
    }
    return out;
  };

  // 作れたものだけ返す。初めての組み合わせで操作の外なら null(後で download)。
  const getTranslator = async (from, to) => {
    const key = pairKey(from, to);
    if (translators.has(key)) return translators.get(key);
    const state = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
    if (state === 'unavailable') return 'unavailable';
    if (state !== 'available' && !navigator.userActivation?.isActive) return null;
    const p = Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          downloading.set(key, e.loaded);
          emit();
        });
      },
    });
    translators.set(key, p);
    p.then(() => {
      // 使えるようになった。この組み合わせが無くて訳せなかった曲を訳し直せるようにする
      // (落とし済みだと進み具合が出ないまま終わるので、ダウンロードの有無で分けない)。
      downloading.delete(key);
      // 訳し直すまでは古い訳を出しておく(消すと訳が一度消えてから出る)
      results.forEach((r) => { if (r.missing.length) r.stale = true; });
      emit();
    }, () => {
      translators.delete(key);
      downloading.delete(key);
      emit();
    });
    return p;
  };

  const resultKey = (texts, to) => `${apiLang(to)}\n${texts.join('\n')}`;

  const remember = (key, value) => {
    if (results.size >= RESULTS_MAX) results.delete(results.keys().next().value);
    results.set(key, value);
  };

  // 訳した結果(訳さない行は null)。言語データが無い組み合わせは missing に入れて返す。
  const translateLines = (texts, to) => {
    const key = resultKey(texts, to);
    if (results.has(key) && !results.get(key).stale) return Promise.resolve(results.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const target = apiLang(to);
    const job = (async () => {
      const langs = await detectLines(texts);
      const lines = new Array(texts.length).fill(null);
      const missing = [];
      const unusable = new Set();
      for (let i = 0; i < texts.length; i++) {
        const from = langs[i];
        if (!from || baseLang(from) === baseLang(target)) continue;
        const pk = pairKey(from, target);
        if (unusable.has(pk)) continue;
        let tr;
        try { tr = await getTranslator(from, target); } catch (e) { tr = null; }
        if (!tr || tr === 'unavailable') {
          unusable.add(pk);
          if (!tr && !missing.some((m) => pairKey(m.from, m.to) === pk)) missing.push({ from, to: target });
          continue;
        }
        try { lines[i] = await tr.translate(String(texts[i]).trim()); } catch (e) { /* その行は原文のまま */ }
      }
      const value = { lines, missing };
      // 足りない組み合わせがあった結果も覚える(落とし終わると stale になり、訳し直す)
      results.delete(key);
      remember(key, value);
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };

  // クリックの中で呼ぶ。足りない組み合わせを落とし始める。
  const download = (pairs) => Promise.all(
    pairs.map(({ from, to }) => getTranslator(from, to).catch(() => null))
  );

  // この歌詞を訳す先へ訳すのに、まだ作れていない組み合わせ(クリックで落とす分)
  const missingPairs = async (texts, to) => {
    const target = apiLang(to);
    const langs = await detectLines(texts);
    const seen = new Set();
    const out = [];
    for (const from of langs) {
      if (!from || baseLang(from) === baseLang(target)) continue;
      const pk = pairKey(from, target);
      if (seen.has(pk) || translators.has(pk)) continue;
      seen.add(pk);
      out.push({ from, to: target });
    }
    return out;
  };

  // ダウンロード中の進み具合(0..1)。無ければ null。
  const progress = () => {
    if (!downloading.size) return null;
    let sum = 0;
    downloading.forEach((v) => { sum += v; });
    return sum / downloading.size;
  };

  return {
    isSupported,
    translateLines,
    peek: (texts, to) => results.get(resultKey(texts, to)) || null,
    missingPairs,
    download,
    progress,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
