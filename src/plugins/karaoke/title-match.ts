const normalize = (title: string) =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

// A trailing " - Remastered 2011" and the like describes the recording, not the song.
const DECORATION =
  /\s[-–—|]\s[^-–—|]*\b(?:remaster(?:ed)?|version|live|edit|mix|mono|stereo|official|video|audio|lyrics?|visualizer|hd|4k)\b[^-–—|]*$/i;

const removeDecorations = (title: string) =>
  title
    .replaceAll(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/\s(?:feat|ft|featuring)\.?\s.*$/i, ' ')
    .replace(DECORATION, ' ');

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
