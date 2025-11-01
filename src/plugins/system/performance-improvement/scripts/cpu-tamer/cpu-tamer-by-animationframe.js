/*

MIT License

Copyright 2021-2025 CY Fung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

/* eslint-disable */

export const injectCpuTamerByAnimationFrame = ((__CONTEXT__) => {
  'use strict';

  const win = this instanceof Window ? this : window;

  // Create a unique key for the script and check if it is already running
  const hkey_script = 'nzsxclvflluv';
  if (win[hkey_script]) throw new Error('Duplicated Userscript Calling'); // avoid duplicated scripting
  win[hkey_script] = true;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => { })().constructor; // hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.
  const PromiseExternal = ((resolve_, reject_) => {
    const h = (resolve, reject) => { resolve_ = resolve; reject_ = reject };
    return class PromiseExternal extends Promise {
      constructor(cb = h) {
        super(cb);
        if (cb === h) {
          /** @type {(value: any) => void} */
          this.resolve = resolve_;
          /** @type {(reason?: any) => void} */
          this.reject = reject_;
        }
      }
    };
  })();

  const isGPUAccelerationAvailable = (() => {
    // https://gist.github.com/cvan/042b2448fcecefafbb6a91469484cdf8
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  })();

  if (!isGPUAccelerationAvailable) {
    throw new Error('Your browser does not support GPU Acceleration. CPU Tamer by AnimationFrame is skipped.');
  }

  const timeupdateDT = (() => {

    window.__j6YiAc__ = 1;

    document.addEventListener('timeupdate', () => {
      window.__j6YiAc__ = Date.now();
    }, true);

    let kz = -1;
    try {
      kz = top.__j6YiAc__;
    } catch (e) {

    }

    return kz >= 1 ? () => top.__j6YiAc__ : () => window.__j6YiAc__;

  })();

  const cleanContext = async (win) => {
    const waitFn = requestAnimationFrame; // shall have been binded to window
    try {
      let mx = 16; // MAX TRIAL
      const frameId = 'vanillajs-iframe-v1'
      let frame = document.getElementById(frameId);
      let removeIframeFn = null;
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = frameId;
        const blobURL = typeof webkitCancelAnimationFrame === 'function' && typeof kagi === 'undefined' ? (frame.src = URL.createObjectURL(new Blob([], { type: 'text/html' }))) : null; // avoid Brave Crash
        frame.sandbox = 'allow-same-origin'; // script cannot be run inside iframe but API can be obtained from iframe
        let n = document.createElement('noscript'); // wrap into NOSCRPIT to avoid reflow (layouting)
        n.appendChild(frame);
        while (!document.documentElement && mx-- > 0) await new Promise(waitFn); // requestAnimationFrame here could get modified by the engine
        const root = document.documentElement;
        root.appendChild(n); // throw error if root is null due to exceeding MAX TRIAL
        if (blobURL) Promise.resolve().then(() => URL.revokeObjectURL(blobURL));

        removeIframeFn = (setTimeout) => {
          const removeIframeOnDocumentReady = (e) => {
            e && win.removeEventListener("DOMContentLoaded", removeIframeOnDocumentReady, false);
            e = n;
            n = win = removeIframeFn = 0;
            setTimeout ? setTimeout(() => e.remove(), 200) : e.remove();
          }
          if (!setTimeout || document.readyState !== 'loading') {
            removeIframeOnDocumentReady();
          } else {
            win.addEventListener("DOMContentLoaded", removeIframeOnDocumentReady, false);
          }
        }
      }
      while (!frame.contentWindow && mx-- > 0) await new Promise(waitFn);
      const fc = frame.contentWindow;
      if (!fc) throw "window is not found."; // throw error if root is null due to exceeding MAX TRIAL
      try {
        const { requestAnimationFrame, setInterval, setTimeout, clearInterval, clearTimeout } = fc;
        const res = { requestAnimationFrame, setInterval, setTimeout, clearInterval, clearTimeout };
        for (let k in res) res[k] = res[k].bind(win); // necessary
        if (removeIframeFn) Promise.resolve(res.setTimeout).then(removeIframeFn);
        return res;
      } catch (e) {
        if (removeIframeFn) removeIframeFn();
        return null;
      }
    } catch (e) {
      console.warn(e);
      return null;
    }
  };

  cleanContext(win).then(__CONTEXT__ => {

    if (!__CONTEXT__) return null;

    const { requestAnimationFrame, setTimeout, setInterval, clearTimeout, clearInterval } = __CONTEXT__;

    /** @type {Function|null} */
    let afInterupter = null;

    const getRAFHelper = () => {
      const asc = document.createElement('a-f');
      if (!('onanimationiteration' in asc)) {
        return (resolve) => requestAnimationFrame(afInterupter = resolve);
      }
      asc.id = 'a-f';
      let qr = null;
      asc.onanimationiteration = function () {
        if (qr !== null) qr = (qr(), null);
      }
      if (!document.getElementById('afscript')) {
        const style = document.createElement('style');
        style.id = 'afscript';
        style.textContent = `
          @keyFrames aF1 {
            0% {
              order: 0;
            }
            100% {
              order: 1;
            }
          }
          #a-f[id] {
            visibility: collapse !important;
            position: fixed !important;
            display: block !important;
            top: -100px !important;
            left: -100px !important;
            margin:0 !important;
            padding:0 !important;
            outline:0 !important;
            border:0 !important;
            z-index:-1 !important;
            width: 0px !important;
            height: 0px !important;
            contain: strict !important;
            pointer-events: none !important;
            animation: 1ms steps(2, jump-none) 0ms infinite alternate forwards running aF1 !important;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }
      document.documentElement.insertBefore(asc, document.documentElement.firstChild);
      return (resolve) => (qr = afInterupter = resolve);
    };

    /** @type {(resolve: () => void)}  */
    const rafPN = getRAFHelper(); // rAF will not execute if document is hidden

    (() => {
      let afPromiseP, afPromiseQ; // non-null
      afPromiseP = afPromiseQ = { resolved: true }; // initial state for !uP && !uQ
      let afix = 0;
      const afResolve = async (rX) => {
        await new Promise(rafPN);
        rX.resolved = true;
        const t = afix = (afix & 1073741823) + 1;
        return rX.resolve(t), t;
      };
      const eFunc = async () => {
        const uP = !afPromiseP.resolved ? afPromiseP : null;
        const uQ = !afPromiseQ.resolved ? afPromiseQ : null;
        let t = 0;
        if (uP && uQ) {
          const t1 = await uP;
          const t2 = await uQ;
          t = ((t1 - t2) & 536870912) === 0 ? t1 : t2; // = 0 for t1 - t2 = [0, 536870911], [–1073741824, -536870913]
        } else {
          const vP = !uP ? (afPromiseP = new PromiseExternal()) : null;
          const vQ = !uQ ? (afPromiseQ = new PromiseExternal()) : null;
          if (uQ) await uQ; else if (uP) await uP;
          if (vP) t = await afResolve(vP);
          if (vQ) t = await afResolve(vQ);
        }
        return t;
      }
      const inExec = new Set();
      const wFunc = async (handler, wStore) => {
        try {
          const ct = Date.now();
          if (ct - timeupdateDT() < 800 && ct - wStore.dt < 800) {
            const cid = wStore.cid;
            inExec.add(cid);
            const t = await eFunc();
            const didNotRemove = inExec.delete(cid); // true for valid key
            if (!didNotRemove || t === wStore.lastExecution) return;
            wStore.lastExecution = t;
          }
          wStore.dt = ct;
          handler();
        } catch (e) {
          console.error(e);
          throw e;
        }
      };
      const sFunc = (propFunc) => {
        return (func, ms = 0, ...args) => {
          if (typeof func === 'function') { // ignore all non-function parameter (e.g. string)
            const wStore = { dt: Date.now() };
            return (wStore.cid = propFunc(wFunc, ms, (args.length > 0 ? func.bind(null, ...args) : func), wStore));
          } else {
            return propFunc(func, ms, ...args);
          }
        };
      };
      win.setTimeout = sFunc(setTimeout);
      win.setInterval = sFunc(setInterval);

      const dFunc = (propFunc) => {
        return (cid) => {
          if (cid) inExec.delete(cid) || propFunc(cid);
        };
      };

      win.clearTimeout = dFunc(clearTimeout);
      win.clearInterval = dFunc(clearInterval);

      try {
        win.setTimeout.toString = setTimeout.toString.bind(setTimeout);
        win.setInterval.toString = setInterval.toString.bind(setInterval);
        win.clearTimeout.toString = clearTimeout.toString.bind(clearTimeout);
        win.clearInterval.toString = clearInterval.toString.bind(clearInterval);
      } catch (e) { console.warn(e) }

    })();

    let mInterupter = null;
    setInterval(() => {
      if (mInterupter === afInterupter) {
        if (mInterupter !== null) afInterupter = mInterupter = (mInterupter(), null);
      } else {
        mInterupter = afInterupter;
      }
    }, 125);
  });

});
