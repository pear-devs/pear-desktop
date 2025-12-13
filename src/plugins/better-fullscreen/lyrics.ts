export interface LyricLine { text: string; timeMs: number; romaji?: string; }
export interface LyricResult { lines?: LyricLine[]; plain?: string; synced: boolean; }

// --- GOOGLE TRANSLATE (GTX) ROMANIZER ---
const googleRomanize = async (text: string): Promise<string> => {
  try {
    if (!text || /^[\x00-\x7F]*$/.test(text)) return text; 

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return text;

    const data = await res.json();
    
    if (data && data[0] && Array.isArray(data[0])) {
      let romajiFull = '';
      
      data[0].forEach((chunk: any) => {
          if(Array.isArray(chunk)) {
              const possibleRomaji = chunk[chunk.length - 1];
              if (typeof possibleRomaji === 'string' && possibleRomaji !== text && !possibleRomaji.includes(text)) {
                  romajiFull += possibleRomaji + ' ';
              }
          }
      });

      if (romajiFull.trim().length > 0) {
          return romajiFull.trim();
      }
    }
  } catch (e) {}
  return text;
};

// --- HELPERS ---
const cleanTitle = (text: string) => {
  return text
    .replace(/\(feat\..*?\)/i, '')
    .replace(/\[feat\..*?\]/i, '')
    .replace(/\(Remaster.*?\)/i, '')
    .replace(/\(.*?Mix\)/i, '')
    .replace(/\(.*?Version\)/i, '')
    .replace(/ - .*?$/, '') 
    .trim();
};

const parseLRC = (lrc: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  lrc.split('\n').forEach(line => {
    const match = line.match(regex);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const text = match[4].trim();
      if (text) lines.push({ timeMs: (min * 60 * 1000) + (sec * 1000) + ms, text });
    }
  });
  return lines;
};

// --- MAIN FETCHER ---
export const getLyrics = async (title: string, artist: string, duration: number, romanize: boolean = false): Promise<LyricResult | null> => {
  try {
    const targetDur = Math.round(duration);
    const q = `${cleanTitle(title)} ${artist}`;
    
    const searchUrl = new URL('https://lrclib.net/api/search');
    searchUrl.searchParams.append('q', q);
    
    const res = await fetch(searchUrl.toString());
    if(!res.ok) return null;
    
    const list = await res.json();
    if(!Array.isArray(list) || list.length === 0) return null;

    list.sort((a, b) => {
       const aHasSync = !!a.syncedLyrics;
       const bHasSync = !!b.syncedLyrics;
       if(aHasSync !== bHasSync) return bHasSync ? 1 : -1;
       return Math.abs(a.duration - targetDur) - Math.abs(b.duration - targetDur);
    });

    const best = list[0];
    let result: LyricResult | null = null;

    if(best.syncedLyrics) result = { lines: parseLRC(best.syncedLyrics), synced: true };
    else if(best.plainLyrics) result = { plain: best.plainLyrics, synced: false };

    // 3. Apply Google Romanization
    if (result && romanize) {
        if (result.lines) {
            const promises = result.lines.map(async (line) => {
                const romaji = await googleRomanize(line.text);
                if (romaji && romaji.toLowerCase() !== line.text.toLowerCase()) {
                    return { ...line, romaji };
                }
                return line;
            });
            result.lines = await Promise.all(promises);
        }
    }

    return result;

  } catch (e) { console.warn('Lyrics Error:', e); }
  return null;
};