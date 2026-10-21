import { Request, type ElectronBlocker } from '@ghostery/adblocker-electron';

import type { WebContents } from 'electron';

// One readiness wait per WebContents, rather than Electron's one wait per
// executeJavaScript call. Dispose also releases waits on hung navigations.
export const installCosmeticInjection = (engine: ElectronBlocker) => {
  const pending = new Map<
    WebContents,
    { promise: Promise<boolean>; cancel: () => void }
  >();
  let disposed = false;

  const ready = (contents: WebContents): Promise<boolean> => {
    if (disposed || contents.isDestroyed()) return Promise.resolve(false);
    if (!contents.isLoadingMainFrame() && contents.getURL())
      return Promise.resolve(true);
    const existing = pending.get(contents);
    if (existing) return existing.promise;

    let finish!: (value: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const complete = (value: boolean) => {
      clearTimeout(timer);
      contents.removeListener('dom-ready', onReady);
      contents.removeListener('did-stop-loading', onReady);
      contents.removeListener('destroyed', onDestroyed);
      contents.removeListener('did-start-navigation', onNavigation);
      pending.delete(contents);
      finish(value);
    };
    const onReady = () => complete(true);
    const onDestroyed = () => complete(false);
    const onNavigation = (
      _event: unknown,
      _url: string,
      isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame && !isInPlace) complete(false);
    };
    const timer = setTimeout(() => complete(false), 30000);
    pending.set(contents, { promise, cancel: onDestroyed });
    contents.once('dom-ready', onReady);
    contents.once('did-stop-loading', onReady);
    contents.once('destroyed', onDestroyed);
    contents.on('did-start-navigation', onNavigation);
    return promise;
  };

  engine.onInjectCosmeticFilters = async (event, url, msg) => {
    const contents = event.sender;
    const frame = event.senderFrame;
    if (disposed || contents.isDestroyed() || !frame) return;
    const { hostname, domain } = Request.fromRawDetails({ url });
    const isFirstRun = msg === undefined;
    const { active, styles, scripts } = engine.getCosmeticsFilters({
      domain,
      hostname,
      url,
      classes: msg?.classes,
      hrefs: msg?.hrefs,
      ids: msg?.ids,
      getBaseRules: isFirstRun,
      getInjectionRules: isFirstRun,
      getExtendedRules: false,
      getRulesFromHostname: isFirstRun,
      getRulesFromDOM: !isFirstRun,
      callerContext: {
        frameId: event.frameId,
        processId: event.processId,
        lifecycle: msg?.lifecycle,
      },
    });
    if (!active || (!styles.length && !scripts.length)) return;
    if (!(await ready(contents)) || disposed || contents.isDestroyed()) return;
    // Do not apply an old document's rules after navigation or frame disposal.
    if (frame.detached || frame.url !== url) return;
    try {
      if (styles.length)
        await contents.insertCSS(styles, { cssOrigin: 'user' });
      if (
        disposed ||
        contents.isDestroyed() ||
        frame.detached ||
        frame.url !== url
      )
        return;
      // Keep each script's original scope and isolate syntax/runtime failures.
      // Readiness is shared above; do not start parallel native loading waits.
      for (const script of scripts) {
        if (
          disposed ||
          contents.isDestroyed() ||
          frame.detached ||
          frame.url !== url
        )
          return;
        try {
          await contents.executeJavaScript(script, true);
        } catch (error) {
          if (
            !disposed &&
            !contents.isDestroyed() &&
            !frame.detached &&
            frame.url === url
          ) {
            console.error('@ghostery/adblocker scriptlet crashed', error);
          }
        }
      }
    } catch (error) {
      if (
        !disposed &&
        !contents.isDestroyed() &&
        !frame.detached &&
        frame.url === url
      ) {
        console.error('Error injecting tracker-blocker cosmetics', error);
      }
    }
  };

  return () => {
    disposed = true;
    for (const wait of pending.values()) wait.cancel();
  };
};
