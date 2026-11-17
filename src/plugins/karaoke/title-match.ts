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

// Brackets that tell songs apart, such as "(Part 2)" or "(2)", are kept.
const QUALIFIER =
  /^\s*(?:(?:part|pt\.?|vol\.?|volume|no\.?|chapter|act|movement|op\.?)\s*[\w.]+|[\d.]+)\s*$/i;

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

// Splits "A feat. B & C" into the people it names, so names are compared
// whole: "Artist feat. Guest" names "Artist", but "Queen Latifah" is not
// "Queen" and "Leftfield" is not "Left".
const CREDIT_SEPARATOR =
  /\s+(?:feat\.?|ft\.?|featuring|with|x|vs\.?)\s+|\s*[&,;/+]\s*|\s+(?:and)\s+/i;

// Brackets in an artist credit hold more people, as in "Artist (feat. Guest)",
// so they separate names rather than being removed.
const artistNames = (artists: string) =>
  artists
    .replaceAll(/[()[\]【】]/g, ' & ')
    .split(CREDIT_SEPARATOR)
    .map((name) =>
      name.trim().replace(/^(?:feat\.?|ft\.?|featuring|with)\s+/i, ''),
    )
    .map(normalize)
    .filter(Boolean);

const sharesArtist = (artists: string, others: string[]) => {
  // The whole name first, so a band like "AC/DC" still matches a source that
  // writes "ACDC", even though the split below would make "ac" and "dc".
  const whole = normalize(artists);
  if (whole && others.some((other) => normalize(other) === whole)) return true;

  const names = new Set(artistNames(artists));
  return others.flatMap(artistNames).some((name) => names.has(name));
};

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
  // The part after the dash is only the song when the part before it is the
  // artist. Without the artist's name, any "A - B" title is taken as one.
  const isArtistPrefix =
    !artist || (parts.length > 1 && sharesArtist(parts[0], [artist]));
  const songPart =
    parts.length > 1 && isArtistPrefix ? parts.slice(1).join(' - ') : '';
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

/**
 * Whether a lyrics result's artists include the playing artist. Either side may
 * be missing, and then only the title decides. Names are compared by
 * containment, because "Artist feat. Someone" still names the artist.
 */
export const isSameArtist = (lyricsArtists: string[], artist: string) => {
  const named = lyricsArtists.flatMap(artistNames);
  if (!artistNames(artist).length || !named.length) return true;
  return sharesArtist(artist, lyricsArtists);
};
