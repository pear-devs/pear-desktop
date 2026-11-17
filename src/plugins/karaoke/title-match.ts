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

// Brackets that tell songs apart, such as "(Part 2)", are kept.
const QUALIFIER =
  /^\s*(?:part|pt\.?|vol\.?|volume|no\.?|chapter|act|movement|op\.?)\s*[\w.]+\s*$/i;

const removeBrackets = (title: string) =>
  title.replaceAll(
    /\(([^)]*)\)|\[([^\]]*)\]|【([^】]*)】/g,
    (whole, ...inner) =>
      // NFKC turns full-width digits such as "１" into plain ones first.
      QUALIFIER.test(
        String(inner.find((part) => part !== undefined) ?? '').normalize(
          'NFKC',
        ),
      )
        ? whole
        : ' ',
  );

const removeCredits = (title: string) =>
  removeBrackets(title)
    .replace(/\s(?:feat|ft|featuring)\.?\s.*$/i, ' ')
    .trim();

const SEPARATOR = /\s[-–—|]\s/;

/** A lyrics result's title is a song title, so it is never split. */
const lyricsForms = (title: string) => {
  const plain = removeCredits(title);
  return [title, plain, removeRecordingNote(plain)]
    .map(normalize)
    .filter(Boolean);
};

/**
 * The forms a playing title can take. Video titles are often "Artist - Song", so
 * the part after the separator is the song, taken before any recording note is
 * removed ("Artist - Video" keeps "Video"). A form that is only the artist is
 * never compared.
 */
const songForms = (title: string, artist: string) => {
  const plain = removeCredits(title);
  const parts = plain.split(SEPARATOR);
  const songPart = parts.length > 1 ? parts.slice(1).join(' - ') : '';
  const withoutNote = removeRecordingNote(plain);

  // "Artist - Video" without its note is just the artist, which is no title.
  // A song that shares the artist's name still matches through songPart.
  const isOnlyArtist =
    parts.length > 1 &&
    Boolean(artist) &&
    normalize(withoutNote) === normalize(artist) &&
    normalize(parts[0]) === normalize(artist);

  return [
    title,
    plain,
    isOnlyArtist ? '' : withoutNote,
    songPart,
    removeRecordingNote(songPart),
  ]
    .map(normalize)
    .filter(Boolean);
};

/**
 * Whether a lyrics result is for this song. The titles must be equal once
 * decorations are removed, so "Love" does not match "Love Story".
 */
export const isSameTitle = (
  lyricsTitle: string,
  songTitles: string[],
  artist = '',
) => {
  const lyrics = lyricsForms(lyricsTitle);
  if (!lyrics.length) return false;

  return songTitles.some((title) =>
    songForms(title, artist).some((song) => lyrics.includes(song)),
  );
};
