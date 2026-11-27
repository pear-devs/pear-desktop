import { createRoot, getOwner } from 'solid-js';

let dispose: (() => void) | undefined;

export const reactiveOwner = createRoot((disposeRoot) => {
  dispose = disposeRoot;
  return getOwner()!;
});

export const disposeReactiveRoot = () => {
  dispose?.();
  dispose = undefined;
};
