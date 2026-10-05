import { createRoot } from 'solid-js';

const initializers: (() => void)[] = [];
let dispose: (() => void) | undefined;
export const registerReactiveRoot = (initialize: () => void) => {
  initializers.push(initialize);
};
export const startReactiveRoot = () => {
  disposeReactiveRoot();
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    for (const initialize of initializers) initialize();
  });
};
export const disposeReactiveRoot = () => {
  dispose?.();
  dispose = undefined;
};
