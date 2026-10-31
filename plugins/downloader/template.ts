// File names for the built-in engine from the `template` setting, which holds a
// yt-dlp output template: the same saved template names files the same way on
// both engines. Covers the fields a song has and yt-dlp's `%(a,b)s`, `%(a|default)s`
// and `%(index)02d` forms. Pure functions, unit-tested.

import { DEFAULT_TEMPLATE } from "./ytdlp.ts";

/** What a template can name, by yt-dlp's field names. */
export interface TemplateFields {
  id: string;
  title: string;
  ext: string;
  artist?: string | undefined;
  album?: string | undefined;
  album_artist?: string | undefined;
  release_year?: number | undefined;
  track_number?: number | undefined;
  playlist_index?: number | undefined;
  playlist_title?: string | undefined;
  playlist_id?: string | undefined;
  n_entries?: number | undefined;
  duration?: number | undefined;
}

/** yt-dlp's name for a field it doesn't have. */
const MISSING = "NA";
const FIELD = /%(%|\((?<names>[^)|]*)(?:\|(?<fallback>[^)]*))?\)(?<flags>[-0 +#]*)(?<width>\d*)(?:\.(?<precision>\d+))?(?<type>[sdi]))/g;
// Characters no file system takes (filenamify's list), and control characters.
// oxlint-disable-next-line no-control-regex
const RESERVED = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
// oxlint-disable-next-line no-control-regex
const RESERVED_RUN = /([<>:"/\\|?*\u0000-\u001f\u007f])[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_NAME_LENGTH = 255;
const REPLACEMENT = "_";

/** Fields yt-dlp also knows under another name. */
function aliases(fields: TemplateFields): Record<string, unknown> {
  return {
    ...fields,
    track: fields.title,
    creator: fields.artist,
    uploader: fields.artist,
    channel: fields.artist,
    creators: fields.artist,
    artists: fields.artist,
    playlist: fields.playlist_title,
    // yt-dlp pads the index to the width of the last one.
    playlist_index: fields.playlist_index && String(fields.playlist_index).padStart(String(fields.n_entries ?? 0).length, "0"),
  };
}

function format(value: unknown, flags: string, width: string, type: string) {
  const size = Number(width) || 0;
  if (type === "s") return String(value).padStart(size, " ");
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return String(Math.trunc(number)).padStart(size, flags.includes("0") ? "0" : " ");
}

/** A field value as part of a file name: never a path separator or a character file systems refuse. */
function cleanValue(value: string) {
  return value.replace(RESERVED_RUN, "$1").replace(RESERVED, REPLACEMENT);
}

/** A whole path segment, as filenamify made it: no reserved names, no trailing dots or spaces, not too long. */
export function cleanSegment(segment: string, platform = process.platform) {
  let name = cleanValue(segment).trim().replace(/[. ]+$/, "");
  if (name === "" || name === "." || name === "..") name = REPLACEMENT;
  if (WINDOWS_RESERVED.test(name.split(".")[0]!)) name = `${name}!`;
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  // macOS stores names decomposed itself; elsewhere one spelling keeps "skip existing" working.
  return platform === "darwin" ? name : name.normalize("NFC");
}

/** Renders a yt-dlp output template into a relative path (segments joined with "/"). */
export function renderTemplate(template: string, fields: TemplateFields, platform = process.platform): string {
  const values = aliases(fields);
  const source = (template.trim() || DEFAULT_TEMPLATE).replace(/^[/\\]+/, "");
  const rendered = source.replace(FIELD, (whole, percent: string, ...rest) => {
    if (percent === "%") return "%";
    const groups = rest.at(-1) as Record<string, string | undefined>;
    const names = (groups.names ?? "").split(",").map((name) => name.trim());
    const found = names.map((name) => values[name]).find((value) => value !== undefined && value !== null && value !== "");
    if (found === undefined) return cleanValue(groups.fallback ?? MISSING);
    return cleanValue(format(found, groups.flags ?? "", groups.width ?? "", groups.type ?? "s"));
  });
  return rendered
    .split(/[/\\]+/)
    .filter((segment) => segment !== "")
    .map((segment) => cleanSegment(segment, platform))
    .join("/");
}

/** The playlist's own folder, as yt-dlp names it (`%(playlist_title,playlist_id)s`). */
export function playlistFolder(fields: Pick<TemplateFields, "playlist_title" | "playlist_id">, platform = process.platform) {
  return cleanSegment(fields.playlist_title || fields.playlist_id || MISSING, platform);
}
