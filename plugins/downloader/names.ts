// Song titles and artists as pear-desktop named files and tagged them: without
// the video's dressing ("(Official Music Video)", "[Lyric Video]", "VEVO",
// " - Topic"…). The same patterns go to yt-dlp (Python regexes), so both engines
// name files alike. Pure, unit-tested; no Node imports (the page uses it too).

// pear-desktop's own list, in its order. Written so that they mean the same in JS and Python.
const SUFFIXES = [
  // Artist names
  String.raw`\s*(- topic)$`,
  String.raw`\s*vevo$`,
  // Video titles
  String.raw`\s*[(|\[]official(.*?)[)|\]]`, // (Official Music Video), [Official Visualizer], etc...
  String.raw`\s*[(|\[]((lyrics?|visualizer|audio)\s*(video)?)[)|\]]`,
  String.raw`\s*[(|\[](performance video)[)|\]]`,
  String.raw`\s*[(|\[](clip official)[)|\]]`,
  String.raw`\s*[(|\[](video version)[)|\]]`,
  String.raw`\s*[(|\[](HD|HQ)\s*?(?:audio)?[)|\]]$`,
  String.raw`\s*[(|\[](live)[)|\]]$`,
  String.raw`\s*[(|\[]4K\s*?(?:upgrade)?[)|\]]$`,
];

const PATTERNS = SUFFIXES.map((source) => new RegExp(source, "i"));

/** A title or artist without the video's dressing, as pear-desktop's `cleanupName`. */
export function cleanupName(name: string): string;
export function cleanupName(name: string | undefined): string | undefined;
export function cleanupName(name: string | undefined) {
  if (!name) return name;
  let cleaned = name;
  for (const pattern of PATTERNS) cleaned = cleaned.replace(pattern, "");
  return cleaned;
}

/** The fields yt-dlp names files and writes tags from. */
const YTDLP_FIELDS = "title,track,artist,creator,uploader,channel";

/** yt-dlp's arguments doing `cleanupName` on its titles and artists (before it names the file). */
export function cleanupArgs(): string[] {
  return SUFFIXES.flatMap((source) => ["--replace-in-metadata", YTDLP_FIELDS, `(?i)${source}`, ""]);
}
