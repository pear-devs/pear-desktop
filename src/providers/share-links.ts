import { stripMusicFromShareUrl } from '../utils/share-url';

const shareInputSelector = 'yt-copy-link-renderer input#share-url';

// The Copy button reads this input's value. Intercept only share inputs, not
// clipboard APIs or the global input prototype, so other app URLs are untouched.
export const setupShareLinks = () => {
  const inputs = new Map<
    HTMLInputElement,
    { update: () => void; restore: () => void }
  >();

  const attach = (input: HTMLInputElement) => {
    if (inputs.has(input)) return;

    const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
    const descriptor =
      ownDescriptor ??
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.get || !descriptor.set || !descriptor.configurable) return;

    const read = () => descriptor.get!.call(input) as string;
    const write = (value: string) => descriptor.set!.call(input, value);
    let original = read();
    let rewritten = stripMusicFromShareUrl(original);

    const update = () => {
      const current = read();
      if (current !== rewritten) original = current;
      rewritten = stripMusicFromShareUrl(original);
      if (current !== rewritten) write(rewritten);
    };

    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: read,
      set(value: string) {
        // A reused panel can receive a new URL through .value without any DOM
        // mutation. Let the original setter normalize the value first.
        write(value);
        original = read();
        rewritten = stripMusicFromShareUrl(original);
        if (original !== rewritten) write(rewritten);
      },
    });

    inputs.set(input, {
      update,
      restore() {
        if (ownDescriptor) {
          Object.defineProperty(input, 'value', ownDescriptor);
        } else {
          Reflect.deleteProperty(input, 'value');
        }
        if (read() === rewritten) write(original);
      },
    });
    update();
  };

  const scan = (root: Element | Document) => {
    if (root instanceof HTMLInputElement && root.matches(shareInputSelector)) {
      attach(root);
    }
    root.querySelectorAll<HTMLInputElement>(shareInputSelector).forEach(attach);
  };

  const observer = new MutationObserver((mutations) => {
    for (const [input, state] of inputs) {
      if (!input.isConnected || !input.matches(shareInputSelector)) {
        state.restore();
        inputs.delete(input);
      }
    }

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const input = mutation.target;
        if (input instanceof HTMLInputElement) {
          if (input.matches(shareInputSelector)) attach(input);
          inputs.get(input)?.update();
        }
      } else {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scan(node);
        }
      }
    }
  });

  return (enabled: boolean) => {
    observer.disconnect();
    if (enabled) {
      scan(document);
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['value', 'id'],
      });
    } else {
      for (const state of inputs.values()) state.restore();
      inputs.clear();
    }
  };
};
