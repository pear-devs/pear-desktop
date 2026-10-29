// 操作バーを自動で隠す(設定「操作バーを自動で隠す」、初期はオフ)。
//
// Immersion を開いている間、プレイヤーバーを隠しておき、マウスが画面の下の方
// (下から ZONE_PX)に来た時だけ出す。離れて HIDE_DELAY_MS たったら隠す。
// 歌詞とジャケットだけの画面にしたい人向け。
//
// 隠さない時:
//  - バーの上にマウスがある・Tab キーで選んだ所がバーの中にある
//    (フォーカスだけでは決めない。マウスで押したボタンにもフォーカスは残り、
//    YTM も読み込み時にバーのボタンへプログラムでフォーカスを当てる。
//    :focus-within も :focus-visible もそれで成り立ってしまい、隠れなくなった)
//  - バーから開いたメニュー(… や音量)が出ている
//  - マウスの無い(触って操作する)画面。近づける手段が無いので隠すと操作できない
//
// 隠す・出すは <body> の ytm-bar-autohide / ytm-bar-peek で切り替え、見た目は
// style.css が受け持つ。バーの作り(旧バー・新バー・自前の代わりのバー)は
// player-bar.js が付ける印 [data-ytmi-bar] でまとめて当てる。
const BarAutoHide = (() => {
  const STORAGE_KEY = 'ytm_bar_autohide';
  const ZONE_PX = 140;
  const HIDE_DELAY_MS = 700;
  // 開いた時は、バーがあることが分かるように少しだけ出しておく
  const SHOW_ON_OPEN_MS = 1500;

  let enabled = false;
  let hideTimer = null;
  let pointerInZone = false;
  let listening = false;
  // 最後の操作が Tab キーだったか(マウスを押すと戻す)
  let keyboardNav = false;
  let immersionShown = false;

  const canHover = () => {
    try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return true; }
  };

  const barEls = () => document.querySelectorAll('[data-ytmi-bar], #ytmi-fallback-bar');

  // バーから開くメニューは、YTM ではバーの外(ytmusic-popup-container)に出る
  const popupOpen = () => Array.from(document.querySelectorAll('ytmusic-popup-container tp-yt-iron-dropdown'))
    .some((d) => d.style.display !== 'none' && d.getAttribute('aria-hidden') !== 'true');

  const mustStay = () => {
    for (const el of barEls()) {
      if (el.matches(':hover')) return true;
      if (keyboardNav && el.contains(document.activeElement)) return true;
    }
    return popupOpen();
  };

  const setPeek = (on) => document.body?.classList.toggle('ytm-bar-peek', on);

  const show = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    setPeek(true);
  };

  const scheduleHide = (delay = HIDE_DELAY_MS) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (pointerInZone || mustStay()) {
        // メニューを開いたまま離れた時など。閉じるまで待って、もう一度見る
        if (!pointerInZone) scheduleHide();
        return;
      }
      setPeek(false);
    }, delay);
  };

  const onPointerMove = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const inZone = e.clientY >= window.innerHeight - ZONE_PX;
    if (inZone === pointerInZone) return;
    pointerInZone = inZone;
    if (inZone) show();
    else scheduleHide();
  };

  const onLeaveWindow = (e) => {
    if (e.relatedTarget) return;
    pointerInZone = false;
    scheduleHide();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Tab') keyboardNav = true;
  };

  const onPointerDown = () => { keyboardNav = false; };

  const onFocusIn = (e) => {
    const t = e.target;
    if (keyboardNav && t && t.closest && t.closest('[data-ytmi-bar], #ytmi-fallback-bar')) show();
  };

  const onFocusOut = () => scheduleHide();

  const listen = (on) => {
    if (on === listening) return;
    listening = on;
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('pointermove', onPointerMove, { passive: true });
    document[m]('mouseout', onLeaveWindow, { passive: true });
    document[m]('keydown', onKeyDown, true);
    document[m]('pointerdown', onPointerDown, { capture: true, passive: true });
    document[m]('focusin', onFocusIn);
    document[m]('focusout', onFocusOut);
  };

  const apply = () => {
    const on = enabled && canHover();
    document.body?.classList.toggle('ytm-bar-autohide', on);
    listen(on);
    if (!on) {
      clearTimeout(hideTimer);
      hideTimer = null;
      setPeek(false);
      return;
    }
    show();
    scheduleHide(SHOW_ON_OPEN_MS);
  };

  return {
    STORAGE_KEY,
    isEnabled: () => enabled,
    setEnabled: (on) => {
      enabled = !!on;
      apply();
    },
    // 保存値を読んで当てる。歌詞の画面を組む前に呼ぶ
    load: async () => {
      try {
        const v = await storage.get(STORAGE_KEY);
        enabled = v === true;
      } catch (e) { enabled = false; }
      apply();
    },
    // Immersion の出し入れのたびに呼ぶ。開いた瞬間だけ、バーの場所が分かるように少し出す
    syncImmersionShown: (shown) => {
      const opened = shown && !immersionShown;
      immersionShown = !!shown;
      if (!opened || !enabled || !canHover()) return;
      show();
      scheduleHide(SHOW_ON_OPEN_MS);
    },
  };
})();
