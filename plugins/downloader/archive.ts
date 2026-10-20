// The downloaded songs of a folder by video id, as yt-dlp's --download-archive
// keeps them (both engines share the file), so renamed files and changed file
// names don't download again (host only).

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { YTM_ORIGIN } from "@pear/sdk/util";

export const ARCHIVE_NAME = ".pear-downloaded.txt";
/** yt-dlp's extractor key for the site: the second-level domain of YTM's origin. */
const EXTRACTOR = new URL(YTM_ORIGIN).hostname.split(".").at(-2)!;

export const archivePath = (folder: string) => join(folder, ARCHIVE_NAME);

/** The ids in an archive file's text ("<extractor> <id>" per line). */
export function parseArchive(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [extractor, id] = line.trim().split(/\s+/);
    if (extractor === EXTRACTOR && id) ids.add(id);
  }
  return ids;
}

export const archiveLine = (videoId: string) => `${EXTRACTOR} ${videoId}\n`;

export class Archive {
  readonly path: string;

  constructor(folder: string) {
    this.path = archivePath(folder);
  }

  async has(videoId: string) {
    const text = await readFile(this.path, "utf8").catch(() => "");
    return parseArchive(text).has(videoId);
  }

  add(videoId: string) {
    return appendFile(this.path, archiveLine(videoId));
  }
}
