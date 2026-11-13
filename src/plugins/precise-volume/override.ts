/* what */

const ignored = {
  id: ['volume-slider', 'expand-volume-slider'],
  types: ['mousewheel', 'keydown', 'keyup'],
} as const;

/**
 * Ignores YTM's own wheel/key listeners on the volume sliders until the page
 * finished loading. Returns a function that restores `addEventListener` if
 * that didn't happen yet.
 */
export const overrideListener = () => {
  // YO WHAT ARE YOU DOING NOW?!?!
  // Save native addEventListener
  // oxlint-disable-next-line typescript/unbound-method
  const original = Element.prototype.addEventListener;
  // Override addEventListener to Ignore specific events in volume-slider
  Element.prototype.addEventListener = function (
    this: Element,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) {
    if (
      !(
        (ignored.id as readonly string[]).includes(this.id) &&
        (ignored.types as readonly string[]).includes(type)
      )
    ) {
      original.call(this, type, listener, options);
    } else if (window.electronIs.dev()) {
      console.log(`Ignoring event: "${this.id}.${type}()"`);
    }
  };

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    Element.prototype.addEventListener = original;
  };

  // Restore original function after finished loading to avoid keeping Element.prototype altered
  if (document.readyState === 'complete') restore();
  else window.addEventListener('load', restore, { once: true });

  return () => {
    window.removeEventListener('load', restore);
    restore();
  };
};
