// Code adapted from https://greasyfork.org/en/scripts/548724-youtube-music-spotify-%E7%BD%91%E6%98%93%E4%BA%91%E6%AD%8C%E8%AF%8D%E6%98%BE%E7%A4%BA
// which is licenced under the MIT licence

import CryptoJS from 'crypto-js';
import { jaroWinkler } from '@skyra/jaro-winkler';
import { z } from 'zod';

import { LRC } from '../parsers/lrc';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

const EAPI_AES_KEY = 'e82ckenh8dichen8';
const EAPI_ENCODE_KEY = '3go8&$8*3*3h0k(2)2';
const EAPI_CHECK_TOKEN =
  '9ca17ae2e6ffcda170e2e6ee8ad85dba908ca4d74da9ac8ea2d44e938f9eadc66da5a8979af572a5a9b68ac12af0feaec3b92aa69af9b1d372f6b8adccb35e968b9bb6c14f908d0099fb6ff48efdacd361f5b6ee9e';
const EAPI_BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) NeteaseMusicDesktop/3.0.14.2534',
};
const EAPI_BASE_COOKIES = {
  os: 'osx',
  appver: '3.0.14',
  requestId: 0,
  osver: '15.6.1',
};

const artistSchema = z.object({ id: z.number(), name: z.string() });
const songSchema = z.object({
  resourceId: z.coerce.number(),
  baseInfo: z.object({
    simpleSongData: z.object({
      name: z.string(),
      ar: z.array(artistSchema).optional(),
      dt: z.number(),
    }),
  }),
});
const searchResponseDataSchema = z.object({
  resources: z.array(songSchema).default([]),
});
const searchResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: searchResponseDataSchema,
});
type Song = z.infer<typeof songSchema>;

const lyricPartSchema = z.object({ lyric: z.string().nullable() });
const lyricResponseSchema = z.object({
  lrc: lyricPartSchema.optional(),
  tlyric: lyricPartSchema.optional(),
  romalrc: lyricPartSchema.optional(),
});

export class Netease implements LyricProvider {
  name = 'Netease';
  baseUrl = 'https://interface.music.163.com';
  cookies: Record<string, string> = {};
  initialized = false;

  private encode(id: string): string {
    // XOR step (unchanged)
    let xoredString = '';
    for (let i = 0; i < id.length; i++) {
      const charCode =
        id.charCodeAt(i) ^
        EAPI_ENCODE_KEY.charCodeAt(i % EAPI_ENCODE_KEY.length);
      xoredString += String.fromCharCode(charCode);
    }

    // MD5 -> Base64 using crypto-js
    const hash = CryptoJS.MD5(CryptoJS.enc.Latin1.parse(xoredString)).toString(
      CryptoJS.enc.Base64,
    );

    // Build a binary WordArray for "id hash"
    const combinedWordArray = CryptoJS.enc.Latin1.parse(id + ' ' + hash);

    // Convert to Base64 (replaces Buffer.from(...).toString("base64"))
    return CryptoJS.enc.Base64.stringify(combinedWordArray);
  }

  private async register() {
    const deviceId = '7B79802670C7A45DB9091976D71E0AE829E28926C6C34A1B8644';
    const username = this.encode(deviceId);
    try {
      await this.eapi('/register/anonimous', { username }, { _nmclfl: '1' });
      this.initialized = true;
    } catch (e) {
      throw new Error(`Registration failed: ${e}`);
    }
  }

