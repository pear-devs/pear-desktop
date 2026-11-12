import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { hideOnClose, onActivate } from "../src/main/close.ts";

function fakeWindow() {
  const window = Object.assign(new EventEmitter(), { hide: vi.fn(), show: vi.fn(), visible: true, destroyed: false });
  return Object.assign(window, { isVisible: () => window.visible, isDestroyed: () => window.destroyed });
}

/** Closes the window; whether closing was prevented. */
const closePrevented = (window: EventEmitter) => {
  const event = { preventDefault: vi.fn() };
  window.emit("close", event);
  return event.preventDefault.mock.calls.length > 0;
};

describe("macOS window lifecycle (pear-desktop's)", () => {
  test("closing hides the window instead, so playback goes on", () => {
    const app = new EventEmitter();
    const window = fakeWindow();
    hideOnClose(app as never, window as never);
    expect(closePrevented(window)).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
  });

  test("quitting still closes it", () => {
    const app = new EventEmitter();
    const window = fakeWindow();
    hideOnClose(app as never, window as never);
    app.emit("before-quit");
    expect(closePrevented(window)).toBe(false);
    expect(window.hide).not.toHaveBeenCalled();
  });

  test("the dock icon shows the same window, or opens one if there is none", () => {
    const create = vi.fn();
    const window = fakeWindow();
    window.visible = false;
    onActivate(window as never, create);
    expect(window.show).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();

    window.visible = true;
    onActivate(window as never, create);
    expect(window.show).toHaveBeenCalledOnce();

    window.destroyed = true;
    onActivate(window as never, create);
    onActivate(undefined, create);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
