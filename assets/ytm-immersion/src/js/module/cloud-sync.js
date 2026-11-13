  const CloudSync = (() => {
    if (!EXT || !EXT.runtime) {
      return {
        init() { },
      };
    }

    let statusEl = null;
    let tokenInputEl = null;
    let syncButtonEl = null;
    let panelRoot = null;

    function setStatus(text) {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.title = text;
      }
    }

    function createPanel() {
      const existing = document.getElementById('dr-cloud-sync-panel');
      if (existing) {
        panelRoot = existing;
        statusEl = document.querySelector('#dr-cloud-sync-panel-status');
        tokenInputEl = document.querySelector('#dr-cloud-sync-token-input');
        syncButtonEl = document.querySelector('#dr-cloud-sync-sync-btn');
        return;
      }

      const root = document.createElement('div');
      root.id = 'dr-cloud-sync-panel';
      panelRoot = root;
      root.style.position = 'fixed';
      root.style.zIndex = '2147483647';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.width = '280px';
      root.style.maxWidth = '90vw';
      root.style.borderRadius = '12px';
      root.style.background = 'rgba(10, 10, 15, 0.96)';
      root.style.border = '1px solid rgba(255, 255, 255, 0.12)';
      root.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.6)';
      root.style.color = '#f5f5ff';
      root.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      root.style.fontSize = '12px';
      root.style.padding = '10px 12px';

      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.justifyContent = 'space-between';
      titleRow.style.marginBottom = '6px';

      const title = document.createElement('div');
      title.textContent = 'Daily Replay クラウド同期';
      title.style.fontSize = '13px';
      title.style.fontWeight = '600';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.border = 'none';
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#aaa';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '14px';
      closeBtn.style.lineHeight = '1';
      closeBtn.style.Padding = '0 4px';
      closeBtn.addEventListener('click', () => {
        root.style.display = 'none';
      });

      titleRow.appendChild(title);
      titleRow.appendChild(closeBtn);

      const desc = document.createElement('div');
      desc.textContent =
        '「復活の呪文」を使って履歴をサーバーと同期します。';
      desc.style.marginBottom = '6px';
      desc.style.color = '#b0b4d0';
      desc.style.lineHeight = '1.4';

      const tokenLabel = document.createElement('div');
      tokenLabel.textContent = '復活の呪文（ID）';
      tokenLabel.style.fontSize = '11px';
      tokenLabel.style.marginBottom = '2px';
      tokenLabel.style.color = '#d0d4ff';

      const tokenInput = document.createElement('input');
      tokenInput.id = 'dr-cloud-sync-token-input';
      tokenInput.type = 'text';
      tokenInput.placeholder = '例: dr_XXXXXXXXXXXXXXXX';
      tokenInput.style.width = '100%';
      tokenInput.style.boxSizing = 'border-box';
      tokenInput.style.borderRadius = '6px';
      tokenInput.style.border = '1px solid rgba(255,255,255,0.2)';
      tokenInput.style.background = 'rgba(5,5,10,0.9)';
      tokenInput.style.color = '#f5f5ff';
      tokenInput.style.padding = '4px 6px';
      tokenInput.style.fontSize = '12px';
      tokenInput.style.marginBottom = '4px';

      const tokenHelpRow = document.createElement('div');
      tokenHelpRow.style.display = 'flex';
      tokenHelpRow.style.justifyContent = 'space-between';
      tokenHelpRow.style.alignItems = 'center';
      tokenHelpRow.style.marginBottom = '6px';

      const tokenHelp = document.createElement('div');
      tokenHelp.textContent =
        '※ Discord ログイン後に表示される復活の呪文を入力。';
      tokenHelp.style.fontSize = '10px';
      tokenHelp.style.color = '#8f93b8';
      tokenHelp.style.marginRight = '4px';

      const loginLinkBtn = document.createElement('button');
      loginLinkBtn.textContent = 'ログインページ';
      loginLinkBtn.style.fontSize = '10px';
      loginLinkBtn.style.borderRadius = '999px';
      loginLinkBtn.style.border = 'none';
      loginLinkBtn.style.padding = '4px 8px';
      loginLinkBtn.style.cursor = 'pointer';
      loginLinkBtn.style.background = '#5865F2';
      loginLinkBtn.style.color = '#fff';
      loginLinkBtn.addEventListener('click', () => {
        openLoginPage();
      });

      tokenHelpRow.appendChild(tokenHelp);
      tokenHelpRow.appendChild(loginLinkBtn);

      const buttonRow = document.createElement('div');
      buttonRow.style.display = 'flex';
      buttonRow.style.gap = '6px';
      buttonRow.style.marginBottom = '4px';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '復活の呪文を保存';
      saveBtn.style.flex = '1';
      saveBtn.style.borderRadius = '999px';
      saveBtn.style.border = 'none';
      saveBtn.style.padding = '5px 8px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.background = '#4f8bff';
      saveBtn.style.color = '#fff';
      saveBtn.style.fontSize = '11px';
      saveBtn.style.fontWeight = '600';

      const syncBtn = document.createElement('button');
      syncBtn.id = 'dr-cloud-sync-sync-btn';
      syncBtn.textContent = '今すぐ同期';
      syncBtn.style.flex = '0 0 auto';
      syncBtn.style.borderRadius = '999px';
      syncBtn.style.border = 'none';
      syncBtn.style.padding = '5px 10px';
      syncBtn.style.cursor = 'pointer';
      syncBtn.style.background = '#1db954';
      syncBtn.style.color = '#fff';
      syncBtn.style.fontSize = '11px';
      syncBtn.style.fontWeight = '600';
      syncBtn.disabled = true;
      syncBtn.style.opacity = '0.5';

      saveBtn.addEventListener('click', () => {
        const token = tokenInput.value.trim();
        if (!token) {
          setStatus('復活の呪文を入力してください。');
          return;
        }
        saveRecoveryToken(token);
      });

      syncBtn.addEventListener('click', () => {
        syncBtn.disabled = true;
        syncBtn.style.opacity = '0.5';
        setStatus('同期中...');
        syncNow().finally(() => {
          syncBtn.disabled = false;
          syncBtn.style.opacity = '1';
        });
      });

      const status = document.createElement('div');
      status.id = 'dr-cloud-sync-panel-status';
      status.textContent = '状態: 復活の呪文が未設定です。';
      status.style.fontSize = '10px';
      status.style.color = '#b0b4d0';
      status.style.marginTop = '2px';
      status.style.whiteSpace = 'pre-wrap';

      root.appendChild(titleRow);
      root.appendChild(desc);
      root.appendChild(tokenLabel);
      root.appendChild(tokenInput);
      root.appendChild(tokenHelpRow);
      buttonRow.appendChild(saveBtn);
      buttonRow.appendChild(syncBtn);
      root.appendChild(buttonRow);
      root.appendChild(status);

      document.body.appendChild(root);

      statusEl = status;
      tokenInputEl = tokenInput;
      syncButtonEl = syncBtn;

      // ★ パネルを初めて出したときに状態を読み込む
      loadInitialState();
    }

    function saveRecoveryToken(token) {
      EXT.runtime.sendMessage(
        {
          type: 'SAVE_RECOVERY_TOKEN',
          token,
        },
        (resp) => {
          if (!resp || !resp.ok) {
            const errMsg = resp && resp.error ? resp.error : '保存に失敗しました。';
            setStatus('復活の呪文の保存に失敗: ' + errMsg);
            return;
          }
          setStatus('復活の呪文を保存しました。このIDに紐づいてクラウド同期されます。');
          if (syncButtonEl) {
            syncButtonEl.disabled = false;
            syncButtonEl.style.opacity = '1';
          }
        }
      );
    }

    function openLoginPage() {
      EXT.runtime.sendMessage({ type: 'OPEN_LOGIN_PAGE' }, (resp) => {
        if (!resp || !resp.ok) {
          const errMsg = resp && resp.error ? resp.error : 'ログインページを開けませんでした。';
          setStatus('ログインページの起動エラー: ' + errMsg);
          return;
        }
        setStatus(
          'ブラウザでログインページを開きました。ログイン後に復活の呪文をここに貼り付けてください。'
        );
      });
    }

    function getLocalHistory() {
      return new Promise((resolve) => {
        if (!EXT.storage || !EXT.storage.local) {
          resolve([]);
          return;
        }
        EXT.storage.local.get(ReplayManager.HISTORY_KEY, (items) => {
          const value = items && items[ReplayManager.HISTORY_KEY];
          if (Array.isArray(value)) {
            resolve(value);
          } else {
            resolve([]);
          }
        });
      });
    }

    function setLocalHistory(history) {
      return new Promise((resolve) => {
        if (!EXT.storage || !EXT.storage.local) {
          resolve();
          return;
        }
        EXT.storage.local.set({ [ReplayManager.HISTORY_KEY]: history }, () => resolve());
      });
    }

    async function syncNow() {
      try {
        const history = await getLocalHistory();
        const resp = await new Promise((resolve) => {
          EXT.runtime.sendMessage(
            {
              type: 'SYNC_HISTORY',
              history,
            },
            (response) => resolve(response)
          );
        });

        if (!resp || !resp.ok) {
          const errMsg = resp && resp.error ? resp.error : '同期エラー';
          setStatus('同期に失敗しました: ' + errMsg);
          return { ok: false, error: errMsg, raw: resp || null };
        }

        const mergedHistory = Array.isArray(resp.mergedHistory)
          ? resp.mergedHistory
          : Array.isArray(resp.history)
            ? resp.history
            : null;

        if (mergedHistory) {
          await setLocalHistory(mergedHistory);
        }

        const lastSyncAtMs = resp.lastSyncAt || Date.now();
        const lastSyncDate = new Date(lastSyncAtMs);
        const serverCount =
          mergedHistory && Array.isArray(mergedHistory)
            ? mergedHistory.length
            : resp.serverCount || '?';

        setStatus(
          `同期完了: ローカル ${history.length} 件 → サーバー ${serverCount} 件\n最終同期: ${lastSyncDate.toLocaleString()}`
        );

        return {
          ok: true,
          mergedHistory: mergedHistory || null,
          lastSyncAt: lastSyncAtMs,
          serverCount,
        };
      } catch (e) {
        console.error('[DailyReplay Cloud] sync error', e);
        const msg = e && e.message ? e.message : String(e);
        setStatus(
          '同期中にエラーが発生しました: ' + msg
        );
        return { ok: false, error: msg, raw: null };
      }
    }

    // 曲が変わるたびに全履歴(最大 10,000 件)を POST していた。
    // サーバー側 API は全件受け取る作りなので差分は送れない。せめて間隔を空ける。
    const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
    let lastAutoSyncAt = 0;
    let autoSyncInFlight = false;

    // 自動同期の入口。手動の「同期」ボタンは今までどおり syncNow を直接呼ぶ。
    function syncIfDue() {
      const now = Date.now();
      if (autoSyncInFlight) return Promise.resolve(null);
      if (now - lastAutoSyncAt < AUTO_SYNC_INTERVAL_MS) return Promise.resolve(null);
      lastAutoSyncAt = now;
      autoSyncInFlight = true;
      return syncNow()
        .catch((e) => {
          console.warn('[DailyReplay Cloud] auto sync failed', e);
          return null;
        })
        .finally(() => {
          autoSyncInFlight = false;
        });
    }

    function loadInitialState() {
      EXT.runtime.sendMessage({ type: 'GET_CLOUD_STATE' }, (resp) => {
        if (!resp || !resp.ok || !resp.state) {
          setStatus(
            '状態の取得に失敗しました。復活の呪文を設定すると同期できます。'
          );
          return;
        }
        const state = resp.state;
        if (tokenInputEl && state.recoveryToken) {
          tokenInputEl.value = state.recoveryToken;
        }

        if (syncButtonEl) {
          const hasToken = !!state.recoveryToken;
          syncButtonEl.disabled = !hasToken;
          syncButtonEl.style.opacity = hasToken ? '1' : '0.5';
        }

        const lastSyncAt = state.lastSyncAt ? new Date(state.lastSyncAt) : null;
        const lastSyncText = lastSyncAt ? lastSyncAt.toLocaleString() : '未同期';

        setStatus(
          state.recoveryToken
            ? `状態: 復活の呪文が設定されています。\n最終同期: ${lastSyncText}`
            : '状態: 復活の呪文が未設定です。ログインして発行されたIDを入力してください。'
        );
      });
    }

    // ★ 起動時にパネルを出さず、バックグラウンドで静かに同期だけ行う
    function init() {
      if (window.__drCloudSyncInitialized) return;
      window.__drCloudSyncInitialized = true;

      const startAutoSync = () => {
        // 起動時自動同期（トークンが無いときはサーバー側で NO_TOKEN になり、トーストも出さない）
        lastAutoSyncAt = Date.now();
        syncNow()
          .then((result) => {
            if (!result || !result.ok) return;
            // 同期に成功したときだけ右上トースト
            if (typeof showToast === 'function') {
              showToast('Daily Replay のクラウド同期が完了しました');
            }
          })
          .catch((e) => {
            console.warn('[DailyReplay Cloud] auto sync failed', e);
          });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAutoSync);
      } else {
        startAutoSync();
      }
    }

    // Cloud ボタンから開くときだけパネルを生成・表示
    function openPanel() {
      createPanel();
      if (panelRoot) {
        panelRoot.style.display = 'block';
      }
    }

    return { init, openPanel, syncNow, syncIfDue };
  })();

  // ===================== ここから既存 Immersion ロジック =====================

  let currentKey = null;
  let currentLyricsVideoId = null;
  let currentLyricsRecordId = null;
  let currentSingerMetadata = null;
  let currentSingerMetadataKey = '';
  let currentSingerCanonicalLyrics = '';
  let singerMetadataRequestSequence = 0;
  let singerMetadataRequestKey = '';
  let activeLyricsRequestId = null;
  let lyricsRequestSequence = 0;
  let lyricsApplyEpoch = 0;
  let currentLyricsResultPriority = 0;
  let currentLyricsQuality = 0;
  let lyricsData = [];
  let hasTimestamp = false;
  let dynamicLines = null;
  // 正規化(文字単位への展開・行末の補完)を通す前の生データ。
  // dynamicLines は描画用に加工されるので、届いたレスポンスとの突き合わせや
  // キャッシュへの保存はこちらを使う。加工後と比べると必ず不一致になり、
  // 同じ歌詞でも毎回描き直してスクロール位置が飛んでいた。
  let dynamicLinesRaw = null;
  // duet: raw sub vocal LRC (sub.txt) - only lines to show on the right
  let duetSubLyricsRaw = '';
  // duet: dynamic lines for sub.txt (1文字追尾用)
  let duetSubDynamicLines = null;
  // keep last raw lyrics text so we can re-render when sub lyrics arrive later
  let lastRawLyricsText = null;

  let _duetExcludedTimes = new Set();
  let lyricsCandidates = null;
  let selectedCandidateId = null;
  let lastActiveIndex = -1;
  let lyricRafId = null;

  let timeOffset = 0;

  let isFirstSongDetected = true;

  let currentLyricsSource = null;

  let lyricsRequests = null;
  let lyricsConfig = null;
  let lyricsMeaning = null;
  let meaningPanelVisible = false;
  let activeMeaningIndex = -1;

  const ui = {
    bg: null,
    wrapper: null,
    title: null, artist: null, artwork: null,
    lyrics: null, input: null, settings: null,
    btnArea: null, appBtnArea: null, uploadMenu: null, deleteDialog: null,
    meaningPanel: null,
    meaningBtn: null,
    summaryBtn: null,
    meaningSummaryBackdrop: null,
    meaningSummaryDialog: null,
    replayPanel: null,
    queuePanel: null,
    settingsBtn: null,
    lyricsBtn: null
  };

  let hideTimer = null;
  let uploadMenuGlobalSetup = false;
  let deleteDialogGlobalSetup = false;
  let settingsOutsideClickSetup = false;
  let meaningSummaryGlobalSetup = false;
  let toastTimer = null;
  let moviemode = null;
  let movieObserver = null;
  let hoverPreviewCandidateId = null;
  let hoverPreviewMouseX = 0;
  let hoverPreviewMouseY = 0;
  let hoverPreviewRafId = null;
  let hoverPreviewLoading = false;
  let hoverPreviewAnchorEl = null;

  // 曲名が隠れている(.inactive)ことを器にも写す(style.css の ytm-title-inactive)。
  // 以前は CSS の :has(#ytm-custom-title.inactive) で見ていたが、:has() は器の中の
  // スタイルが変わるたびに器・BODY・HTML まで計算し直させる。文字同期は語の塗りを
  // 毎フレーム書くので、毎分 1GB 近いゴミになっていた(2026-10 実測)。
  const syncTitleInactive = () => {
    ui.wrapper?.classList.toggle('ytm-title-inactive', !!ui.title?.classList.contains('inactive'));
  };

  const handleInteraction = () => {
    const targets = [];
    const title = ui.title;
    const artist = ui.artist;
    // 使っているバー。窓を縦長・狭くすると、YTM はプレイヤーページの中に
    // もう 1 つ ytmusic-player-bar(#top-player-bar)を作り、ページの頭から
    // 探すとそちらが先に見つかる。それの印を外しても本物のバーは隠れたままで、
    // 縦長から横長へ戻した動画モードでバーが二度と出なくなっていた(実機)
    const playerBar = (typeof PlayerBar !== 'undefined' && PlayerBar.get())
      || document.querySelector("ytmusic-player-bar, ytmusic-miniplayer");
    // 使うバーが入れ替わった時に、前のバーに付けた印が残らないようにする
    document.querySelectorAll('ytmusic-player-bar.inactive, ytmusic-miniplayer.inactive')
      .forEach(el => { if (el !== playerBar) el.classList.remove('inactive'); });
    const switcher = document.querySelector("ytmusic-av-toggle");
    if (title) targets.push(title);
    if (artist) targets.push(artist);
    if (playerBar) targets.push(playerBar);
    if (switcher) targets.push(switcher);
    if (ui.btnArea) targets.push(ui.btnArea);
    if (ui.meaningPanel && ui.meaningPanel.classList.contains('active')) targets.push(ui.meaningPanel);
    if (ui.meaningSummaryDialog && ui.meaningSummaryDialog.classList.contains('visible')) targets.push(ui.meaningSummaryDialog);
    targets.forEach(element => {
      element.classList.remove('inactive');
    });
    syncTitleInactive();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const isSettingsActive = ui.settings?.classList.contains('active');
      const isReplayActive = ui.replayPanel?.classList.contains('active');
      const isQueueActive = ui.queuePanel?.matches(':hover');
      const isMeaningActive = ui.meaningPanel?.classList.contains('active') && ui.meaningPanel?.matches(':hover');
      const isSummaryActive = ui.meaningSummaryDialog?.classList.contains('visible');
      if (!isSettingsActive && !isReplayActive && !isQueueActive && !isMeaningActive && !isSummaryActive && !targets.some(target => target?.matches(':hover'))) {
        targets.forEach(element => {
          element.classList.add('inactive');
        });
        syncTitleInactive();
      }
    }, 3000);
  };
  const storage = {
    _api: chrome?.storage?.local,
    get: (k) => new Promise(r => {
      if (!storage._api) return r(null);
      storage._api.get([k], res => {
        const val = res ? res[k] : undefined;
        r(val !== undefined ? val : null);
      });
    }),
 
    set: (k, v) => new Promise(resolve => {
      if (storage._api) {
        storage._api.set({ [k]: v }, resolve);
      } else {
        resolve();
      }
    }),

    remove: (k) => new Promise(resolve => {
      if (storage._api) {
        storage._api.remove(k, resolve);
      } else {
        resolve();
      }
    })
    // clear は置かない。「設定をリセット」から呼ばれて再生履歴も歌詞キャッシュも
    // クラウドの復活の呪文も巻き添えで消していた。設定だけを消す処理は
    // lyrics-ui.js の SETTINGS_STORAGE_KEYS 側にある。
  };
