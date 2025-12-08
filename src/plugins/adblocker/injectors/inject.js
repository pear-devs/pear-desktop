/* eslint-disable */

// Source: https://addons.mozilla.org/en-US/firefox/addon/adblock-for-youtube/
// https://robwu.nl/crxviewer/?crx=https%3A%2F%2Faddons.mozilla.org%2Fen-US%2Ffirefox%2Faddon%2Fadblock-for-youtube%2F

/*
  Parts of this code is derived from set-constant.js:
  https://github.com/gorhill/uBlock/blob/5de0ce975753b7565759ac40983d31978d1f84ca/assets/resources/scriptlets.js#L704
  */

let injected = false;

export const isInjected = () => injected;

/**
 * @param {Electron.ContextBridge} contextBridge
 * @returns {*}
 */
export const inject = (contextBridge) => {
  injected = true;
  {
    const pruner = function (o) {
      delete o.playerAds;
      delete o.adPlacements;
      delete o.adSlots;
      //
      if (o.playerResponse) {
        delete o.playerResponse.playerAds;
        delete o.playerResponse.adPlacements;
        delete o.playerResponse.adSlots;
      }
      if (o.ytInitialPlayerResponse) {
        delete o.ytInitialPlayerResponse.playerAds;
        delete o.ytInitialPlayerResponse.adPlacements;
        delete o.ytInitialPlayerResponse.adSlots;
      }

      //
      return o;
    }

    contextBridge.exposeInMainWorld('_pruner', pruner);
  }

  const chains = [
    {
      chain: 'playerResponse.adPlacements',
      cValue: 'undefined',
    },
    {
      chain: 'ytInitialPlayerResponse.playerAds',
      cValue: 'undefined',
    },
    {
      chain: 'ytInitialPlayerResponse.adPlacements',
      cValue: 'undefined',
    },
    {
      chain: 'ytInitialPlayerResponse.adSlots',
      cValue: 'undefined',
    }
  ];

  chains.forEach(function ({ chain, cValue }) {
    const thisScript = document.currentScript;
    //
    switch (cValue) {
      case 'null': {
        cValue = null;
        break;
      }

      case "''": {
        cValue = '';
        break;
      }

      case 'true': {
        cValue = true;
        break;
      }

      case 'false': {
        cValue = false;
        break;
      }

      case 'undefined': {
        cValue = undefined;
        break;
      }

      case 'noopFunc': {
        cValue = function () {};

        break;
      }

      case 'trueFunc': {
        cValue = function () {
          return true;
        };

        break;
      }

      case 'falseFunc': {
        cValue = function () {
          return false;
        };

        break;
      }

      default: {
        if (/^\d+$/.test(cValue)) {
          cValue = Number.parseFloat(cValue);
          //
          if (isNaN(cValue)) {
            return;
          }

          if (Math.abs(cValue) > 0x7f_ff) {
            return;
          }
        } else {
          return;
        }
      }
    }

    //
    let aborted = false;
    const mustAbort = function (v) {
      if (aborted) {
        return true;
      }

      aborted =
        v !== undefined &&
        v !== null &&
        cValue !== undefined &&
        cValue !== null &&
        typeof v !== typeof cValue;
      return aborted;
    };

    /*
    Support multiple trappers for the same property:
    https://github.com/uBlockOrigin/uBlock-issues/issues/156
    */

    const trapProp = function (owner, prop, configurable, handler) {
      if (handler.init(owner[prop]) === false) {
        return;
      }

      //
      const odesc = Object.getOwnPropertyDescriptor(owner, prop);
      let previousGetter;
      let previousSetter;
      if (odesc instanceof Object) {
        if (odesc.configurable === false) {
          return;
        }

        if (odesc.get instanceof Function) {
          previousGetter = odesc.get;
        }

        if (odesc.set instanceof Function) {
          previousSetter = odesc.set;
        }
      }

      //
      Object.defineProperty(owner, prop, {
        configurable,
        get() {
          if (previousGetter !== undefined) {
            previousGetter();
          }

          //
          return handler.getter();
        },
        set(a) {
          if (previousSetter !== undefined) {
            previousSetter(a);
          }

          //
          handler.setter(a);
        },
      });
    };

    const trapChain = function (owner, chain) {
      const pos = chain.indexOf('.');
      if (pos === -1) {
        trapProp(owner, chain, false, {
          v: undefined,
          getter() {
            return document.currentScript === thisScript ? this.v : cValue;
          },
          setter(a) {
            if (mustAbort(a) === false) {
              return;
            }

            cValue = a;
          },
          init(v) {
            if (mustAbort(v)) {
              return false;
            }

            //
            this.v = v;
            return true;
          },
        });
        //
        return;
      }

      //
      const prop = chain.slice(0, pos);
      const v = owner[prop];
      //
      chain = chain.slice(pos + 1);
      if (v instanceof Object || (typeof v === 'object' && v !== null)) {
        trapChain(v, chain);
        return;
      }

      //
      trapProp(owner, prop, true, {
        v: undefined,
        getter() {
          return this.v;
        },
        setter(a) {
          this.v = a;
          if (a instanceof Object) {
            trapChain(a, chain);
          }
        },
        init(v) {
          this.v = v;
          return true;
        },
      });
    };

    //
    trapChain(window, chain);
  });
};
