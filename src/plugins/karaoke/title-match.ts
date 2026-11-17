const normalize = (title: string) =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

/**
 * The forms a title can take once decorations are removed: bracketed parts such
 * as "(Official Video)" or "(feat. Someone)", a trailing "feat. ...", and either
 * side of "Artist - Song".
 */
const titleForms = (title: string) => {
  const plain = title
    .replaceAll(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/\s(?:feat|ft|featuring)\.?\s.*$/i, ' ');

  return [title, plain, ...plain.split(/\s[-–—|]\s/)]
    .map(normalize)
    .filter(Boolean);
};

/**
 * Whether a lyrics result is for this song. The titles must be equal once
 * decorations are removed, so "Love" does not match "Love Story".
 */
export const isSameTitle = (lyricsTitle: string, songTitles: string[]) => {
  const lyrics = titleForms(lyricsTitle);
  if (!lyrics.length) return false;

  return songTitles.some((title) =>
    titleForms(title).some((song) => lyrics.includes(song)),
  );
};
