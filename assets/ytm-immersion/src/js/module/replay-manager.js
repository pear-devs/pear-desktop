  const ReplayManager = {
    HISTORY_KEY: 'ytm_local_history',
    ARTIST_ALIAS_KEY: 'ytm_artist_alias',
    _aliasBackfilled: false,
    currentVideoId: null,
    hasRecordedCurrent: false,
    isRecording: false,
    currentPlayTime: 0,
    lastSaveTime: 0,

    currentLyricLines: 0,
    recordedLyricLines: 0,

    formatDuration: function (seconds) {
      if (!seconds) return `0${t('unit_second')}`;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const uH = t('unit_hour');
      const uM = t('unit_minute');
      const uS = t('unit_second');
      const sp = config.uiLang === 'ja' ? '' : ' ';
      if (h > 0) return `${h}${uH}${sp}${m}${uM}${sp}${s}${uS}`;
      if (m > 0) return `${m}${uM}${sp}${s}${uS}`;
      return `${s}${uS}`;
    },

    incrementLyricCount: function () {
      this.currentLyricLines++;
    },

    // 同じアーティストが 2 組に割れる件。
    //
    // 実際に music.youtube.com で同じ曲を再生して確かめたところ、
    //   navigator.mediaSession.metadata.artist → "Yorushika"
    //   プレイヤーバーの byline            → "ヨルシカ"
    // と、2 つの取得元が別の表記を返していた。getMetadata は
    // MediaSession を優先し、取れない時だけ byline を読む(lyrics-ui.js)。
    // どちらが走るかはタイミング次第なので、同じ人が両方の表記で
    // 履歴に入り、ランキングに 2 回並んでいた。
    //
    // 記録する名前は「画面に出ている方」(byline)に統一し、あわせて
    // 「この 2 つは同じ人」という対応表を残す。対応表があれば、すでに
    // ローマ字で入っている過去の履歴も後から束ねられる。
    _readBylineArtist: function () {
      const el = document.querySelector('.byline.style-scope.ytmusic-player-bar, ytmusic-miniplayer .ytmusicTrackInfoByline');
      if (!el) return '';
      return parseBylineArtist(el.textContent || '').trim();
    },

    _hasCjk: function (text) {
      return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(String(text || ''));
    },

    // 束ねるのは「片方だけが日本語」の組み合わせに限る。
    // 両方ラテン文字なら、それは表記ゆれではなく別のアーティスト
    // (byline 側だけ feat. が付いている等)の可能性がある。
    _looksSameArtist: function (a, b) {
      if (!a || !b || a === b) return false;
      if (a.length > 60 || b.length > 60) return false;
      return this._hasCjk(a) !== this._hasCjk(b);
    },

    _loadArtistAlias: async function () {
      const raw = await storage.get(this.ARTIST_ALIAS_KEY);
      // Restore や古い形式で配列が入っていることがある。対応表は
      // 「別表記 → 画面に出る表記」の平たい辞書だけを受け付ける。
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return raw;
    },

    // すでに溜まっている履歴だけで対応表を作れるところまで作る。
    //
    // 同じ videoId が、ある日は「乃木坂46」、別の日は「Nogizaka46」で
    // 記録されていることがある(その時どちらの取得元が走ったかによる)。
    // 同じ曲なら同じアーティストなのは確実なので、これは聴き直さなくても
    // 判定できる。曲名だけが同じものは別人がいるので使わない。
    _backfillArtistAlias: async function () {
      const history = await storage.get(this.HISTORY_KEY) || [];
      if (!history.length) return 0;

      const namesByVideo = new Map();
      history.forEach(h => {
        if (!h || typeof h.id !== 'string' || !h.id) return;
        if (typeof h.artist !== 'string' || !h.artist) return;
        const bucket = namesByVideo.get(h.id) || new Set();
        bucket.add(h.artist);
        namesByVideo.set(h.id, bucket);
      });

      const alias = await this._loadArtistAlias();
      let learned = 0;

      namesByVideo.forEach(names => {
        if (names.size < 2) return;
        const list = [...names];
        const japanese = list.filter(n => this._hasCjk(n));
        const roman = list.filter(n => !this._hasCjk(n));
        // 日本語表記が 1 つに定まらない時は触らない。
        if (japanese.length !== 1 || !roman.length) return;

        roman.forEach(name => {
          if (!this._looksSameArtist(japanese[0], name)) return;
          if (alias[name] === japanese[0] && alias[japanese[0]] === japanese[0]) return;
          alias[name] = japanese[0];
          alias[japanese[0]] = japanese[0];
          learned++;
        });
      });

      if (learned) await storage.set(this.ARTIST_ALIAS_KEY, alias);
      return learned;
    },

    // 履歴に残っているローマ字表記を YTM に問い合わせ、画面に出る表記へ
    // 揃える。YTM は同じアーティストでも曲ごとに別の表記を付けるので
    // (公式音源は "aimyon"、MV は「あいみょん」)、履歴の中だけを見比べても
    // 同じ人だと判定できない。そこだけは YTM に聞くしかない。
    //
    // 通信が発生するので自動では走らせない。UI にも出していない。
    // 直したくなった時に、YTM のコンソールから手で呼ぶ:
    //   await ReplayManager._syncArtistNamesFromYtm()
    // 1 回で 30 件まで。続きがあれば呼び直す。
    // (普段の表記ゆれは記録時と _backfillArtistAlias で足りる。ここが要るのは
    //  YTM が公式音源と MV で別の表記を付けている場合だけ)
    _syncArtistNamesFromYtm: async function (onProgress) {
      const lookup = globalThis.YTMArtistLookup;
      if (!lookup || typeof lookup.byName !== 'function') return 0;

      const history = await storage.get(this.HISTORY_KEY) || [];
      const alias = await this._loadArtistAlias();

      const targets = [];
      const seen = new Set();
      history.forEach(h => {
        const name = (h && typeof h.artist === 'string') ? h.artist.trim() : '';
        if (!name || seen.has(name)) return;
        seen.add(name);
        if (this._hasCjk(name)) return;   // すでに画面と同じ表記
        if (alias[name]) return;          // 解決済み
        targets.push(name);
      });

      const batch = targets.slice(0, 30);
      let learned = 0;

      for (let i = 0; i < batch.length; i++) {
        const name = batch[i];
        if (typeof onProgress === 'function') onProgress(i + 1, batch.length);

        let found = null;
        try {
          found = await lookup.byName(name);
        } catch (e) {
          console.warn('[DailyReplay] アーティスト表記の問い合わせに失敗', name, e);
          continue;
        }

        const canonical = (found && typeof found.name === 'string') ? found.name.trim() : '';
        // 別人を束ねないための条件は記録時と同じものを通す。
        if (!this._looksSameArtist(canonical, name)) continue;

        alias[name] = canonical;
        alias[canonical] = canonical;
        learned++;
        console.log(`[DailyReplay] 表記を統合: ${name} → ${canonical}`);

        // 連打で叩かない。
        await new Promise(r => setTimeout(r, 250));
      }

      if (learned) await storage.set(this.ARTIST_ALIAS_KEY, alias);
      return learned;
    },

    _rememberArtistAlias: async function (canonical, other) {
      if (!this._looksSameArtist(canonical, other)) return;

      const alias = await this._loadArtistAlias();
      if (alias[other] === canonical && alias[canonical] === canonical) return;

      // 別表記だけでなく、正しい表記自身も自分に向けておく。
      // こうしておくと集計側は alias[name] を引くだけで済む。
      alias[other] = canonical;
      alias[canonical] = canonical;
      await storage.set(this.ARTIST_ALIAS_KEY, alias);
    },

    exportHistory: async function () {
      const history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length === 0) {
        alert('保存する履歴データがありません。');
        return;
      }
      const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `ytm_history_${date}.json`;
      a.click();
      // クリックの直後に revoke すると、ブラウザが読み出す前に URL が
      // 無効になって保存が空振りすることがある。1 秒だけ残す。
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // Restore で読む JSON は利用者のファイル。中身は何でも入り得るので、
    // 履歴として成立する要素だけを通す。timestamp が無い要素が混ざると
    // 並べ替えが NaN になり、getStats の new Date(NaN) まで巻き込む。
    _isValidHistoryEntry: function (entry) {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.id !== 'string' || !entry.id) return false;
      if (typeof entry.title !== 'string') return false;
      if (typeof entry.artist !== 'string') return false;
      if (!Number.isFinite(Number(entry.timestamp))) return false;
      return true;
    },

    _sanitizeHistoryEntry: function (entry) {
      const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      return {
        id: String(entry.id),
        title: String(entry.title),
        artist: String(entry.artist),
        src: typeof entry.src === 'string' ? entry.src : null,
        duration: num(entry.duration),
        lyricLines: num(entry.lyricLines),
        timestamp: num(entry.timestamp),
      };
    },

    importHistory: function () {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) {
              const valid = data
                .filter(entry => this._isValidHistoryEntry(entry))
                .map(entry => this._sanitizeHistoryEntry(entry));
              const skipped = data.length - valid.length;
              if (!valid.length) {
                alert('復元できる履歴がありませんでした。');
                return;
              }
              const note = skipped > 0 ? `\n（読めない ${skipped} 件は飛ばします）` : '';
              if (confirm(`履歴を復元しますか？${note}\n[OK] 現在の履歴に結合 (マージ)\n[キャンセル] キャンセル`)) {
                const current = await storage.get(this.HISTORY_KEY) || [];
                const existingIds = new Set(current.map(i => i.id + '_' + i.timestamp));
                const newData = valid.filter(i => !existingIds.has(i.id + '_' + i.timestamp));
                const merged = current.concat(newData);
                merged.sort((a, b) => a.timestamp - b.timestamp);
                await storage.set(this.HISTORY_KEY, merged);
                alert('履歴を復元しました！');
                this.renderUI();
              }
            } else {
              alert('無効なファイル形式です。');
            }
          } catch (err) {
            console.error(err);
            alert('ファイルの読み込みに失敗しました。');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    },

    check: async function () {
      // 広告中は動画 ID や再生秒数が変わっても音楽の履歴に反映しない。
      if (document.querySelector('.ad-interrupting, .ad-showing')) return;
      const video = document.querySelector('video');
      if (!video) return;
      const vid = getCurrentVideoId();
      if (!vid) return;

      if (vid !== this.currentVideoId) {
        // 前の曲の、まだ書いていない再生時間を書いておく(書くのは 30 秒ごとなので)
        if (this.hasRecordedCurrent && this.currentPlayTime > this.lastSaveTime && !this.isRecording) {
          void this.updateDuration(this.currentVideoId, this.currentPlayTime, this.currentLyricLines);
        }
        this.currentVideoId = vid;
        this.hasRecordedCurrent = false;
        this.isRecording = false;
        this.currentPlayTime = 0;
        this.lastSaveTime = 0;
        this.currentLyricLines = 0;
        this.recordedLyricLines = 0;
        this._lastVideoTime = video.currentTime;
        return;
      }

      // 同じ曲の 2 周目(1 曲リピート・聴き終えてから頭へ戻した)。
      // 新しい再生の目印を videoId の変化だけにしていたので、リピートで
      // 何周しても 1 回のまま、再生時間だけが 1 件に積み上がっていた。
      // 記録済みの周の後半から曲頭へ戻った時だけ、別の 1 回として数え直す。
      const nowTime = video.currentTime;
      const prevTime = this._lastVideoTime;
      this._lastVideoTime = nowTime;
      if (this.hasRecordedCurrent && !this.isRecording &&
        Number.isFinite(nowTime) && Number.isFinite(prevTime) && Number.isFinite(video.duration) &&
        video.duration > 10 && nowTime < 3 && prevTime > video.duration * 0.5) {
        this.hasRecordedCurrent = false;
        this.currentPlayTime = 0;
        this.lastSaveTime = 0;
        this.currentLyricLines = 0;
        this.recordedLyricLines = 0;
      }

      if (!video.paused) {
        this.currentPlayTime++;
        const isPlayed = this.currentPlayTime > 30 || (video.duration > 10 && this.currentPlayTime / video.duration > 0.4);

        if (isPlayed) {
          if (!this.hasRecordedCurrent && !this.isRecording) {
            this.isRecording = true;
            try {
              await this.recordNewPlay();
              this.hasRecordedCurrent = true;
            } finally {
              this.isRecording = false;
            }
          } else if (this.currentPlayTime - this.lastSaveTime >= this.SAVE_EVERY_SEC && !this.isRecording) {
            this.isRecording = true;
            try {
              await this.updateDuration();
              this.lastSaveTime = this.currentPlayTime;
            } finally {
              this.isRecording = false;
            }
          }
        }
      }
    },

    recordNewPlay: async function () {
      const meta = getMetadata();
      if (!meta) return;

      this.recordedLyricLines = this.currentLyricLines;

      // 画面に出ている表記を優先して記録する。読めなかった時だけ
      // getMetadata(MediaSession)の名前を使う。
      const shown = this._readBylineArtist();
      await this._rememberArtistAlias(shown, meta.artist);

      const record = {
        id: this.currentVideoId,
        title: meta.title,
        artist: shown || meta.artist,
        src: meta.src,
        duration: this.currentPlayTime,
        lyricLines: this.currentLyricLines,
        timestamp: Date.now()
      };

      let history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length > 10000) history = history.slice(-10000);
      history.push(record);
      await storage.set(this.HISTORY_KEY, history);

      if (ui.replayPanel && ui.replayPanel.classList.contains('active')) {
        this.renderUI();
      }
    },

    // 再生時間の書き込みは、履歴(最大 1 万件・2MB 余り)をまるごと読んで書き戻す。
    // 以前は再生中 5 秒ごとに行っていて、Immersion を閉じていても 1 時間に
    // 数 GB ぶんの読み書きと使い捨てのメモリを生んでいた。30 秒ごとにして、
    // 曲が変わる時に残りを書く(check)。
    SAVE_EVERY_SEC: 30,

    updateDuration: async function (videoId = this.currentVideoId, playTime = this.currentPlayTime, lyricLines = this.currentLyricLines) {
      let history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length === 0) return;

      const lastIndex = history.length - 1;
      if (history[lastIndex].id === videoId) {
        history[lastIndex].duration = playTime;
        history[lastIndex].lyricLines = lyricLines;

        await storage.set(this.HISTORY_KEY, history);
        if (ui.replayPanel && ui.replayPanel.classList.contains('active')) {
          this.renderUI();
        }
      }
    },

    getStats: async function (range = 'day') {
      const history = await storage.get(this.HISTORY_KEY) || [];
      const now = Date.now();
      let threshold = 0;
      if (range === 'day') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        threshold = today.getTime();
      } else if (range === 'week') {
        threshold = now - (7 * 24 * 60 * 60 * 1000);
      }

      const filtered = history.filter(h => h.timestamp >= threshold);

      // 表記ゆれを束ねる。対応表の値は「画面に出る表記」そのものなので、
      // 引いた結果をそのままキーにも表示名にも使える。
      const alias = await this._loadArtistAlias();
      const artistKeyOf = (h) => {
        const name = (h && h.artist) || '';
        const canonical = alias[name];
        return (typeof canonical === 'string' && canonical) ? canonical : name;
      };

      const countMap = {};
      const artistMap = {};
      let totalSeconds = 0;
      let totalLyrics = 0;
      const hourCounts = new Array(24).fill(0);

      filtered.forEach(h => {
        const artistKey = artistKeyOf(h);
        const key = h.title + '///' + artistKey;
        if (!countMap[key]) countMap[key] = { ...h, artistKey, count: 0, totalDuration: 0 };

        countMap[key].count++;
        const duration = typeof h.duration === 'number' ? h.duration : 0;
        countMap[key].totalDuration += duration;

        // 初出でも 1 回として数える。以前は { count: 0 } で作って else 側でしか
        // 加算していなかったので、全アーティストが 1 回ずつ少なく出ていた
        // (1 回しか聴いていないアーティストは 0 回)。シェア % もずれる。
        if (!artistMap[artistKey]) {
          artistMap[artistKey] = { count: 0, src: h.src };
        }
        artistMap[artistKey].count++;
        if (h.src) artistMap[artistKey].src = h.src;

        totalSeconds += duration;

        if (h.lyricLines && typeof h.lyricLines === 'number') {
          totalLyrics += h.lyricLines;
        }

        const hour = new Date(h.timestamp).getHours();
        hourCounts[hour]++;
      });

      const topSongs = Object.values(countMap)
        .map(song => ({ ...song, artist: song.artistKey || song.artist }))
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return b.totalDuration - a.totalDuration;
        });

      const topArtists = Object.keys(artistMap)
        .map(key => ({
          name: key,
          count: artistMap[key].count,
          src: artistMap[key].src
        }))
        .sort((a, b) => b.count - a.count);

      const mostPlayedArtist = topArtists[0] || null;
      const mostPlayedSong = topSongs[0] || null;

      const totalPlays = filtered.length;
      const maxHourVal = Math.max(...hourCounts);
      const peakHour = hourCounts.indexOf(maxHourVal);

      // 「あなたの雰囲気」(vibeLabel) はここで作っていたが、表示をやめた。
      // 曜日と時間帯から日本語の決め打ち文を組み立てていたもので、
      // i18n も通っておらず、他の言語では日本語がそのまま出ていた。
      let topArtistShare = "0%";
      if (totalPlays > 0 && mostPlayedArtist) {
        topArtistShare = Math.round((mostPlayedArtist.count / totalPlays) * 100) + "%";
      }

      return {
        totalPlays,
        totalTime: this.formatDuration(totalSeconds),
        totalLyrics: totalLyrics.toLocaleString(),
        // topSongs は 50 件で切っているので、曲数はそれとは別に持つ。
        // 切ったあとの length を曲数として出すと 50 で頭打ちになる。
        uniqueSongs: Object.keys(countMap).length,
        uniqueArtistCount: Object.keys(artistMap).length,
        topArtistShare,
        peakHour,
        topSongs: topSongs.slice(0, 50),
        topArtists: topArtists.slice(0, 10),
        mostPlayedSong,
        mostPlayedArtist
      };
    },

    renderUI: async function () {
      if (!ui.replayPanel) return;
      const container = ui.replayPanel.querySelector('.ytm-replay-content');

      // 履歴の走査はパネルを開いた最初の 1 回だけ。再生中は renderUI が
      // 5 秒ごとに走るので、毎回全件を読み直すわけにはいかない。
      if (!this._aliasBackfilled) {
        this._aliasBackfilled = true;
        try {
          await this._backfillArtistAlias();
        } catch (e) {
          console.warn('[DailyReplay] alias backfill failed', e);
        }
      }

      const range = ui.replayPanel.dataset.range || 'day';
      const stats = await this.getStats(range);

      const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
      if (pills[0]) pills[0].textContent = t('replay_today');
      if (pills[1]) pills[1].textContent = t('replay_week');
      if (pills[2]) pills[2].textContent = t('replay_all');

      this._ensureFooter();

      if (stats.totalPlays === 0) {
        container._ytmReplayHtml = null;
        container.innerHTML = `
          <div class="replay-empty">
            <div>${t('replay_empty')}</div>
            <div class="replay-empty-sub">${t('replay_no_data_sub')}</div>
          </div>`;
        return;
      }

      // 曲名・アーティスト名・画像 URL は再生履歴から来る。履歴は Restore で
      // 利用者のファイルからも入るので、任意のマークアップが混ざり得る。
      const heroImage = escapeHtml(stats.mostPlayedSong?.src || '');
      const unitCount = t('replay_unit_count');

      let artistRestHtml = '';
      if (stats.topArtists.length > 1) {
        const rows = stats.topArtists.slice(1, 3).map((artist, idx) => `
                <div class="bento-artist-row">
                  <span class="name">#${idx + 2} ${escapeHtml(artist.name)}</span>
                  <span class="count">${Number(artist.count) || 0}${unitCount}</span>
                </div>`).join('');
        artistRestHtml = `<div class="bento-artist-rest">${rows}</div>`;
      }

      let html = `
        <div class="bento-grid">

          <div class="bento-col bento-col-side">
            <div class="bento-item hero-stat-time">
              <div class="bento-label">${t('replay_playTime')}</div>
              <div class="bento-value-huge bento-value-time">${escapeHtml(stats.totalTime)}</div>
              <div class="bento-sub">${stats.totalPlays} ${t('replay_plays')}</div>
            </div>

            <div class="bento-item hero-lyrics">
              <div class="bento-label">${t('replay_lyrics_heard')}</div>
              <div class="bento-value-huge">${escapeHtml(stats.totalLyrics)}<span class="bento-unit">${t('replay_unit_lines')}</span></div>
            </div>

            <div class="bento-item hero-artist">
              <div class="bento-label">${t('replay_topArtist')}</div>
              <div class="bento-artist-name">${escapeHtml(stats.mostPlayedArtist?.name || '')}</div>
              <div class="bento-tag">${t('replay_share')} ${escapeHtml(stats.topArtistShare)}</div>
              ${artistRestHtml}
            </div>
          </div>

          <div class="bento-col bento-col-song">
            <div class="bento-item hero-song">
              <div class="hero-song-art" style="background-image: url('${heroImage}');"></div>
              <div class="hero-song-body">
                <div class="bento-label">${t('replay_topSong')}</div>
                <div class="bento-song-title">${escapeHtml(stats.mostPlayedSong?.title)}</div>
                <div class="bento-song-artist">${escapeHtml(stats.mostPlayedSong?.artist)}</div>
                <div class="bento-tag">${Number(stats.mostPlayedSong?.count) || 0} ${t('replay_plays')}</div>
              </div>
            </div>
          </div>

          <div class="bento-col bento-col-rank">
            <div class="bento-item ranking-list-container">
              <div class="bento-label">${t('replay_ranking')}</div>
              <div class="replay-list">`;

      stats.topSongs.forEach((song, idx) => {
        const timeStr = this.formatDuration(song.totalDuration);
        html += `
                <div class="replay-item">
                  <div class="replay-rank">${idx + 1}</div>
                  <div class="replay-img">${song.src ? `<img src="${escapeHtml(song.src)}" crossorigin="anonymous" loading="lazy" alt="">` : ''}</div>
                  <div class="replay-info">
                    <div class="replay-title">${escapeHtml(song.title)}</div>
                    <div class="replay-artist">${escapeHtml(song.artist)}</div>
                  </div>
                  <div class="replay-count">
                    <div class="replay-count-val">${Number(song.count) || 0}${unitCount}</div>
                    <div class="replay-time-val">${timeStr}</div>
                  </div>
                </div>`;
      });

      html += `</div></div></div></div>`;

      // 再生中は 5 秒ごとにここへ来る。中身ごと innerHTML で作り直すと
      // ランキングのスクロール位置が毎回 0 に戻り、再生中はランキングの
      // 2 画面目以降を読めなかった(実機で確認)。変わっていなければ触らず、
      // 作り直す時もスクロール位置を引き継ぐ。期間を切り替えた時だけ頭から。
      if (container._ytmReplayHtml === html) return;
      const sameRange = container._ytmReplayRange === range;
      const prevList = container.querySelector('.replay-list');
      const listTop = sameRange && prevList ? prevList.scrollTop : 0;
      const contentTop = sameRange ? container.scrollTop : 0;
      container.innerHTML = html;
      container._ytmReplayHtml = html;
      container._ytmReplayRange = range;
      const nextList = container.querySelector('.replay-list');
      if (nextList) nextList.scrollTop = listTop;
      container.scrollTop = contentTop;
    },

    // フッターは中身が変わらないので、パネル 1 つにつき 1 回だけ組む。
    // 以前は renderUI のたびに innerHTML を入れ直して onclick を付け直して
    // いた。再生中は 5 秒ごとに走るので、押そうとしたボタンがその瞬間に
    // 作り替わることがあった。
    _ensureFooter: function () {
      if (!ui.replayPanel) return;
      if (ui.replayPanel.querySelector('.replay-footer-area')) return;

      const footerArea = createEl('div', 'replay-footer-area', 'replay-footer-area');
      footerArea.innerHTML = `
        <button id="replay-import-btn" class="replay-footer-btn" data-ytm-text="replay_restore">${t('replay_restore')}</button>
        <button id="replay-export-btn" class="replay-footer-btn" data-ytm-text="replay_backup">${t('replay_backup')}</button>
        <button id="replay-cloudsync-btn" class="replay-footer-btn" data-ytm-text="replay_cloud">${t('replay_cloud')}</button>
        <button id="replay-reset-action" class="replay-footer-btn">${t('settings_reset')}</button>
      `;
      ui.replayPanel.appendChild(footerArea);

      footerArea.querySelector('#replay-import-btn').onclick = () => this.importHistory();
      footerArea.querySelector('#replay-export-btn').onclick = () => this.exportHistory();
      footerArea.querySelector('#replay-cloudsync-btn').onclick = () => {
        CloudSync.init();
        if (CloudSync.openPanel) CloudSync.openPanel();
      };
      footerArea.querySelector('#replay-reset-action').onclick = async () => {
        if (confirm(t('replay_reset_confirm'))) {
          await storage.remove(this.HISTORY_KEY);
          this.renderUI();
        }
      };
    },

    init: function () {
      setInterval(() => this.check(), 1000);
    }
  };

