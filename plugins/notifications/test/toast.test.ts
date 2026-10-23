import { describe, expect, test } from "vitest";
import { type ToastContent, toastStyleFromNumber, toastXml } from "../toast.ts";

const content: ToastContent = {
  style: "logo",
  title: "Rock & Roll <Live>",
  artist: "Band",
  album: "Album",
  elapsedSeconds: 65,
  durationSeconds: 200,
  paused: false,
  image: "C:\\Users\\me\\art.png",
  icons: { previous: "C:\\i\\previous.png", play: "C:\\i\\play.png", pause: "C:\\i\\pause.png", next: "C:\\i\\next.png" },
  protocol: "app",
};

describe("Windows toast XML", () => {
  test("buttons open the app protocol, play or pause depending on the state", () => {
    const xml = toastXml(content);
    expect(xml).toContain('arguments="app://previous"');
    expect(xml).toContain('arguments="app://pause"');
    expect(xml).toContain('arguments="app://next"');
    expect(xml).toContain('imageUri="file:///C:/i/pause.png"');
    expect(toastXml({ ...content, paused: true })).toContain('arguments="app://play"');
  });

  test("escapes the texts", () => {
    expect(toastXml(content)).toContain("Rock &amp; Roll &lt;Live&gt;");
  });

  test("each style lays the toast out like pear-desktop", () => {
    expect(toastXml(content)).toContain('placement="appLogoOverride"');
    expect(toastXml({ ...content, style: "hero" })).toContain('placement="hero"');
    const custom = toastXml({ ...content, style: "banner_top_custom" });
    expect(custom).toContain(">Album<");
    expect(custom).toContain("1:05 / 3:20");
    expect(toastXml({ ...content, style: "banner_centered_top", title: "Short" })).toContain('hint-style="Header"');
    expect(toastXml({ ...content, style: "banner_centered_top" })).toContain('hint-style="Subheader"');
    const legacy = toastXml({ ...content, style: "legacy" });
    expect(legacy).toContain(`content="${String.fromCodePoint(0x2016)}"`);
    expect(legacy).not.toContain("imageUri");
  });

  test("pear-desktop's numbered styles", () => {
    expect(toastStyleFromNumber(1)).toBe("logo");
    expect(toastStyleFromNumber(4)).toBe("banner_top_custom");
    expect(toastStyleFromNumber(9)).toBeUndefined();
    expect(toastXml({ ...content, style: "banner_top_custom", elapsedSeconds: 59 })).toContain("0:59 / 3:20");
  });
});
