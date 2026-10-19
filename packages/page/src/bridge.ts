// Shape of the bridge the preload exposes on `window.__pear`.
// Command signatures are defined once in @pear/desktop's shared/ipc.ts and
// mirrored here structurally so the page runtime has no dependency on Electron.

export interface Bridge {
  invoke(name: string, ...args: unknown[]): Promise<unknown>;
}

declare global {
  interface Window {
    __pear?: Bridge;
    __pearRuntime?: RuntimeMarker;
  }
}

export interface RuntimeMarker {
  /** performance.now() at the moment the runtime executed. */
  injectedAt: number;
  /** document.readyState when the runtime executed; "loading" means before the page parsed. */
  readyState: DocumentReadyState;
  /** Number of <script> elements already in the document when the runtime executed. */
  scriptsBefore: number;
}
