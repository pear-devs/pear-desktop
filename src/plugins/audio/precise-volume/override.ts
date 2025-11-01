/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

function overrideAddEventListener() {
  // YO WHAT ARE YOU DOING NOW?!?!
  // Save native addEventListener
  // @ts-expect-error - We know what we're doing
  // eslint-disable-next-line @typescript-eslint/unbound-method
  Element.prototype._addEventListener = Element.prototype.addEventListener;
  // Override addEventListener to Ignore specific events in volume-slider
  Element.prototype.addEventListener = function (
    type: string,
    listener: (event: Event) => void,
    useCapture = false,
  ) {
    if (!(ignored.id.includes(this.id) && ignored.types.includes(type))) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      (this as any)._addEventListener(type, listener, useCapture);
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
      /* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access */
      Element.prototype.addEventListener = (
        Element.prototype as any
      )._addEventListener;
      (Element.prototype as any)._addEventListener = undefined;
      /* eslint-enable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-member-access */
    },
    { once: true },
  );
};
