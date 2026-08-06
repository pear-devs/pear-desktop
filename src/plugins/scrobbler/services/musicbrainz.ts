import { app, net } from 'electron';

const cache = new Map<string, { title: string; artist: string } | null>();

let mbLock = Promise.resolve();

async function fetchWithRetry(
  url: string,
  email: string,
  isCancelled: () => boolean,
): Promise<Response | null> {
  let response: Response | null = null;
  for (let i = 0; i < 3; i++) {
    if (isCancelled()) return null;

    let release!: () => void;
    const currentLock = mbLock;
    mbLock = new Promise((r) => (release = r));
    await currentLock;

    if (isCancelled()) {
      release();
      return null;
    }

    try {
      response = await net.fetch(url, {
        headers: {
          'User-Agent': `PearDesktop/${app.getVersion()} ( ${email} )`,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      if (i === 2) {
        setTimeout(release, 1050);
        return null;
      }
    }

    const isSuccess = response !== null && response.status < 500;
    const delay = response?.status === 503 ? 5000 : isSuccess ? 1050 : 2000;

    setTimeout(release, delay);
    if (isSuccess) break;
  }
  return response;
}

export async function fetchMusicBrainzCorrection(
  title: string,
  artist: string,
  email: string,
  isCancelled: () => boolean,
): Promise<{ title: string; artist: string } | null> {
  if (isCancelled()) return null;

  const cacheKey = JSON.stringify([artist, title]);
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  if (cache.size >= 200) cache.clear();

  let parsedArtist = '';
  let parsedTitle = '';
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length === 2) {
    parsedArtist = parts[0].trim();
    parsedTitle = parts[1].trim();
  }

  const setAndReturn = (res: { title: string; artist: string } | null) => {
    cache.set(cacheKey, res);
    return res;
  };

  try {
    const queryMB = async (rec: string, art?: string): Promise<any> => {
      if (isCancelled()) return null;

      const escape = (s: string) => s.replace(/[\\"]/g, '\\$&');
      const q = art
        ? `recording:"${escape(rec)}" AND artist:"${escape(art)}"`
        : escape(rec);
      const res = await fetchWithRetry(
        `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=1`,
        email,
        isCancelled,
      );
      return !isCancelled() && res?.ok ? await res.json() : null;
    };

    let data: any = await queryMB(title, artist);
    if (isCancelled()) return null;

    const isBad = (d: any) =>
      !d?.recordings?.length || d.recordings[0].score < 85;

    // Fallback 1: Many YouTube videos have "Artist - Title" in the video title.
    if (isBad(data) && parsedArtist && parsedTitle) {
      data = await queryMB(parsedTitle, parsedArtist);
      if (isCancelled()) return null;
    }

    // Fallback 2: Try a free-form search with just the video title.
    if (isBad(data)) {
      const fallback = await queryMB(title);
      if (isCancelled()) return null;

      if (!isBad(fallback)) {
        const top = fallback.recordings[0];
        const retArtist = (top['artist-credit']?.[0]?.name || '').toLowerCase();

        if (retArtist && title.toLowerCase().includes(retArtist)) {
          const retClean = top.title
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();
          const origClean = (parsedTitle || title)
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();
          const [rWord, oWord] = [
            retClean.split(/\s+/)[0],
            origClean.split(/\s+/)[0],
          ];

          const remixRegex =
            /remix|mix|mashup|edit|bootleg|cover|flip|vip|slowed|reverb|sped\s*up/i;
          if (
            !(
              (rWord &&
                oWord &&
                !origClean.includes(rWord) &&
                !retClean.includes(oWord)) ||
              (remixRegex.test(origClean) && !remixRegex.test(retClean))
            )
          ) {
            data = fallback;
          }
        }
      }
    }

    if (!isBad(data)) {
      return setAndReturn({
        title: data.recordings[0].title,
        artist: data.recordings[0]['artist-credit']?.[0]?.name || artist,
      });
    }

    // Fallback 3: Return raw "Artist - Title" parse if MusicBrainz completely fails
    return setAndReturn(
      parsedArtist && parsedTitle
        ? { title: parsedTitle, artist: parsedArtist }
        : null,
    );
  } catch (error) {
    console.error('Failed to fetch from MusicBrainz: ', error);
    return parsedArtist && parsedTitle
      ? { title: parsedTitle, artist: parsedArtist }
      : null;
  }
}
