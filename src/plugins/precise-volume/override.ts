/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

function overrideAddEventListener() {
  // YO WHAT ARE YOU DOING NOW?!?!
  // Save native addEventListener
  // @ts-expect-error - We know what we're doing
  Element.prototype._addEventListener = Element.prototype.addEventListener;
  // Override addEventListener to Ignore specific events in volume-slider
  Element.prototype.addEventListener = function (
    type: string,
    listener: (event: Event) => void,
    useCapture = false,
  ) {
    if (!(ignored.id.includes(this.id) && ignored.types.includes(type))) {
      // biome-ignore lint/suspicious/noExplicitAny: Accessing custom property on Element prototype that stores original addEventListener
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
      Element.prototype.addEventListener =
        // biome-ignore lint/suspicious/noExplicitAny: Restoring original addEventListener from custom property
        (Element.prototype as any)._addEventListener;
      // biome-ignore lint/suspicious/noExplicitAny: Cleaning up custom property after restoration
      (Element.prototype as any)._addEventListener = undefined;
    },
    { once: true },
  );
};
