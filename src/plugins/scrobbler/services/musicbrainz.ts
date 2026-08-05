import { app, net } from 'electron';

const cache = new Map<string, { title: string; artist: string } | null>();

async function fetchWithRetry(url: string, email: string) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await net.fetch(url, { headers: { 'User-Agent': `PearDesktop/${app.getVersion()} ( ${email} )` } });
    if (res.status < 500) break;
    if (i < 2) await new Promise(r => setTimeout(r, 2000));
  }
  return res;
}

export async function fetchMusicBrainzCorrection(
  title: string,
  artist: string,
  email: string,
): Promise<{ title: string; artist: string } | null> {
  const cacheKey = `${artist} - ${title}`;
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
    const queryMB = async (q: string): Promise<any> => {
      const res = await fetchWithRetry(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=1`, email);
      return res?.ok ? await res.json() : null;
    };

    let data: any = await queryMB(`recording:"${title}" AND artist:"${artist}"`);
    const isBad = (d: any) => !d?.recordings?.length || d.recordings[0].score < 85;

    // Fallback 1: Many YouTube videos have "Artist - Title" in the video title.
    if (isBad(data) && parsedArtist && parsedTitle) {
      data = await queryMB(`recording:"${parsedTitle}" AND artist:"${parsedArtist}"`);
    }

    // Fallback 2: Try a free-form search with just the video title.
    if (isBad(data)) {
      const fallback = await queryMB(title);
      if (!isBad(fallback)) {
        const top = fallback.recordings[0];
        const retArtist = (top['artist-credit']?.[0]?.name || '').toLowerCase();

        if (retArtist && title.toLowerCase().includes(retArtist)) {
          const retClean = top.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
          const origClean = (parsedTitle || title).toLowerCase().replace(/[^\w\s]/g, '').trim();
          const [rWord, oWord] = [retClean.split(/\s+/)[0], origClean.split(/\s+/)[0]];

          const remixRegex = /remix|mix|mashup|edit|bootleg|cover|flip|vip|slowed|reverb|sped\s*up/i;
          if (!((rWord && oWord && !origClean.includes(rWord) && !retClean.includes(oWord)) || 
                (remixRegex.test(origClean) && !remixRegex.test(retClean)))) {
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
    return setAndReturn(parsedArtist && parsedTitle ? { title: parsedTitle, artist: parsedArtist } : null);
  } catch (error) {
    console.error('Failed to fetch from MusicBrainz: ', error);
    return parsedArtist && parsedTitle ? { title: parsedTitle, artist: parsedArtist } : null;
  }
}
