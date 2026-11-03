// Fuzzy matching of provider results against the playing track, so a provider
// that returns *something* for every query can't show the wrong song's lyrics.

export function jaroWinkler(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  for (let i = 0, j = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[j]) j++;
    if (a[i] !== b[j]) transpositions++;
    j++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Lowercase, without bracketed extras ("(Official Video)", "[Remastered]") and punctuation. */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[([【].*?[)\]】]/g, " ")
    .replace(/\s[-–—]\s.*$/, " ")
    .replace(/\b(feat|ft)\.?\s.*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function splitArtists(artists: string) {
  return artists
    .split(/\s*(?:[,&、]|\band\b|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)
    .map(normalize)
    .filter(Boolean);
}

/** Best similarity between any artist of `a` and any artist of `b`. */
export function artistSimilarity(a: string, b: string) {
  let best = 0;
  for (const x of splitArtists(a)) {
    for (const y of splitArtists(b)) best = Math.max(best, jaroWinkler(x, y));
  }
  return best;
}

/** Like pear-desktop: the track's artist, or one of its tags (often the artist's canonical name). */
export function queryArtistSimilarity(name: string, query: { artist: string; tags?: readonly string[] }) {
  let best = artistSimilarity(name, query.artist);
  for (const tag of query.tags ?? []) if (best < 1) best = Math.max(best, artistSimilarity(name, tag));
  return best;
}

/** The track's title, or its title in the original language. */
export function queryTitleSimilarity(name: string, query: { title: string; alternativeTitle?: string }) {
  const best = titleSimilarity(name, query.title);
  return query.alternativeTitle ? Math.max(best, titleSimilarity(name, query.alternativeTitle)) : best;
}

export function titleSimilarity(a: string, b: string) {
  const x = normalize(a);
  const y = normalize(b);
  if (x && y && (x.includes(y) || y.includes(x))) return Math.max(0.9, jaroWinkler(x, y));
  return jaroWinkler(x, y);
}
