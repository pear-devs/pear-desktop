// pear-desktop's Windows toast layouts (custom toast XML), with playback buttons
// that open its app protocol. See
// https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/toast-schema

import { formatDuration } from "@pear/sdk/util";

export const TOAST_STYLES = [
  "logo",
  "banner_centered_top",
  "hero",
  "banner_top_custom",
  "banner_centered_bottom",
  "banner_bottom",
  "legacy",
] as const;
export type ToastStyle = (typeof TOAST_STYLES)[number];

/** pear-desktop stored the style as a number (1-based, in this order). */
export const toastStyleFromNumber = (value: number): ToastStyle | undefined => TOAST_STYLES[value - 1];

/** Styles that show the artwork as a small square logo (the rest show it as a banner). */
export const usesLogo = (style: ToastStyle) => style === "logo" || style === "legacy";

type Button = "previous" | "play" | "pause" | "next";

// The legacy style's text buttons (pear-desktop's media glyphs).
const GLYPHS: Record<Button, string> = {
  play: String.fromCodePoint(0x1405),
  pause: String.fromCodePoint(0x2016),
  next: String.fromCodePoint(0x1433),
  previous: String.fromCodePoint(0x1438),
};

export interface ToastContent {
  style: ToastStyle;
  title: string;
  artist: string;
  album?: string;
  elapsedSeconds: number;
  durationSeconds: number;
  paused: boolean;
  /** File path of the (logo or banner) image. */
  image: string;
  /** File paths of the button icons. */
  icons: Record<Button, string>;
  /** The app protocol's scheme. */
  protocol: string;
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const fileUri = (path: string) => escape(`file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`);

// Shorter titles get a bigger font in the centered styles: the first style whose length fits.
const TITLE_STYLES: [maxLength: number, style: string][] = [
  [13, "Header"],
  [22, "Subheader"],
  [26, "Title"],
];
const titleStyle = (title: string) => TITLE_STYLES.find(([max]) => title.length <= max)?.[1] ?? "Subtitle";

export function toastXml(content: ToastContent): string {
  const { style, paused } = content;
  const title = escape(content.title);
  const artist = escape(content.artist);
  const image = escape(content.image);

  const button = (kind: Button) => {
    const display = style === "legacy" ? `content="${GLYPHS[kind]}"` : `content="" imageUri="${fileUri(content.icons[kind])}"`;
    return `<action ${display} activationType="protocol" arguments="${content.protocol}://${kind}"/>`;
  };
  const actions = `<actions>${button("previous")}${button(paused ? "play" : "pause")}${button("next")}</actions>`;

  const withImage = (placement: string) =>
    `<image id="1" src="${image}" name="Image" ${placement}/><text id="1">${title}</text><text id="2">${artist}</text>`;
  const centered = `<group><subgroup hint-weight="1" hint-textStacking="center"><text hint-align="center" hint-style="${titleStyle(content.title)}">${title}</text><text hint-align="center" hint-style="SubtitleSubtle">${artist}</text></subgroup></group>`;

  let body: string;
  switch (style) {
    case "hero":
      body = withImage('placement="hero"');
      break;
    case "banner_bottom":
      body = withImage("");
      break;
    case "banner_top_custom": {
      const album = content.album ? `<text hint-style="captionSubtle" hint-wrap="true" hint-align="right">${escape(content.album)}</text>` : "";
      const time = `<text hint-style="captionSubtle" hint-wrap="true" hint-align="right">${formatDuration(content.elapsedSeconds)} / ${formatDuration(content.durationSeconds)}</text>`;
      body = `<image id="1" src="${image}" name="Image" /><text>ㅤ</text><group><subgroup><text hint-style="body">${title}</text><text hint-style="captionSubtle">${artist}</text></subgroup><subgroup hint-textStacking="bottom">${album}${time}</subgroup></group>`;
      break;
    }
    case "banner_centered_bottom":
      body = `<text>ㅤ</text>${centered}<image id="1" src="${image}" name="Image" hint-removeMargin="true" />`;
      break;
    case "banner_centered_top":
      body = `<image id="1" src="${image}" name="Image" /><text>ㅤ</text>${centered}`;
      break;
    default:
      body = withImage('placement="appLogoOverride"');
  }
  return `<toast><audio silent="true" /><visual><binding template="ToastGeneric">${body}</binding></visual>${actions}</toast>`;
}
