const normalize = (title: string) =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]/gu, '');

/**
 * Whether a lyrics result is for this song. Containment rather than equality,
 * because the playing title is often the longer "Artist - Song (Official Video)".
 */
export const isSameTitle = (lyricsTitle: string, songTitles: string[]) => {
  const lyrics = normalize(lyricsTitle);
  if (!lyrics) return false;

  return songTitles.some((title) => {
    const song = normalize(title);
    return Boolean(song) && (song.includes(lyrics) || lyrics.includes(song));
  });
};
