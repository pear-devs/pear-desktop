/*
 * Source: https://addons.mozilla.org/en-US/firefox/addon/adblock-for-youtube/
 * https://robwu.nl/crxviewer/?crx=https%3A%2F%2Faddons.mozilla.org%2Fen-US%2Ffirefox%2Faddon%2Fadblock-for-youtube%2F
 *
 * Parts of this code is derived from set-constant.js:
 * https://github.com/gorhill/uBlock/blob/5de0ce975753b7565759ac40983d31978d1f84ca/assets/resources/scriptlets.js#L704
 */

import type { ContextBridge } from 'electron';

interface PrunableResponse {
  playerAds?: unknown;
  adPlacements?: unknown;
  adSlots?: unknown;
  playerResponse?: PrunableResponse;
  ytInitialPlayerResponse?: PrunableResponse;
  [key: string]: unknown;
}

type PropertyOwner = Record<string, unknown>;

interface TrapHandler {
  v: unknown;
  init(value: unknown): boolean;
  getter(): unknown;
  setter(value: unknown): void;
}

let injected = false;

export const isInjected = (): boolean => injected;

export const inject = (contextBridge: ContextBridge): void => {
  injected = true;
  {
    const pruner = (o: PrunableResponse): PrunableResponse => {
      delete o.playerAds;
      delete o.adPlacements;
      delete o.adSlots;
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

      return o;
    };

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
    },
  ];

  chains.forEach(({ chain, cValue: rawValue }) => {
    const thisScript = document.currentScript;
    let cValue: unknown;
    switch (rawValue) {
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
        cValue = () => {};

        break;
      }

      case 'trueFunc': {
        cValue = () => true;

        break;
      }

      case 'falseFunc': {
        cValue = () => false;

        break;
      }

      default: {
        if (/^\d+$/.test(rawValue)) {
          const numericValue = Number.parseFloat(rawValue);
          if (Number.isNaN(numericValue)) {
            return;
          }

          if (Math.abs(numericValue) > 0x7f_ff) {
            return;
          }

          cValue = numericValue;
        } else {
          return;
        }
      }
    }

    let aborted = false;
    const mustAbort = (v: unknown): boolean => {
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

    const trapProp = (
      owner: PropertyOwner,
      prop: string,
      configurable: boolean,
      handler: TrapHandler,
    ) => {
      if (!handler.init(owner[prop])) {
        return;
      }

      const odesc = Object.getOwnPropertyDescriptor(owner, prop);
      let previousGetter: (() => unknown) | undefined;
      let previousSetter: ((value: unknown) => void) | undefined;
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

      Object.defineProperty(owner, prop, {
        configurable,
        get() {
          if (previousGetter !== undefined) {
            previousGetter();
          }

          return handler.getter();
        },
        set(a: unknown) {
          if (previousSetter !== undefined) {
            previousSetter(a);
          }

          handler.setter(a);
        },
      });
    };

    const trapChain = (owner: PropertyOwner, chain: string) => {
      const pos = chain.indexOf('.');
      if (pos === -1) {
        trapProp(owner, chain, false, {
          v: undefined,
          getter() {
            return document.currentScript === thisScript ? this.v : cValue;
          },
          setter(a) {
            if (!mustAbort(a)) {
              return;
            }

            cValue = a;
          },
          init(v) {
            if (mustAbort(v)) {
              return false;
            }

            this.v = v;
            return true;
          },
        });
        return;
      }

      const prop = chain.slice(0, pos);
      const v = owner[prop];

      const remainingChain = chain.slice(pos + 1);
      if (v instanceof Object || (typeof v === 'object' && v !== null)) {
        trapChain(v as PropertyOwner, remainingChain);
        return;
      }

      trapProp(owner, prop, true, {
        v: undefined,
        getter() {
          return this.v;
        },
        setter(a) {
          this.v = a;
          if (a instanceof Object) {
            trapChain(a as PropertyOwner, remainingChain);
          }
        },
        init(v) {
          this.v = v;
          return true;
        },
      });
    };

    trapChain(window as unknown as PropertyOwner, chain);
  });
};