  private async eapi(
    path: string,
    data: Record<string, unknown> = {},
    params: Record<string, string> = {},
  ) {
    const header = { ...EAPI_BASE_COOKIES };
    const bodyData = { ...data, header: JSON.stringify(header) };
    const body = JSON.stringify(bodyData);
    const sign = CryptoJS.MD5(
      `nobody/api${path}use${body}md5forencrypt`,
    ).toString();
    const payload = `/api${path}-36cd479b6b5-${body}-36cd479b6b5-${sign}`;

    const key = CryptoJS.enc.Utf8.parse(EAPI_AES_KEY);

    const encrypted = CryptoJS.AES.encrypt(payload, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext.toString(CryptoJS.enc.Hex);

    const cookieString = Object.entries({ ...this.cookies })
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const queryStr = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/eapi${path}${queryStr ? `?${queryStr}` : ''}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...EAPI_BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieString,
      },
      body: `params=${encodeURIComponent(encrypted.toUpperCase())}`,
    });

    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookieStrings = setCookieHeader.split(/,(?=\s*[^=;\s]+=)/);
      for (const cookieStr of cookieStrings) {
        const parts = cookieStr.split(';')[0].split('=');
        if (parts.length === 2) {
          this.cookies[parts[0].trim()] = parts[1].trim();
        }
      }
    }

    if (!response.ok) {
      throw new Error(`bad HTTPStatus(${response.statusText})`);
    }

    const json = await response.json();
    z.object({ code: z.literal(200) }).parse(json);

    return json;
  }

  private async searchSongs(keyword: string, limit = 10): Promise<Song[]> {
    const response = await this.eapi(
      '/search/song/list/page',
      {
        offset: '0',
        scene: 'NORMAL',
        needCorrect: 'true',
        checkToken: EAPI_CHECK_TOKEN,
        keyword,
        limit: limit.toString(),
        verifyId: 1,
      },
      {
        _nmclfl: '1',
      },
    );
    const parsed = searchResponseSchema.parse(response);
    return parsed.data?.resources || [];
  }

  private async getLyric(id: number) {
    const response = await this.eapi(
      '/song/lyric/v1',
      {
        id,
        tv: '-1',
        yv: '-1',
        rv: '-1',
        lv: '-1',
        verifyId: 1,
      },
      {
        _nmclfl: '1',
      },
    );
    return lyricResponseSchema.parse(response);
  }

  private splitTitle(title: string): string[] {
    const masterPattern =
      /(?:[「『](?<content>.+?)[」』])|(?:【.*?】|〖.*?〗|\(.*?\)|（.*?）)|(?<delimiter>\s+-\s+|\s*[/／|:|│]\s*)/i;
    const noiseWords = /\b(MV|PV)\b|\b(?:covered by|feat?|ft?)\b.+/gi;

    const parse = (str: string): string[] => {
      if (!str?.trim()) return [];

      const match = str.match(masterPattern);
      if (!match || match.index === undefined) return [str];

      const before = str.substring(0, match.index);
      const after = str.substring(match.index + match[0].length);
      const { delimiter, content } = match.groups || {};

      if (delimiter && (before.trim().length < 2 || after.trim().length < 2)) {
        const remaining = parse(after);
        return [
          before + match[0] + (remaining[0] || ''),
          ...remaining.slice(1),
        ];
      }

      return [...parse(before), ...(content ? [content] : []), ...parse(after)];
    };
    return [
      ...new Set(
        parse(title)
          .map((p) => p.replace(noiseWords, '').trim())
          .filter((p) => p.length > 0),
      ),
    ];
  }

  async search({
    title,
    artist,
    songDuration,
  }: SearchSongInfo): Promise<LyricResult | null> {
    if (!this.initialized) {
      await this.register();
    }

    const parts = this.splitTitle(title);
    if (parts.length === 0) {
      parts.push(title);
    }

    const keywords = [...parts];
    if (parts[0] !== artist) keywords.push(`${parts[0]} ${artist}`);

    const results = await Promise.all(
      keywords.map((kw) => this.searchSongs(kw, 10)),
    );

    const calcTitleScore = (searchTitle: string) => {
      let avgScore = 0;
      parts.forEach((part, idx) => {
        let weight = 1 / (idx * 2 + 1); // Earlier parts have higher weight
        if (searchTitle.startsWith(part)) weight *= 2;
        // Bonus for prefix match
        else if (searchTitle.includes(part)) weight *= 1.5; // Bonus for substring match
        avgScore += (jaroWinkler(part, searchTitle) * weight) / parts.length;
      });
      const score = Math.max(jaroWinkler(title, searchTitle), avgScore);
      return score;
    };

    const artists = artist.split(/[&,]/g).map((i) => i.trim());
    const filteredResults = [];
    for (const result of results.flat()) {
      const {
        baseInfo: {
          simpleSongData: { name, ar: itemArtists },
        },
      } = result;

      const permutations = [];
      for (const artistA of artists) {
        for (const artistB of itemArtists ?? []) {
          permutations.push([
            artistA.toLowerCase(),
            artistB.name.toLowerCase(),
          ]);
        }
      }

      for (const artistA of itemArtists ?? []) {
        for (const artistB of artists) {
          permutations.push([
            artistA.name.toLowerCase(),
            artistB.toLowerCase(),
          ]);
        }
      }

      const ratio =
        calcTitleScore(name) +
        Math.max(...permutations.map(([x, y]) => jaroWinkler(x, y)));

      if (ratio < 1.8) continue;
      filteredResults.push(result);
    }

    const closestResult = filteredResults[0];
    if (!closestResult) {
      return null;
    }

    if (
      Math.abs(closestResult.baseInfo.simpleSongData.dt / 1000 - songDuration) >
      15
    ) {
      return null;
    }

    const lyric = await this.getLyric(closestResult.resourceId);
    if (!lyric || !lyric.lrc?.lyric) return null;

    const lyrics = stripMetadata(lyric.lrc.lyric);

    const lines = LRC.parse(lyrics).lines.map((l) => ({
      ...l,
      status: 'upcoming' as const,
    }));

    if (lines.length === 0 && !lyrics.trim()) return null;

    return {
      title: closestResult.baseInfo.simpleSongData.name,
      artists:
        closestResult.baseInfo.simpleSongData.ar?.map((a) => a.name) ?? [],
      lines,
      lyrics: lyrics,
    };
  }
}

const stripMetadata = (lyrics: string) => {
  return lyrics
    .split('\n')
    .filter((line) => {
      if (!line.includes('{')) return true;
      try {
        JSON.parse(line);
        return false;
      } catch {}
      return true;
    })
    .join('\n');
};
