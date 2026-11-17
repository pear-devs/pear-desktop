const normalize = (title: string) =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

// A trailing " - Remastered 2011" and the like describes the recording, not the song.
const RECORDING_WORD =
  /^(?:\d{4}|remaster(?:ed)?|version|live|edit|mix|remix|mono|stereo|official|music|video|audio|lyrics?|visualizer|hd|4k|radio|single|album)$/i;

/** Removes a trailing part made only of recording words, such as " - Remastered 2011". */
const removeRecordingNote = (title: string) => {
  const match = /\s[-–—|]\s([^-–—|]+)$/.exec(title);
  if (!match) return title;
  const words = match[1].trim().split(/\s+/);
  return words.every((word) => RECORDING_WORD.test(word))
    ? title.slice(0, match.index)
    : title;
};

const removeDecorations = (title: string) =>
  removeRecordingNote(
    title
      .replaceAll(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
      .replace(/\s(?:feat|ft|featuring)\.?\s.*$/i, ' ')
      .trim(),
  );

/** A lyrics result's title is a song title, so it is never split. */
const lyricsForms = (title: string) =>
  [title, removeDecorations(title)].map(normalize).filter(Boolean);

/**
 * The forms a playing title can take. Video titles are often "Artist - Song", so
 * the part after the separator is the song. The part before it is the artist,
 * and is never compared on its own.
 */
const songForms = (title: string) => {
  const plain = removeDecorations(title);
  const parts = plain.split(/\s[-–—|]\s/);
  return [title, plain, parts.length > 1 ? parts.slice(1).join(' ') : '']
    .map(normalize)
    .filter(Boolean);
};

/**
 * Whether a lyrics result is for this song. The titles must be equal once
 * decorations are removed, so "Love" does not match "Love Story".
 */
export const isSameTitle = (lyricsTitle: string, songTitles: string[]) => {
  const lyrics = lyricsForms(lyricsTitle);
  if (!lyrics.length) return false;

  return songTitles.some((title) =>
    songForms(title).some((song) => lyrics.includes(song)),
  );
};
