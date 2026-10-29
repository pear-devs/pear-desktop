  Promise.resolve(runtimeSettingsReady).then(() => {
    setupObserver();
    startLyricRafLoop();
    hoverTimeInfoSetup();
    // 歌詞キャッシュの間引きは起動時に 1 回だけ。表示を待たせないよう最後に置く。
    void LyricsCache.prune();
  });
