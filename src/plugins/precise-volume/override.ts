/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

type CustomElementPrototype = typeof Element.prototype & {
  _addEventListener?: typeof Element.prototype.addEventListener;
};

function overrideAddEventListener() {
  // YO WHAT ARE YOU DOING NOW?!?!
  // Save native addEventListener
  // @ts-expect-error - We know what we're doing
  // oxlint-disable-next-line typescript/unbound-method
  Element.prototype._addEventListener = Element.prototype.addEventListener;
  // Override addEventListener to Ignore specific events in volume-slider
  Element.prototype.addEventListener = function (
    type: string,
    listener: (event: Event) => void,
    useCapture = false,
  ) {
    if (!(ignored.id.includes(this.id) && ignored.types.includes(type))) {
      (this as CustomElementPrototype)._addEventListener!(type, listener, useCapture);
    } else if (window.electronIs.dev()) {
      console.log(`Ignoring event: "${this.id}.${type}()"`);
    }
  };
}

export const overrideListener = () => {
  overrideAddEventListener();
  // Restore original function after finished loading to avoid keeping Element.prototype altered
  window.addEventListener(
    'load',
    () => {
      Element.prototype.addEventListener = (
        Element.prototype as CustomElementPrototype
      )._addEventListener!;
      (Element.prototype as CustomElementPrototype)._addEventListener = undefined;
    },
    { once: true },
  );
};
