// キューを開くまでに帯の上で留まる時間。
// 帯は右端 52px。単一モニタなら画面の端がカーソルを止めるので広くても
// 困らないが、デュアルモニタで左にウィンドウを置くと、隣のモニタへ
// 移動する途中でここを横切る。掠めただけで開かないようにする。
const QUEUE_OPEN_DWELL_MS = 160;

  const QueueManager = {
    observer: null,


    // ===== Next-song lyrics prefetch (always) =====
    _prefetchLastAt: new Map(),
    _prefetchInFlight: new Set(),
    PREFETCH_DEDUP_MS: 6000,
    // 「いつ先読みしたか」は曲ごとに 1 件ずつ増え、消える口が無かった。
    // 覚えておく意味があるのは直近ぶんだけなので上限を置く。
    PREFETCH_HISTORY_LIMIT: 200,

    // YTM のキュー DOM からは videoId もサムネイル URL も取れない
    // (実測: ytmusic-player-queue-item の中に a 要素が1つも無く、
    //  img は画面外だと 1x1 の data: プレースホルダのまま)。
    // ytm-lyrics.js が取得済みの InnerTube のキューを曲名で引き当てて補う。
    _normalizeTitleForQueue: function (s) {
      return String(s || '')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLowerCase();
    },

    _buildQueueIndex: function () {
      const index = new Map();
      try {
        if (!window.YTMLyrics || typeof window.YTMLyrics.queue !== 'function') return index;
        const currentId = new URL(location.href).searchParams.get('v');
        // まだ取得できていない時は空で返ってくる。届いたら一度だけ描き直す。
        const entries = window.YTMLyrics.queue(currentId, () => {
          this._renderedSignature = null;
          this.syncQueue();
        }) || [];
        for (const entry of entries) {
          const key = this._normalizeTitleForQueue(entry.title);
          if (key && !index.has(key)) index.set(key, entry);
        }
      } catch (e) { /* 引けなくても従来どおり DOM だけで描画する */ }
      return index;
    },

    _extractVideoIdFromQueueItem: function (queueItem) {
      // ページ側の橋渡し(page/queue-bridge.js)が置いた videoId が一番確か
      const stamped = queueItem.getAttribute('data-ytmi-video-id');
      if (stamped) return stamped;
      try {
        const a =
          queueItem.querySelector('a[href*="watch"]') ||
          queueItem.querySelector('a[href*="youtu"]') ||
          queueItem.querySelector('a');
        const href = a ? (a.href || a.getAttribute('href')) : null;
        if (!href) return null;
        const u = new URL(href, location.origin);
        // /watch?v=...
        const v = u.searchParams.get('v');
        if (v) return v;
        // youtu.be/<id>
        if (u.hostname.includes('youtu.be')) {
          const parts = (u.pathname || '').split('/').filter(Boolean);
          return parts[0] || null;
        }
      } catch (e) { }
      return null;
    },

    _prefetchLyrics: function (meta) {
      const title = (meta && meta.title) ? String(meta.title).trim() : '';
      const artist = (meta && meta.artist) ? String(meta.artist).trim() : '';
      if (!title) return;

      const key = `${title}///${artist}`;
      const now = Date.now();

      const last = this._prefetchLastAt.get(key) || 0;
      if (now - last < this.PREFETCH_DEDUP_MS) return;
      if (this._prefetchInFlight.has(key)) return;

      this._prefetchLastAt.set(key, now);
      trimMapToLimit(this._prefetchLastAt, this.PREFETCH_HISTORY_LIMIT, (k) => k === key);
      this._prefetchInFlight.add(key);

      const videoId = meta && meta.videoId ? meta.videoId : null;
      const youtubeUrl = meta && meta.youtubeUrl ? meta.youtubeUrl : (videoId ? `https://youtu.be/${videoId}` : null);

      YTMLog.log('[Queue] Prefetch(next) lyrics:', title, '/', artist);

      chrome.runtime.sendMessage({
        type: 'GET_LYRICS',
        payload: {
          track: title,
          artist: artist,
          youtube_url: youtubeUrl,
          video_id: videoId,
          // 先読みも本再生と同じ取得元で引く。渡し忘れると
          // 「新ソースのみ」にしていても先読みだけ LRCHub を叩いてしまう。
          lyric_source_mode: (typeof config !== 'undefined' && config.lyricSourceMode) || 'ytm',
        }
      }, (res) => {
        this._prefetchInFlight.delete(key);
        // Service Worker が寝ている等で応答が来ないと chrome.runtime.lastError が
        // 立つ。参照しないと未処理エラーとしてコンソールに残り続けるので必ず読む。
        if (chrome.runtime.lastError) return;

        // Don't overwrite existing good cache on transient failures
        if (!res || !res.success) return;

        const lyr = (res.lyrics || '');
        if (typeof lyr === 'string' && lyr.trim()) {
          // 利用者が読み込んだ歌詞や自分で選んだ候補は上書きしない。
          // 以前は確かめずに書いていたので、Up Next を開いたまま次の曲へ進むと、
          // その曲に読み込んでおいた LRC が先読みの結果で消えていた
          // (歌詞が無かった時の分岐は既に確かめていた)。
          storage.get(key).then((existing) => {
            if (LyricsCache.isUserOwned(existing)) return;
            return storage.set(key, {
              cacheVersion: LYRICS_CACHE_VERSION,
              record_id: res.record_id || null,
              video_id: videoId,
              lyrics: lyr,
              dynamicLines: res.dynamicLines || null,
              // 本再生の保存(loadLyrics)と同じく、引き直せる候補の本文は落とす
              candidates: LyricsCache.stripCandidateLyrics(res.candidates) || null,
              lyricsSource: res.lyricsSource || res.source || 'lrchub',
              fallbackUsed: !!res.fallbackUsed,
              fetchedAt: Date.now(),
            });
          });
        } else {
          // 「歌詞が無かった」を覚えておく(本再生で取りに行かずに済む)。
          // 本物の歌詞が保存済みなら上書きしない。
          storage.get(key).then((cached0) => {
            const existing = cached0 && typeof cached0.lyrics === 'string' ? cached0.lyrics : '';
            const hasReal = existing && existing.trim() && existing !== NO_LYRICS_SENTINEL;
            if (hasReal) return;
            return storage.set(key, {
              lyrics: NO_LYRICS_SENTINEL,
              dynamicLines: null,
              candidates: res.candidates || null,
              noLyrics: true,
              fetchedAt: Date.now(),
            });
          });
        }
      });
    },

    // 曲名に < > & が含まれると innerHTML でマークアップが壊れる
    // 本体は namespace.js の escapeHtml。ここは既存の呼び出し口を残すだけ。
    _escapeHtml: function (value) {
      return escapeHtml(value);
    },

    init: function () {
      if (ui.queuePanel) return;
      const trigger = createEl('div', 'ytm-queue-trigger');
      document.body.appendChild(trigger);
      const panel = createEl('div', 'ytm-queue-panel', '', `
        <div class="queue-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <h3 style="margin:0;line-height:1.1;">Up Next</h3>
          <button class="queue-pin" type="button" title="Pin" aria-label="Pin Up Next" style="
            display:inline-flex;
            align-items:center;
            justify-content:center;
            cursor:pointer;
            width:30px;
            height:30px;
            padding:0;
            border-radius:10px;
            border:1px solid rgba(255,255,255,0.18);
            background:rgba(255,255,255,0.06);
            color:inherit;
            line-height:1;
            user-select:none;
          "></button>
        </div>
        <div class="queue-list-content">
            <div class="lyric-loading">Loading...</div>
        </div>
      `);
      document.body.appendChild(panel);
      ui.queuePanel = panel;


      const PIN_KEY = 'ytm_queue_pinned';
      const pinBtn = panel.querySelector('.queue-pin');

      // ピンは絵文字だと環境ごとに字形も色も揃わないので、他のボタンと同じ
      // インライン SVG(currentColor 追従)で描く。留めている時だけ塗りつぶす。
      const pinSvg = (filled) => `
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"
             fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor"
             stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.1 1.9h3.8v3.6l1.9 2.4H4.2l1.9-2.4V1.9Z"/>
          <path d="M8 8.1v6" fill="none"/>
        </svg>`;

      const applyPinnedUI = (pinned) => {
        if (!pinBtn) return;
        pinBtn.innerHTML = pinSvg(pinned);
        pinBtn.title = pinned ? 'Unpin' : 'Pin';
        pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        if (pinned) {
          pinBtn.dataset.pinned = '1';
          pinBtn.style.color = 'rgb(190, 255, 110)';
          pinBtn.style.background = 'rgba(255,255,255,0.14)';
          pinBtn.style.border = '1px solid rgba(190, 255, 110, 0.55)';
          pinBtn.style.boxShadow = '0 0 0 1px rgba(190,255,110,0.18), 0 0 10px rgba(190,255,110,0.12)';
          pinBtn.style.transform = 'translateZ(0)';
        } else {
          pinBtn.dataset.pinned = '';
          pinBtn.style.color = 'inherit';
          pinBtn.style.background = 'rgba(255,255,255,0.06)';
          pinBtn.style.border = '1px solid rgba(255,255,255,0.18)';
          pinBtn.style.boxShadow = 'none';
        }
      };
      applyPinnedUI(false);

      // Load persisted pin state
      storage.get(PIN_KEY).then((v) => {
        this.pinned = !!v;
        applyPinnedUI(this.pinned);
        if (this.pinned) openPanel();
      });

      if (pinBtn) {
        pinBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.pinned = !this.pinned;
          storage.set(PIN_KEY, this.pinned);
          applyPinnedUI(this.pinned);
          if (this.pinned) {
            openPanel();
          } else {
            // If unpinned and not hovered, close immediately
            setTimeout(() => {
              try {
                if (!panel.matches(':hover') && !trigger.matches(':hover')) {
                  closePanel(true);
                }
              } catch (e) { }
            }, 0);
          }
        });
      }


      let leaveTimer = null;
      const openPanel = () => {
        clearTimeout(leaveTimer);
        panel.classList.add('visible');
        this.startObserver();
        this.syncQueue();
      };
      const closePanel = (immediate = false) => {
        if (this.pinned) return;
        const action = () => {
          panel.classList.remove('visible');
          this.stopObserver();
        };
        if (immediate) {
          clearTimeout(leaveTimer);
          action();
        } else {
          clearTimeout(leaveTimer);
          leaveTimer = setTimeout(action, 300);
        }
      };

      // 入った瞬間には開かない。帯を広げた(52px)ので、隣のモニタへ
      // 移動する途中や、右端のスクロールバーを掴みに行く途中で
      // 掠めただけでも開いてしまうため。
      // 少し留まった時だけ「開きたい」とみなす。
      let dwellTimer = null;
      const cancelDwell = () => {
        if (dwellTimer) clearTimeout(dwellTimer);
        dwellTimer = null;
      };
      trigger.addEventListener('mouseenter', () => {
        cancelDwell();
        dwellTimer = setTimeout(() => {
          dwellTimer = null;
          // 離れたあとに発火しても困るので、まだ乗っているか確かめる。
          // Immersion の外では帯ごと隠している(style.css)が、切り替えの
          // 瞬間に乗っていた時のためにここでも確かめる。
          if (!document.body.classList.contains('ytm-custom-layout')) return;
          if (trigger.matches(':hover')) openPanel();
        }, QUEUE_OPEN_DWELL_MS);
      });
      panel.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
      panel.addEventListener('mouseleave', () => closePanel(false));
      trigger.addEventListener('mouseleave', () => {
        cancelDwell();
        setTimeout(() => {
          if (!panel.matches(':hover')) closePanel(false);
        }, 100);
      });
    },

    onSongChanged: function () {
      this.syncQueue();
      [500, 1000, 2000, 3000].forEach(ms => {
        setTimeout(() => {
          if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
            this.syncQueue();
          }
        }, ms);
      });
    },

    _isObserving: false,

    startObserver: function () {
      const originalQueue = document.querySelector('ytmusic-player-queue');
      if (originalQueue && !this.observer) {
        // attributes:true を無条件で見ていたため、キュー内のあらゆる属性変化
        // (ホバー・進捗・遅延読み込み等) で発火し、そのたびに全行を作り直して
        // ちらつき＋スクロール位置リセットが起きていた。
        // 監視は selected の変化に絞り、さらにデバウンスする。
        this.observer = new MutationObserver(() => {
          if (!ui.queuePanel || !ui.queuePanel.classList.contains('visible')) return;
          clearTimeout(this._syncDebounce);
          this._syncDebounce = setTimeout(() => this.syncQueue(), 120);
        });
      }
      if (originalQueue && this.observer && !this._isObserving) {
        this.observer.observe(originalQueue, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['selected']
        });
        this._isObserving = true;
      }
    },

    stopObserver: function () {
      if (this.observer && this._isObserving) {
        this.observer.disconnect();
        this._isObserving = false;
      }
    },

    syncQueue: function () {
      if (!ui.queuePanel) return;
      if (!this.observer) this.startObserver();

      const container = ui.queuePanel.querySelector('.queue-list-content');
      // 行に videoId とサムネイルを写してもらってから読む(page/queue-bridge.js)
      document.dispatchEvent(new CustomEvent('ytmi-queue-stamp'));
      const allRawItems = document.querySelectorAll('ytmusic-player-queue-item');

      const visibleItems = Array.from(allRawItems).filter(item => item.offsetParent !== null);

      if (visibleItems.length === 0) return;

      let currentIndex = visibleItems.findIndex(item => item.hasAttribute('selected'));
      if (currentIndex === -1) {
        // 曲の切り替わり中、YTM は selected を一瞬外す。
        // ここで 0 に落とすとキューの先頭を「再生中」として描き直してしまい、
        // 曲送りのたびにリストが頭に飛ぶ。既に描画済みなら更新を見送る。
        if (this._renderedSignature) return;
        currentIndex = 0;
      }

      // 再生済みの曲(YTM のキューで再生中より前)も上に並べる。描き直した時は
      // 再生中の曲を一番上に合わせるので、開いた時の見え方は今までどおりで、
      // 上へスクロールするとキューを遡れる。
      const pastItems = visibleItems.slice(0, currentIndex);
      const targetItems = visibleItems.slice(currentIndex);

      // 中身が変わっていないのに innerHTML を作り直すと、スクロール位置が戻り
      // クリックハンドラも張り直しになる。署名で差分を見て無駄な再構築を避ける。
      const itemSignature = (item) => {
        const t = item.querySelector('.song-title');
        return `${this._extractVideoIdFromQueueItem(item) || ''}:${t ? t.textContent.trim() : ''}`;
      };
      const signature = targetItems.length
        ? `${pastItems.map(itemSignature).join('|')}#${targetItems.map(itemSignature).join('|')}`
        : '';
      if (signature && signature === this._renderedSignature) return;
      this._renderedSignature = signature;

      container.innerHTML = '';
      const queueIndex = this._buildQueueIndex();

      // 再生済みの行。先読みはしない。重複は再生済みの中だけで除く
      // (これから流れる曲と同じ曲が前にあっても消さない)
      const seenPast = new Set();
      pastItems.forEach((item) => {
        const row = this._buildQueueRow(item, queueIndex, { past: true });
        if (!row || seenPast.has(row.dedupeKey)) return;
        seenPast.add(row.dedupeKey);
        container.appendChild(row.el);
      });

      const seenIds = new Set();
      let renderedCount = 0;
      targetItems.forEach((item) => {
        const titleEl = item.querySelector('.song-title');
        const artistEl = item.querySelector('.byline');
        if (!titleEl) return;

        const title = titleEl.textContent.trim();
        // byline は「アーティスト • アルバム • 年」のことがある。本再生側
        // (getMetadata)は先頭だけをアーティストとして扱うので、ここも揃える。
        // 揃えないと歌詞キャッシュのキーが食い違い、先読みが一度も当たらない。
        const bylineText = artistEl ? artistEl.textContent.trim() : '';
        const artist = parseBylineArtist(bylineText);
        const queueEntry = queueIndex.get(this._normalizeTitleForQueue(title)) || null;
        const videoId = this._extractVideoIdFromQueueItem(item)
          || (queueEntry ? queueEntry.videoId : null);

        // 重複判定は videoId で行う。曲名+アーティストだと、ミックスや
        // リピートで同じ曲がキューに複数回入っているとき正当な行まで消えていた。
        const dedupeKey = videoId || `${title}///${artist}`;
        if (seenIds.has(dedupeKey)) return;
        seenIds.add(dedupeKey);

        const isPlaying = (renderedCount === 0);
        // 先読みは重複除去後の「次の曲」に対して行う。
        // 以前は除去前の idx===1 を見ていたため、その行が重複で消えると
        // 画面に出ていない曲を先読みしていた。
        // videoId が取れた時だけ先読みする。無いと本再生側の
        // cacheMatchesVideo(video_id の一致)が false になり、せっかく
        // 取ったキャッシュが使われないまま storage に溜まるだけになる。
        if (renderedCount === 1 && videoId) {
          this._prefetchLyrics({
            title, artist, videoId,
            youtubeUrl: `https://youtu.be/${videoId}`,
          });
        }

        // YouTube Music 側の歌詞は content script からしか取れないので、
        // これから流れる数曲ぶんをここで温めておく。videoId 単位でメモ化される
        // ため、実際に曲が変わった時にはネットワーク往復ゼロで表示できる。
        // 数曲先まで持っておくと、曲送りを連打された時も待ちが出ない。
        if (renderedCount >= 1 && renderedCount <= 3 && videoId &&
          window.YTMLyrics && typeof window.YTMLyrics.fetch === 'function' &&
          !(Array.isArray(config.disabledLyricSources) && config.disabledLyricSources.includes('ytm'))) {
          window.YTMLyrics.fetch(videoId).catch(() => { });
        }
        renderedCount += 1;

        const row = this._buildQueueRow(item, queueIndex, { playing: isPlaying });
        container.appendChild(row.el);
      });

      // 再生中の曲を一番上に合わせる(その上が再生済み)
      const current = container.querySelector('.queue-item.current');
      if (current) {
        container.scrollTop += current.getBoundingClientRect().top - container.getBoundingClientRect().top;
      }
    },

    // キューの 1 行。再生中(playing)・再生済み(past)で見た目だけ変える。
    // 押すと YTM のキューのその曲を再生する。
    _buildQueueRow: function (item, queueIndex, { playing = false, past = false } = {}) {
      const titleEl = item.querySelector('.song-title');
      const artistEl = item.querySelector('.byline');
      const imgEl = item.querySelector('.thumbnail img');
      if (!titleEl) return null;

      const title = titleEl.textContent.trim();
      const bylineText = artistEl ? artistEl.textContent.trim() : '';
      const artist = parseBylineArtist(bylineText);
      const queueEntry = queueIndex.get(this._normalizeTitleForQueue(title)) || null;
      const videoId = this._extractVideoIdFromQueueItem(item)
        || (queueEntry ? queueEntry.videoId : null);
      const isPlaying = playing;

      const uniqueKey = `${title}///${artist}`;

      // YTM のキューはサムネイルを遅延読み込みしており、画面外の行の img は
      // 1x1 の透明 GIF (data:) のまま。実測では最初はキュー全行がこの状態で、
      // そのままだと Up Next のジャケットがほぼ全部プレースホルダになる。
      //   1. DOM が本物を持っていればそれ(正方形のアートワーク)
      //   2. ページ側の橋渡しが写した、その行のサムネイル URL
      //   3. InnerTube のキューにあるアートワーク URL
      //   4. videoId から i.ytimg.com のサムネイル
      // 読めなかった時は次の候補へ進む。以前は最初の 1 つが落ちるとそのまま
      // 記号になり、後ろに使える URL があっても試していなかった。
      const candidates = [];
      if (imgEl && imgEl.src && !imgEl.src.startsWith('data:')) candidates.push(imgEl.src);
      const stampedThumb = item.getAttribute('data-ytmi-thumb');
      if (stampedThumb) candidates.push(stampedThumb);
      if (queueEntry && queueEntry.thumbnail && (!videoId || !queueEntry.videoId || queueEntry.videoId === videoId)) {
        candidates.push(queueEntry.thumbnail);
      }
      if (videoId) candidates.push(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
      const sources = [...new Set(candidates.filter(u => /^https:\/\//.test(u)))];
      const src = sources[0] || '';

      const row = createEl('div', '', `queue-item ${isPlaying ? 'current' : ''} ${past ? 'past' : ''}`);

      const imgHtml = src
        ? `<img src="${this._escapeHtml(src)}" loading="lazy">`
        : `<div class="queue-img-fallback">♪</div>`;

      const indicatorHtml = isPlaying
        ? `<div class="queue-playing-indicator"><i></i><i></i><i></i></div>`
        : '';

      row.innerHTML = `
        <div class="queue-img">
          ${imgHtml}
          ${indicatorHtml}
        </div>
        <div class="queue-info">
          <div class="queue-title">${this._escapeHtml(title)}</div>
          <div class="queue-artist">${this._escapeHtml(bylineText)}</div>
        </div>
      `;

      // サムネイルが 404 等で落ちた時だけ記号に差し替える。
      // インラインの onerror は YTM の CSP で実行されないので、必ずここで張る。
      const rowImg = row.querySelector('.queue-img img');
      if (rowImg) {
        let next = 1;
        const onError = () => {
          if (next < sources.length) {
            rowImg.src = sources[next++];
            return;
          }
          rowImg.removeEventListener('error', onError);
          const fallback = createEl('div', '', 'queue-img-fallback', '♪');
          rowImg.replaceWith(fallback);
        };
        rowImg.addEventListener('error', onError);
      }

      row.onclick = (e) => {
        e.stopPropagation();
        const playButton = item.querySelector('.play-button') || item.querySelector('ytmusic-play-button-renderer');
        if (playButton) {
          playButton.click();
        } else {
          item.click();
        }
        setTimeout(() => this.syncQueue(), 500);
      };

      return { el: row, dedupeKey: videoId || uniqueKey };
    }
  };
