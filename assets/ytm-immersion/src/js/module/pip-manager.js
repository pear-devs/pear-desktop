  const PipManager = {
    async start() {
      if (document.pictureInPictureElement) return;


      // 動画モードで開いたら MV の形(16:9)の窓にする
      const videoMode = moviemode === true;
      try {
        this.pipWindow = await documentPictureInPicture.requestWindow(videoMode
          ? { width: 640, height: 360 }
          : { width: 380, height: 600 });
      } catch (e) {
        console.error('PiP failed:', e);
        return;
      }

      // 新しい窓のアイコンは初期状態。前の窓で覚えた値が残っていると
      // 「同じだから触らない」で正しく出ないので、開くたびに忘れる。
      this._lastPlayStateIsPaused = null;

      const pipDoc = this.pipWindow.document;

    
      // ここで document.styleSheets の href を PIP に複製していたが、
      // 拾えるのは YTM 本体の CSS だけ。拡張の CSS は manifest 注入なので
      // styleSheets には href 付きで出てこない。PIP に要らない CSS を
      // 読み込ませるだけだったので外した。PIP の見た目は下の forceStyle と
      // updateLyrics 側が全部持っている。
      
      
      
const forceStyle = pipDoc.createElement('style');
      forceStyle.textContent = `
        /* 画面全体：SF Proへのこだわりと背景の固定 */
        html, body {
          margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background: #000;
          position: fixed; inset: 0;
          font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
          color: #fff; cursor: default;
          -webkit-font-smoothing: antialiased;
        }
        
        #pip-container {
          position: absolute; inset: 0; overflow: hidden;
          isolation: isolate; 
        }
        
        /* 背景レイヤー。明るさは通常画面と同じ値を syncBackgroundBrightness が
           --pip-bg-brightness に入れる(以前は 0.8 固定で、明るいジャケットの
           曲ほど PiP だけ明るく、白い歌詞が沈んでいた)。 */
        #pip-bg-layer {
          position: absolute; inset: -20%;
          background-size: cover; background-position: center;
          filter: blur(80px) saturate(1.4) brightness(var(--pip-bg-brightness, 0.65));
          z-index: -3; transition: background-image 1.2s ease;
        }
        
        #pip-noise-layer {
          position: absolute; inset: 0; z-index: -2; opacity: 0.04; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
        }
        
        /* ヘッダー：アートワークと文字の階層を明確に */
        .pip-header {
            position: absolute; top: 0; left: 0; width: 100%;
            display: flex; flex-direction: row; align-items: center; gap: 14px;
            padding: 28px 24px 10px 24px; box-sizing: border-box;
            z-index: 10; pointer-events: none;
        }
        .artwork-box {
            width: 52px; height: 52px; flex-shrink: 0; 
            border-radius: 8px; overflow: hidden; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            pointer-events: auto;
        }
        .artwork-box img { width: 100%; height: 100%; object-fit: cover; }
        .info-box { 
            flex-grow: 1; text-align: left; 
            display: flex; flex-direction: column; justify-content: center; 
            pointer-events: auto; overflow: hidden;
        }
        #pip-title {
            font-size: 16px; font-weight: 700; margin-bottom: 1px;
            display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
        }
        #pip-artist {
            font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500;
            display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
        }

        /* 歌詞エリア：マスクのグラデーションをより滑らかに */
        #pip-lyrics-container {
            position: absolute; inset: 0;
            overflow-y: auto; text-align: left;
            padding: 120px 24px 160px 24px; 
            box-sizing: border-box;
            mask-image: linear-gradient(to bottom, transparent 0%, transparent 70px, black 120px, black 70%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, transparent 0%, transparent 70px, black 120px, black 70%, transparent 100%);
            -ms-overflow-style: none; scrollbar-width: none;
            z-index: 5; overscroll-behavior: contain;
        }
#pip-lyrics-container::-webkit-scrollbar { display: none; }

        /* ロード中の表示を中央に配置 */
        .lyric-loading {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.2);
            z-index: 1;
            pointer-events: none;
        }

        /* 歌詞が無い曲は歌詞エリアごと畳み、アートワークを主役にする。
           通常ウィンドウの body.ytm-no-lyrics と同じ考え方。
           「見つかりません」と出すより、最初からそういう画面に見せる。 */
        body.ytm-no-lyrics #pip-lyrics-container { display: none !important; }

        body.ytm-no-lyrics .pip-header {
            position: absolute;
            inset: 0;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 18px;
            padding: 48px 28px 150px 28px;
            text-align: center;
        }
        body.ytm-no-lyrics .artwork-box {
            width: 190px; height: 190px;
            border-radius: 14px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.45);
        }
        body.ytm-no-lyrics .info-box {
            flex-grow: 0;
            align-items: center;
            text-align: center;
        }
        body.ytm-no-lyrics #pip-title {
            font-size: 21px; -webkit-line-clamp: 2; margin-bottom: 4px;
        }
        body.ytm-no-lyrics #pip-artist { font-size: 15px; }
        body.ytm-no-lyrics #pip-like-btn {
            position: absolute; top: 20px; right: 20px;
        }

        /* srv3 は動画座標の 16:9 ステージを維持して表示する。 */
        body.ytm-animated-caption-mode #pip-lyrics-container {
          display: block !important;
          left: 50%; top: 50%; right: auto; bottom: auto;
          width: min(100vw, 177.7778vh);
          height: min(56.25vw, 100vh);
          padding: 0;
          overflow: hidden;
          transform: translate(-50%, -50%);
          mask-image: none;
          -webkit-mask-image: none;
        }
        body.ytm-animated-caption-mode .ytm-animated-caption-stage {
          position: relative;
          width: 100%; height: 100%;
          overflow: hidden;
          pointer-events: none;
        }
        body.ytm-animated-caption-mode .ytm-animated-caption-cue {
          position: absolute;
          display: inline-block;
          max-width: none;
          white-space: pre;
          text-wrap: nowrap;
          word-break: keep-all;
          overflow-wrap: normal;
          font-weight: 800;
          line-height: 1.18;
          letter-spacing: 0;
          will-change: opacity, transform;
        }

        .lyric-line {
      
          font-size: 26px !important; 
          font-weight: 800 !important;
          letter-spacing: -0.015em !important;
          margin-bottom: 16px !important; 
          line-height: 1.35 !important;
          
          color: rgba(255, 255, 255, 0.25) !important; 
          filter: blur(1.5px) !important;
          transform: scale(0.85) !important; 
          transform-origin: left center !important; 
          
          /* 以前は transform に cubic-bezier(..., 1.2) を使っており、
             終点を行き過ぎてから戻る＝「もちっと」した動きになっていた。
             オーバーシュートしないカーブに変え、時間も詰めて素直に止める。 */
          transition: transform 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
                      color 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
                      filter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
          
          cursor: pointer !important;
          text-align: left !important; 
          width: 100% !important;
          text-shadow: none !important; 
        }
        
        .lyric-line:hover { 
          color: rgba(255, 255, 255, 0.6) !important; 
        }

        .lyric-line.active {
            color: #fff !important; 
            transform: scale(1) !important; 
            filter: blur(0px) !important; 
            text-shadow: 0 0 20px rgba(255, 255, 255, 0.2) !important; 
        }
        .lyric-line.active .lyric-char { display: inline-block; transition: opacity 0.2s linear; }
        .lyric-line.active .lyric-char.char-pending { opacity: 0.25 !important; }
        .lyric-line.active .lyric-char.char-active { opacity: 1 !important; }

        /* ── Apple Music 風の同期表示（PIP 版）──────────────
           PIP は別文書で、本体の style.css を読んでいない。
           意味は src/css/style.css の同名ブロックと同じ:
             語に --wsweep (語の左端から塗りの先端までの px)
             光る語の中の .lyric-glow に光の影と濃さ(opacity)
           毎フレーム書く変数は inherits: false(本体側の注釈を参照)。
           持ち上がりと膨らみは Web Animations 側(lyrics-ui.js)。
           両方を直す時は必ず片方だけにならないようにすること。
           片方だけ直っていないことを tests/lyrics-apple-sync.test.mjs が見ている。 */
        @property --wsweep { syntax: '<number>'; inherits: false; initial-value: 0; }
        @property --feather { syntax: '<number>'; inherits: false; initial-value: 10; }
        .lyric-line.ytm-word-sync { --ytm-rest-alpha: 0.26; }
        .lyric-line.ytm-word-sync.active { --ytm-rest-alpha: 0.4; }
        /* 下の .lyric-phrase(margin: 0 1px !important)に負けないよう !important。
           負けると引用符などの独立したまとまりの前後に隙間が出る(本体は 0) */
        .lyric-phrase.lyric-phrase-sync { margin: 0 !important; }
        .lyric-line.ytm-word-sync .lyric-word {
          display: inline-block;
          white-space: pre;
          /* transform は Web Animations が合成側で動かす(本体と同じ) */
          transform-origin: 50% 78%;
          transition: none;
        }
        .lyric-line.ytm-word-sync.active .lyric-word {
          /* background-size / background-position は使わないこと。
             画像からはみ出した語が透明になって消える(本体側の注釈を参照)。 */
          background-image: linear-gradient(90deg,
              currentColor calc((var(--wsweep) - var(--feather)) * 1px),
              color-mix(in srgb, currentColor calc(var(--ytm-rest-alpha) * 100%), transparent)
                calc((var(--wsweep) + var(--feather)) * 1px));
          background-repeat: no-repeat;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: none !important;
        }
        /* 光(本体の .lyric-glow と同じ)。影は語ごとに一度だけ JS が書き、濃さは opacity */
        .lyric-line.ytm-word-sync .lyric-word.lyric-word-glow { position: relative; }
        .lyric-line.ytm-word-sync .lyric-glow {
          display: none;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          font-style: inherit;
          -webkit-text-fill-color: transparent;
          pointer-events: none;
          user-select: none;
          opacity: 0;
        }
        .lyric-line.ytm-word-sync.active .lyric-glow { display: block; will-change: opacity; }
        .lyric-line.ytm-word-sync .lyric-glow::before { content: attr(data-t); }
        .lyric-line.ytm-word-sync:not(.active) .lyric-word {
          background-image: none;
          -webkit-text-fill-color: currentColor;
          text-shadow: none !important;
        }

        /* ハモリ(バックボーカル)。本体の style.css の .lyric-bg と同じ。
           PIP は本体の CSS を読まないので、ここに無いと本編と同じ大きさで
           本編の直後に並んでしまう(v2.4.0 の不具合)。ふだんは畳み、行が
           光ったら開く。塗りはハモリ自身の先端で走らせる。 */
        .lyric-bg {
          display: block;
          font-size: 0.6em;
          font-weight: 600;
          line-height: 1.35;
          margin-top: 0;
          max-height: 0;
          opacity: 0;
          overflow: clip;
          overflow-clip-margin: 0.6em;
          transform: translateY(-0.35em);
          transition:
            max-height 0.5s cubic-bezier(0.22, 1, 0.36, 1),
            margin-top 0.5s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
            opacity 0.35s ease;
        }
        .lyric-line.active .lyric-bg {
          margin-top: 0.2em;
          max-height: 6em;
          opacity: 0.72;
          transform: none;
        }
        .lyric-line.sub-vocal .lyric-bg { text-align: right; }

        /* 試作: 韓国語の読み(korean-ruby.js)。本体の style.css と同じ。
           data-ruby は読みを出す設定の時にしか付かないので、入り切りは見ない。 */
        .lyric-main .lyric-ko { display: inline-block; }
        .lyric-main [data-ruby] { text-align: center; }
        .lyric-main [data-ruby]::before {
          content: attr(data-ruby);
          display: block;
          font-size: 0.42em;
          font-weight: 600;
          line-height: 1.3;
          letter-spacing: 0;
          text-align: center;
          white-space: nowrap;
        }

        /* 完了行の表示設定と手動スクロール中の再表示を通常画面と揃える。 */
        #pip-lyrics-container .lyric-line.lyric-past {
          opacity: 0.3 !important;
          visibility: visible;
          pointer-events: auto;
          transition: transform 0.5s, color 0.5s, filter 0.5s,
                      opacity 0.5s ease, visibility 0s !important;
        }
        #pip-lyrics-container.ytm-user-browsing-lyrics .lyric-line.lyric-completed {
          opacity: 0.3 !important;
          visibility: visible;
          pointer-events: auto;
          transition: transform 0.5s, color 0.5s, filter 0.5s,
                      opacity 0.2s ease, visibility 0s !important;
        }
        body.ytm-fade-past-lyrics #pip-lyrics-container:not(.ytm-user-browsing-lyrics) .lyric-line.lyric-completed {
          opacity: 0 !important;
          visibility: hidden;
          pointer-events: none;
          transition: transform 0.5s, color 0.5s, filter 0.5s,
                      opacity 1s ease, visibility 0s linear 1s !important;
        }
        
        .lyric-translation { font-size: 0.6em; opacity: 0.5; font-weight: 600; margin-top: 4px; display: block; }
        
        body.ytm-no-timestamp .lyric-line { 
          color: #fff !important; 
          transform: scale(1) !important; 
          opacity: 1 !important; 
          cursor: default !important; 
          filter: blur(0px) !important; 
          text-shadow: 0 0 10px rgba(0, 0, 0, 0.3) !important; 
        }

        .lyric-line.singer-odd {
          text-align: left !important;
          transform-origin: left center !important;
          padding-left: 0 !important;
          padding-right: 14px !important;
        }
        .lyric-line.singer-even {
          text-align: right !important;
          transform-origin: right center !important;
          padding-left: 14px !important;
          padding-right: 0 !important;
        }
        .lyric-line.singer-even .lyric-main,
        .lyric-line.singer-even .lyric-singer-name { text-align: right !important; }
        .lyric-line.singer-odd .lyric-main,
        .lyric-line.singer-odd .lyric-singer-name { text-align: left !important; }
        .lyric-singer-name {
          display: block;
          margin-bottom: 3px;
          font-size: 0.42em;
          font-weight: 700;
          letter-spacing: 0.04em;
          opacity: 0.72;
        }
        body.ytm-singer-colors-enabled .lyric-line[data-singer-color],
        body.ytm-singer-colors-enabled .lyric-line[data-singer-color].active,
        body.ytm-singer-colors-enabled.ytm-no-timestamp .lyric-line[data-singer-color] {
          color: var(--ytm-singer-color) !important;
        }

        /* 薄い行は字を不透明で描いて本文ごと薄める(本体の style.css の
           .lyric-main と同じ)。行の rgba のまま描くと、詰めた字間で重なる所
           (tt の横棒など)だけ 2 回塗られて明るく浮く。濃さは元の 0.25 / 0.6。 */
        body:not(.ytm-no-timestamp) .lyric-line:not(.active) .lyric-main {
          color: #fff;
          opacity: 0.25;
          transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        body:not(.ytm-no-timestamp) .lyric-line:not(.active):hover .lyric-main {
          opacity: 0.6;
        }
        body.ytm-singer-colors-enabled .lyric-line[data-singer-color] .lyric-main {
          color: inherit !important;
          opacity: 1 !important;
        }

        .lyric-line {
          text-wrap: balance !important;
          word-break: keep-all !important;     
          overflow-wrap: break-word !important; 
        }
        .lyric-phrase {
          display: inline-block !important;       
          margin: 0 1px !important;           
        }
        
        .controls-box { 
            position: absolute; bottom: 0; left: 0; width: 100%;
            display: flex; align-items: center; justify-content: center; gap: 36px; 
            padding: 30px 0 50px 0; box-sizing: border-box;
            z-index: 20; 
            background: linear-gradient(to top, rgba(0,0,0,0.15) 0%, transparent 100%);
            pointer-events: none; 
        }
        .control-btn {
            pointer-events: auto;
            background: rgba(255, 255, 255, 0.1); border: none;
            border-radius: 50%; 
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #fff; transition: all 0.2s ease;
        }
        .control-btn:hover { background: rgba(255, 255, 255, 0.2); transform: scale(1.05); }
        .control-btn:active { transform: scale(0.92); background: rgba(255, 255, 255, 0.3); }
        .control-btn svg { fill: currentColor; pointer-events: none; }
        
        .main-btn { width: 52px; height: 52px; }
        .main-btn svg { width: 32px; height: 32px; }
        .sub-btn { width: 42px; height: 42px; }
        .sub-btn svg { width: 20px; height: 20px; }
        
        .top-right-btn { width: 36px; height: 36px; flex-shrink: 0; background: rgba(255, 255, 255, 0.1); }
        .top-right-btn svg { width: 18px; height: 18px; }
        .top-right-btn.liked { color: #ffffff; }

        /* ── 動画モードの PiP ──────────────────────────────
           窓の形で 2 通りに並べる。
           ・横長(動画モードで開いた 16:9 の窓): 映像を全面に映し、歌詞は
             右下に右揃えで重ねる。見せるのは今の行と次の行だけ。
             曲名はいつも左上に出し、操作ボタンはマウスが乗っている間だけ出す。
           ・縦長(曲モードで開いた窓のまま動画にした時など): 映像を上に幅いっぱいで
             置き、その下は曲の PiP と同じ(曲名・歌詞の一覧・操作ボタン)。
             縦長の窓に映像を全面で収めると、上下が黒い帯だらけになる。 */
        #pip-video { display: none; }
        body.ytm-pip-video #pip-video {
          display: block; position: absolute; left: 0; pointer-events: none; background: #000;
        }

        /* 動画モードは、今の行以外もぼかさない(本体の動画モードと同じ)。
           映像の上の字は、ぼかすと滲んで読みにくい */
        body.ytm-pip-video .lyric-line,
        body.ytm-pip-video .lyric-line.active {
          filter: none !important;
        }

        @media (min-aspect-ratio: 5/4) {
          body.ytm-pip-video #pip-video {
            top: 0; width: 100%; height: 100%; object-fit: contain; z-index: -3;
          }
          body.ytm-pip-video #pip-bg-layer,
          body.ytm-pip-video #pip-noise-layer,
          body.ytm-pip-video .artwork-box { display: none; }
          /* 白い歌詞が明るい映像に沈まないよう、下側だけ暗くする */
          body.ytm-pip-video #pip-container::after {
            content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
            background: linear-gradient(to top, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.34) 24%, rgba(0,0,0,0.14) 52%, transparent 100%);
          }
          body.ytm-pip-video .pip-header,
          body.ytm-pip-video.ytm-no-lyrics .pip-header {
            inset: 0 0 auto 0;
            flex-direction: row; justify-content: flex-start; align-items: center;
            gap: 12px; padding: 12px 14px 32px; text-align: left;
            background: linear-gradient(to bottom, rgba(0,0,0,0.65), transparent);
          }
          body.ytm-pip-video.ytm-no-lyrics .info-box { flex-grow: 1; align-items: flex-start; text-align: left; }
          body.ytm-pip-video.ytm-no-lyrics #pip-title { font-size: 16px; -webkit-line-clamp: 1; margin-bottom: 1px; }
          body.ytm-pip-video.ytm-no-lyrics #pip-artist { font-size: 14px; }
          body.ytm-pip-video.ytm-no-lyrics #pip-like-btn { position: static; }
          body.ytm-pip-video .controls-box {
            inset: 0; width: auto; padding: 0; gap: 28px;
            background: rgba(0,0,0,0.3);
          }
          body.ytm-pip-video #pip-title,
          body.ytm-pip-video #pip-artist { text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
          body.ytm-pip-video #pip-artist { color: rgba(255,255,255,0.75); }
          /* ボタンの丸は、すりガラス(backdrop-filter)をやめて暗い色で塗る。
             白 10% + 後ろのぼかしだと、丸の色は真後ろの映像の色そのものになる。
             MV は場面がどんどん変わるので、丸が明るくなったり暗くなったりを
             繰り返してチカチカして見えた(曲の PiP の背景はゆっくり動くので目立たない)。 */
          body.ytm-pip-video .control-btn {
            background: rgba(0, 0, 0, 0.42);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            transition: background-color 0.2s ease, transform 0.2s ease;
          }
          body.ytm-pip-video .control-btn:hover { background: rgba(0, 0, 0, 0.6); }
          body.ytm-pip-video .control-btn:active { background: rgba(0, 0, 0, 0.7); }
          body.ytm-pip-video .controls-box { opacity: 0; transition: opacity 0.25s ease; }
          body.ytm-pip-video:hover .controls-box { opacity: 1; }
          body.ytm-pip-video:not(:hover) .control-btn { pointer-events: none; }
          /* ★だけはボタンなので、操作ボタンと同じく乗った時だけ */
          body.ytm-pip-video #pip-like-btn { opacity: 0; transition: opacity 0.25s ease; }
          body.ytm-pip-video:hover #pip-like-btn { opacity: 1; }

          /* 歌詞は本体の動画モード(style.css の #ytm-lyrics-stage.moviemode)と
             同じ作り: 右寄りの帯に右揃え、前後の行は薄く、字の後ろに柔らかい影。
             大きさは窓に合わせて縮める。 */
          /* 見せるのは今の行と次の行の 2 行。帯の高さを行 2 本ぶん(1 行 = 行の高さ
             1.35em + 行間 0.45em)にして、今の行を帯の上端に止める
             (--ytm-lyrics-anchor-top-lines: 0。lyrics-ui.js が読む)。
             以前は帯が窓の 52% あり、今の行を真ん中に置いていたので、前の行・
             今の行・次の行の 3 行が見えていた。字の大きさは行(.lyric-line)と同じ式。
             下の余白は、最後の行も帯の上端まで上がれるぶん。 */
          body.ytm-pip-video:not(.ytm-animated-caption-mode) #pip-lyrics-container {
            top: auto; left: 36%; right: 5%; bottom: 5%;
            font-size: clamp(15px, 3.6vw, 34px);
            height: 3.6em;
            padding: 0 0 3.6em 0;
            --ytm-lyrics-anchor-top-lines: 0;
            text-align: right;
            /* 上下の端だけぼかして、行が入れ替わる時に切れ目が見えないようにする。
               上は今の行の字に掛からない幅(行の高さ 1.35em の上の余白 0.17em の中) */
            mask-image: linear-gradient(to bottom, transparent 0, black 0.15em, black calc(100% - 0.3em), transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 0.15em, black calc(100% - 0.3em), transparent 100%);
          }
          body.ytm-pip-video .lyric-line,
          body.ytm-pip-video .lyric-line.singer-odd,
          body.ytm-pip-video .lyric-line.singer-even {
            font-size: clamp(15px, 3.6vw, 34px) !important;
            font-weight: 700 !important;
            margin-bottom: 0.45em !important;
            padding: 0 !important;
            text-align: right !important;
            transform-origin: right center !important;
          }
          body.ytm-pip-video .lyric-line,
          body.ytm-pip-video .lyric-line.active {
            text-shadow: 0 2px 14px rgba(0, 0, 0, 0.45) !important;
          }
          body.ytm-pip-video .lyric-line .lyric-main,
          body.ytm-pip-video .lyric-line .lyric-singer-name { text-align: right !important; }
          body.ytm-pip-video:not(.ytm-no-timestamp) .lyric-line:not(.active) .lyric-main { opacity: 0.4; }
        }

        @media not all and (min-aspect-ratio: 5/4) {
          body.ytm-pip-video #pip-video {
            top: 0; width: 100%; height: 56.25vw; object-fit: cover; z-index: 6;
            box-shadow: 0 8px 30px rgba(0,0,0,0.35);
          }
          body.ytm-pip-video .artwork-box { display: none; }
          body.ytm-pip-video .pip-header { top: 56.25vw; padding: 14px 24px 10px; }
          body.ytm-pip-video:not(.ytm-animated-caption-mode) #pip-lyrics-container {
            top: calc(56.25vw + 64px);
            padding-top: 24px;
            mask-image: linear-gradient(to bottom, transparent 0%, black 40px, black 70%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 40px, black 70%, transparent 100%);
          }
          body.ytm-pip-video.ytm-no-lyrics .pip-header {
            inset: 56.25vw 0 0 0; padding: 24px 28px 150px;
          }
        }
      `;
      
            
            
            pipDoc.head.appendChild(forceStyle);
      this.syncBackgroundBrightness();
      pipDoc.body.className = 'ytm-pip-mode';
      if (document.body.classList.contains('ytm-no-lyrics')) pipDoc.body.classList.add('ytm-no-lyrics');
      if (document.body.classList.contains('ytm-no-timestamp')) pipDoc.body.classList.add('ytm-no-timestamp');
      if (document.body.classList.contains('ytm-animated-caption-mode')) pipDoc.body.classList.add('ytm-animated-caption-mode');
      if (document.body.classList.contains('ytm-keep-past-lyrics')) pipDoc.body.classList.add('ytm-keep-past-lyrics');
      if (document.body.classList.contains('ytm-fade-past-lyrics')) pipDoc.body.classList.add('ytm-fade-past-lyrics');
      if (document.body.classList.contains('ytm-singer-colors-enabled')) pipDoc.body.classList.add('ytm-singer-colors-enabled');
      if (videoMode) pipDoc.body.classList.add('ytm-pip-video');

      // 曲名・アーティスト名・画像 URL は YTM から来る文字列。そのまま
      // innerHTML に入れると "<" ひとつで PIP の中身が崩れる。
      const artworkUrl = escapeHtml(ui.artwork.querySelector('img')?.src || '');
      const pipTitle = escapeHtml(ui.title.textContent);
      const pipArtist = escapeHtml(ui.artist.textContent);
      
pipDoc.body.innerHTML = `
        <div id="pip-container">
            <video id="pip-video" muted playsinline></video>
            <div id="pip-bg-layer" style="background-image: url('${artworkUrl}')"></div>
            <div id="pip-noise-layer"></div>
            
            <div class="pip-header">
                <div class="artwork-box">
                    <img id="pip-img" src="${artworkUrl}" alt="">
                </div>
                <div class="info-box">
                    <div id="pip-title">${pipTitle}</div>
                    <div id="pip-artist">${pipArtist}</div>
                </div>
                <button id="pip-like-btn" class="control-btn top-right-btn">
                    <svg viewBox="0 0 24 24"><path id="pip-like-icon-path" d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>
                </button>
            </div>

            <div id="pip-lyrics-container"></div>
            
            <div class="controls-box">
                <button id="pip-prev-btn" class="control-btn sub-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button id="pip-play-pause-btn" class="control-btn main-btn">
                    <svg id="pip-play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="pip-pause-icon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <button id="pip-next-btn" class="control-btn sub-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                </button>
            </div>
        </div>
      `;

      this.pipLyricsContainer = pipDoc.getElementById('pip-lyrics-container');
      this.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      this.pipLyricsContainer._lastScrolledIndex = -1;
      this.pipLyricsContainer._isUserScrolling = false;
      this.pipLyricsContainer._isProgrammaticScrolling = false;
      let userScrollPipTimeout = null;

      const handleUserScroll = (event) => {
        if (!this.pipLyricsContainer) return;
        // 行が変わるたびに自動スクロールが scrollTop を書くので、その
        // scroll イベントをユーザー操作と取り違えない
        // (lyrics-ui の requestLyricScroll がこの時刻を置く)。
        const directInput = event.type !== 'scroll';
        if (!directInput && performance.now() < (this.pipLyricsContainer._suppressUserScrollUntil || 0)) return;
        if (!directInput && this.pipLyricsContainer._isProgrammaticScrolling) {
          this.pipLyricsContainer._isProgrammaticScrolling = false;
          return;
        }
        this.pipLyricsContainer._isUserScrolling = true;
        this.pipLyricsContainer._isProgrammaticScrolling = false;
        this.pipLyricsContainer._ytmResumeFadeAfterScroll = false;
        this.pipLyricsContainer.classList.add('ytm-user-browsing-lyrics');
        clearTimeout(userScrollPipTimeout);
        userScrollPipTimeout = setTimeout(() => {
          if (this.pipLyricsContainer) {
            this.pipLyricsContainer._isUserScrolling = false;
            this.pipLyricsContainer._lastScrolledIndex = -1;
            this.pipLyricsContainer._ytmResumeFadeAfterScroll = true;
          }
        }, 3000);
      };
      for (const type of ['scroll', 'wheel', 'touchmove']) {
        this.pipLyricsContainer.addEventListener(type, handleUserScroll, { passive: true });
      }
      this.pipLyricsContainer.addEventListener('keydown', (event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) handleUserScroll(event);
      });

      const likeBtn = pipDoc.getElementById('pip-like-btn');
      const prevBtn = pipDoc.getElementById('pip-prev-btn'); // ★ 追加
      const playBtn = pipDoc.getElementById('pip-play-pause-btn');
      const nextBtn = pipDoc.getElementById('pip-next-btn');

      likeBtn.addEventListener('click', () => {
        // 押したら、YTM 側が切り替わるのを待って何度か読み直す
        // (通信を挟むので、1 回だけだと切り替わる前を読んで変わらないように見える)
        if (PlayerBar.toggleLike()) {
          [150, 600, 1500].forEach(ms => setTimeout(() => PipManager.updateLikeState(pipDoc), ms));
        }
      });

      prevBtn.addEventListener('click', () => {
        const prevWrapper = document.querySelector('ytmusic-player-bar .previous-button, ytmusic-miniplayer .ytmusicPlayerControlsPreviousButton') || document.querySelector('ytmusic-player-bar [aria-label="前へ"]') || document.querySelector('ytmusic-player-bar [aria-label="Previous track"]');
        if (prevWrapper) {
          const btn = prevWrapper.querySelector('button') || prevWrapper.querySelector('tp-yt-paper-icon-button') || prevWrapper;
          btn.click();
        } else {
          // バーの作りが変わってボタンが見つからない時は、YTM のキー操作で送る
          PlayerBar.controls.prev();
        }
      });

      playBtn.addEventListener('click', () => {
        const wrapper = document.querySelector('ytmusic-player-bar #play-pause-button, ytmusic-miniplayer .ytmusicPlayerControlsPlayPauseButton') || document.querySelector('ytmusic-player-bar .play-pause-button');
        if (wrapper) {
          const btn = wrapper.querySelector('button') || wrapper.querySelector('tp-yt-paper-icon-button') || wrapper;
          btn.click();
        } else {
          const v = document.querySelector('video');
          if (v) v.paused ? v.play() : v.pause();
        }
      });

      nextBtn.addEventListener('click', () => {
        const nextWrapper = document.querySelector('ytmusic-player-bar .next-button, ytmusic-miniplayer .ytmusicPlayerControlsNextButton') || document.querySelector('ytmusic-player-bar [aria-label="次へ"]') || document.querySelector('ytmusic-player-bar [aria-label="Next track"]');
        if (nextWrapper) {
          const btn = nextWrapper.querySelector('button') || nextWrapper.querySelector('tp-yt-paper-icon-button') || nextWrapper;
          btn.click();
        } else {
          PlayerBar.controls.next();
        }
      });

      PipManager.updateLikeState(pipDoc);
      this.syncVideoMode();

      const videoEl = document.querySelector('video');
      PipManager.updatePlayState(videoEl ? videoEl.paused : true);

      this.pipLyricsContainer.addEventListener('click', (e) => {
        const target = e.target.closest('.lyric-line');
        if (!target) return;
        const timeStr = target.dataset.startTime;
        if (timeStr) {
          const time = parseFloat(timeStr);
          // ズレ直しのぶんも合わせる(lyrics-ui.js の seekToLyricTime)
          if (!isNaN(time)) seekToLyricTime(time);
        }
      });

      // 窓の大きさを変えたら、今の行の位置を測り直す。次の行に移るまで
      // 前の大きさで測った位置のままで、今の行が枠の外に出ていた
      // (本体の窓と同じ recenterLyricsAfterResize。止める位置・動いている行も捨てる)
      this.pipWindow.addEventListener('resize', () => {
        if (this.pipLyricsContainer) recenterLyricsAfterResize();
      });

      // 開閉時はウィンドウが切り替わるので、ループを張り直す必要がある。
      // startLyricRafLoop() は実行中ガードで弾かれてしまう。
      (window.restartLyricRafLoop || startLyricRafLoop)();

      this.pipWindow.addEventListener('pagehide', () => {
        // 閉じた窓の歌詞の行を抱えたままにしない(文書ごと残る。lyrics-ui.js の
        // forgetDetachedLyricMotionRows)。閉じた時点ではまだ繋がっているので、
        // 窓が片付いた後に外す
        setTimeout(() => { if (typeof forgetDetachedLyricMotionRows === 'function') forgetDetachedLyricMotionRows(); }, 0);
        this.detachVideo();
        this.pipWindow = null;
        this.pipLyricsContainer = null;
        this._lastPlayStateIsPaused = null;
        (window.restartLyricRafLoop || startLyricRafLoop)();
      });
    },

    pipWindow: null,
    pipLyricsContainer: null,

    // ── 動画モードの PiP に MV を映す ─────────────────────────
    // YTM の video 要素は動かさない(動かすとプレイヤーが壊れる)。
    // captureStream で映像だけを写し取り、PiP の video に流す。
    // 音は本体から出ているので、写しの音は止めて持たない。
    // 写しは PiP が動画モードで開いている間だけ持つ(閉じたら止める)。
    _videoStream: null,
    _videoSource: null,
    _onVideoSourceLoaded: null,

    // 曲/動画が切り替わった時・PiP を開いた時・曲が変わった時に呼ぶ
    syncVideoMode: function () {
      const pipDoc = this.pipWindow?.document;
      if (!pipDoc?.body) return;
      const on = moviemode === true;
      const was = pipDoc.body.classList.contains('ytm-pip-video');
      pipDoc.body.classList.toggle('ytm-pip-video', on);
      // 歌詞の帯の形と、今の行を止める位置が変わるので、位置を出し直す
      if (was !== on && this.pipLyricsContainer && typeof recenterLyricsAfterResize === 'function') {
        recenterLyricsAfterResize();
      }
      if (!on) {
        this.detachVideo();
        return;
      }
      const source = document.querySelector('#movie_player video') || document.querySelector('video');
      const live = this._videoStream?.getVideoTracks().some(t => t.readyState === 'live');
      if (source && (source !== this._videoSource || !live)) this.attachVideo(source);
    },

    attachVideo: function (source) {
      const el = this.pipWindow?.document?.getElementById('pip-video');
      if (!el || typeof source.captureStream !== 'function') return;
      this.detachVideo();
      let stream;
      try {
        stream = source.captureStream();
      } catch (e) {
        // 写し取れない動画(保護付きなど)。歌詞の画面のまま、背景は黒
        console.warn('[YTM] PiP に動画を写せない', e);
        return;
      }
      stream.getAudioTracks().forEach(t => { stream.removeTrack(t); t.stop(); });
      el.srcObject = stream;
      el.play().catch(() => {});
      this._videoStream = stream;
      this._videoSource = source;
      // YTM は曲が変わると同じ video 要素に別の映像を読み込む。その時、
      // 写しの映像は終わって新しく足される。読み込み終わったら写し直す
      this._onVideoSourceLoaded = () => this.syncVideoMode();
      source.addEventListener('loadeddata', this._onVideoSourceLoaded);
    },

    detachVideo: function () {
      if (this._videoSource && this._onVideoSourceLoaded) {
        this._videoSource.removeEventListener('loadeddata', this._onVideoSourceLoaded);
      }
      this._videoStream?.getTracks().forEach(t => t.stop());
      const el = this.pipWindow?.document?.getElementById('pip-video');
      if (el) el.srcObject = null;
      this._videoStream = null;
      this._videoSource = null;
      this._onVideoSourceLoaded = null;
    },

    toggle: async function () {
      if (this.pipWindow) {
        this.pipWindow.close();
        return;
      }
      await this.start();
    },

    // 背景の明るさを通常画面に合わせる。
    // 通常画面は「背景の明るさ」× ジャケットごとの減光(--ytm-bg-art-dim)。
    // PiP は別文書で本体の CSS 変数が届かないので、掛けた値を渡す。
    // 呼ぶ所: 開いた時・明るさを動かした時・保存/取り消し・曲が変わって減光が変わった時。
    syncBackgroundBrightness: function () {
      const root = this.pipWindow?.document?.documentElement;
      if (!root) return;
      const css = getComputedStyle(document.documentElement);
      // 0 (真っ黒)もそのまま渡す。`|| 既定値` だと 0 が既定値に化けていた
      const raw = parseFloat(css.getPropertyValue('--ytm-bg-brightness'));
      const brightness = Number.isFinite(raw) ? raw : DEFAULT_BG_BRIGHTNESS;
      const dim = parseFloat(css.getPropertyValue('--ytm-bg-art-dim')) || 1;
      root.style.setProperty('--pip-bg-brightness', (brightness * dim).toFixed(3));
    },

    // タブを離れた時に自動で開く(設定「タブを離れた時に PiP を開く」)。
    //
    // PiP はふつうユーザー操作が無いと開けない。例外が Chrome 134 からの
    // 自動 PiP で、音の出ている再生中のタブから別のタブへ移った時にだけ、
    // Media Session の "enterpictureinpicture" に登録した処理を操作なしで
    // 呼んでくれる。初めての時は Chrome が「自動で開いてよいか」を尋ねる。
    // 開いた窓は、タブへ戻ると Chrome が閉じる。
    //
    // オフの時は登録を外す(null)。Chrome 142 からは、登録の無いサイトで
    // Chrome が自前で動画の PiP を開くことがあり、それを邪魔しないため。
    setAutoOpen: function (enabled) {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', enabled
          ? () => {
            if (this.pipWindow) return;
            // Immersion を一度も開いていないと、PiP に写す器(ui.*)がまだ無い。
            // 組むだけで画面には出ない(出すかどうかは body のクラス)。
            // requestWindow より前に await を挟まないこと。自動で開ける猶予が切れる。
            if (!ui.lyrics) initLayout();
            void this.start();
          }
          : null);
      } catch (e) {
        // 自動 PiP に対応していない Chrome(133 以前)。設定は効かないだけ
      }
    },

    updateLikeState: function (targetDoc) {
      const doc = targetDoc || (this.pipWindow ? this.pipWindow.document : null);
      if (!doc) return;
      const likeBtn = doc.getElementById('pip-like-btn');
      if (!likeBtn) return;

      // 新旧どちらのバーでも、使っているバーから読む(player-bar.js)
      const isLiked = PlayerBar.readLiked() === true;

      // 星のアイコンのパス定義


      const STAR_OUTLINE = "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z";
      const STAR_FILLED = "M12 17.27L18.18 21l-1.63-7.03L22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

      const likeIconPath = doc.getElementById('pip-like-icon-path');
      if (likeIconPath) {
        likeIconPath.setAttribute('d', isLiked ? STAR_FILLED : STAR_OUTLINE);
      }

      if (isLiked) {
        likeBtn.classList.add('liked');
      } else {
        likeBtn.classList.remove('liked');
      }
    },

    updateMeta: function (title, artist) {
      if (!this.pipWindow) return;
      const pipDoc = this.pipWindow.document;
      const tEl = pipDoc.getElementById('pip-title');
      const aEl = pipDoc.getElementById('pip-artist');
      if (tEl) tEl.textContent = title;
      if (aEl) aEl.textContent = artist;
      // ジャケットはここでは触らない。曲が変わった直後の ui.artwork はまだ
      // 前の曲の画像(新しい画像が読み終わるまで前のを出し続ける作り)で、
      // ここで写すと PiP だけ1曲前のジャケットのまま次の曲まで残っていた。
      // 差し替わった時に updateArtwork が呼ばれる(lyrics-ui.js の placeArtwork)。
      this.updateLikeState(pipDoc);
    },

    updateArtwork: function (src) {
      if (!this.pipWindow || !src) return;
      const pipDoc = this.pipWindow.document;
      const iEl = pipDoc.getElementById('pip-img');
      const bgEl = pipDoc.getElementById('pip-bg-layer');
      if (iEl) iEl.src = src;
      if (bgEl) bgEl.style.backgroundImage = `url("${String(src).replace(/["\\]/g, '\\$&')}")`;
    },

    resetLyrics: function () {
      if (this.pipWindow && this.pipLyricsContainer) {
        // 余計なスタイルを消して、クラスだけで制御
        this.pipLyricsContainer.innerHTML = '<div class="lyric-loading">Loading...</div>';
      }
    },

    // 毎フレーム呼ばれる。状態が変わっていない回は DOM を触らない
    // (getElementById 2 回 + style 書き込み 2 回が毎フレーム走っていた)。
    _lastPlayStateIsPaused: null,

    updatePlayState: function (isPaused) {
      if (!this.pipWindow) return;
      if (isPaused === this._lastPlayStateIsPaused) return;
      this._lastPlayStateIsPaused = isPaused;
      const playIcon = this.pipWindow.document.getElementById('pip-play-icon');
      const pauseIcon = this.pipWindow.document.getElementById('pip-pause-icon');
      if (playIcon && pauseIcon) {
        if (isPaused) {
          playIcon.style.display = 'block';
          pauseIcon.style.display = 'none';
        } else {
          playIcon.style.display = 'none';
          pauseIcon.style.display = 'block';
        }
      }
    }
    
    
  };
