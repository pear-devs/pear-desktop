import { render } from 'solid-js/web';
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
import Kuroshiro from 'kuroshiro';
import { romanize as esHangulRomanize } from 'es-hangul';
import hanja from 'hanja';
import * as pinyin from 'tiny-pinyin';
import { romanize as romanizeThaiFrag } from '@dehoist/romanize-thai';
import { lazy } from 'lazy-var';
import { detect } from 'tinyld';

import { waitForElement } from '@/utils/wait-for-element';
import { LyricsRenderer, setIsVisible } from './renderer';

export const selectors = {
  head: '#tabsContent > .tab-header:nth-of-type(2)',
  body: {
    tabRenderer: '#tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]',
    root: 'ytmusic-description-shelf-renderer',
  },
};

export const tabStates: Record<string, () => void> = {
  true: async () => {
    setIsVisible(true);

    let container = document.querySelector('#synced-lyrics-container');
    if (container) return;

    const tabRenderer = await waitForElement<HTMLElement>(
      selectors.body.tabRenderer,
    );

    container = Object.assign(document.createElement('div'), {
      id: 'synced-lyrics-container',
    });

    tabRenderer.appendChild(container);
    render(() => <LyricsRenderer />, container);
  },
  false: () => {
    setIsVisible(false);
  },
};

export const canonicalize = (text: string) => {
  return (
    text
      // `hi  there` => `hi there`
      .replaceAll(/\s+/g, ' ')

      // `( a )` => `(a)`
      .replaceAll(/([([]) ([^ ])/g, (_, symbol, a) => `${symbol}${a}`)
      .replaceAll(/([^ ]) ([)\]])/g, (_, a, symbol) => `${a}${symbol}`)

      // `can ' t` => `can't`
      .replaceAll(
        /([Ii]) (') ([^ ])|(n) (') (t)(?= |$)|(t) (') (s)|([^ ]) (') (re)|([^ ]) (') (ve)|([^ ]) (-) ([^ ])/g,
        (m, ...groups) => {
          for (let i = 0; i < groups.length; i += 3) {
            if (groups[i]) {
              return groups.slice(i, i + 3).join('');
            }
          }

          return m;
        },
      )
      // `Stayin ' still` => `Stayin' still`
      .replaceAll(/in ' ([^ ])/g, (_, char) => `in' ${char}`)
      .replaceAll("in ',", "in',")

      .replaceAll(", ' cause", ", 'cause")

      // `hi , there` => `hi, there`
      .replaceAll(/([^ ]) ([.,!?])/g, (_, a, symbol) => `${a}${symbol}`)

      // `hi " there "` => `hi "there"`
      .replaceAll(
        /"([^"]+)"/g,
        (_, content) =>
          `"${typeof content === 'string' ? content.trim() : content}"`,
      )
      .trim()
  );
};

export const simplifyUnicode = (text?: string) =>
  text
    ? text
        .replaceAll(/\u0020|\u00A0|[\u2000-\u200A]|\u202F|\u205F|\u3000/g, ' ')
        .trim()
    : text;

// Japanese Shinjitai
const shinjitai = [
  20055, 20081, 20120, 20124, 20175, 26469, 20341, 20206, 20253, 20605, 20385,
  20537, 20816, 20001, 20869, 23500, 28092, 20956, 21104, 21091, 21092, 21172,
  21234, 21169, 21223, 21306, 24059, 21363, 21442, 21782, 21336, 22107, 21427,
  22065, 22287, 22269, 22258, 20870, 22259, 22243, 37326, 23597, 22679, 22549,
  22311, 22593, 22730, 22732, 22766, 22769, 23551, 22885, 22888, 23330, 23398,
  23517, 23455, 20889, 23515, 23453, 23558, 23554, 23550, 23626, 23631, 23646,
  23792, 23777, 23798, 23731, 24012, 24035, 24111, 24182, 24259, 24195, 24193,
  24382, 24357, 24367, 24452, 24467, 24500, 24499, 24658, 24693, 24746, 24745,
  24910, 24808, 24540, 25040, 24651, 25126, 25135, 25144, 25147, 25173, 25244,
  25309, 25375, 25407, 25522, 25531, 25594, 25436, 25246, 25731, 25285, 25312,
  25369, 25313, 25666, 25785, 21454, 21177, 21465, 21189, 25968, 26029, 26179,
  26217, 26172, 26278, 26241, 26365, 20250, 26465, 26719, 26628, 27097, 27010,
  27005, 27004, 26530, 27096, 27178, 26727, 26908, 26716, 27177, 27431, 27475,
  27497, 27508, 24112, 27531, 27579, 27572, 27598, 27671, 28169, 28057, 27972,
  27973, 28167, 28179, 28201, 28382, 28288, 28300, 28508, 28171, 27810, 28287,
  28168, 27996, 27818, 28381, 28716, 28286, 28948, 28783, 28988, 21942, 28809,
  20105, 28858, 29344, 29366, 29421, 22888, 29420, 29471, 29539, 29486, 24321,
  29942, 30011, 24403, 30067, 30185, 30196, 30330, 26479, 30423, 23613, 30495,
  30740, 30741, 30783, 31192, 31108, 31109, 31036, 31074, 31095, 31216, 31282,
  38964, 31298, 31311, 31331, 31363, 20006, 31883, 31992, 32076, 32209, 32210,
  32257, 30476, 32294, 32207, 32333, 32260, 32117, 32331, 32153, 32154, 32330,
  27424, 32566, 22768, 32884, 31899, 33075, 32966, 33235, 21488, 19982, 26087,
  33398, 33624, 33550, 33804, 19975, 33931, 22290, 34219, 34101, 33464, 34220,
  33446, 20966, 34394, 21495, 34509, 34411, 34635, 34453, 34542, 34907, 35013,
  35090, 35226, 35239, 35251, 35302, 35617, 35388, 35379, 35465, 35501, 22793,
  35698, 35715, 35914, 33398, 20104, 24336, 22770, 38972, 36059, 36341, 36527,
  36605, 36620, 36578, 24321, 36766, 24321, 36965, 36883, 36933, 36794, 37070,
  37111, 37204, 21307, 37284, 37271, 37304, 37320, 37682, 37549, 37676, 37806,
  37444, 37619, 37489, 38306, 38501, 38543, 38522, 38560, 21452, 38609, 35207,
  38666, 38745, 39003, 38997, 32763, 20313, 39173, 39366, 39442, 39366, 39443,
  39365, 39620, 20307, 39658, 38360, 40335, 40206, 40568, 22633, 40614, 40633,
  40634, 40644, 40658, 40665, 28857, 20826, 25993, 25998, 27503, 40802, 31452,
  20096,
].map((codePoint) => String.fromCodePoint(codePoint));
const shinjitaiRegex = new RegExp(`[${shinjitai.join('')}]`);

const kuroshiro = lazy(async () => {
  const _kuroshiro = new Kuroshiro();
  await _kuroshiro.init(
    new KuromojiAnalyzer({
      dictPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/',
    }),
  );
  return _kuroshiro;
});

const hasJapanese = (lines: string[]) =>
  lines.some(
    (line) => Kuroshiro.Util.hasKana(line) || shinjitaiRegex.test(line),
  );

// tests for Hangul characters, sufficient for our use case
const hasKorean = (lines: string[]) =>
  lines.some((line) => /[ㄱ-ㅎㅏ-ㅣ가-힣]+/.test(line));

const hasChinese = (lines: string[]) =>
  lines.some((line) => /[\u4E00-\u9FFF]+/.test(line));

// https://en.wikipedia.org/wiki/Thai_(Unicode_block)
const hasThai = (lines: string[]) =>
  lines.some((line) => /[\u0E00-\u0E7F]+/.test(line));

export const romanizeJapanese = async (line: string) =>
  (await kuroshiro.get()).convert(line, {
    to: 'romaji',
    mode: 'spaced',
  }) ?? line;

export const romanizeHangul = (line: string) =>
  esHangulRomanize(hanja.translate(line, 'SUBSTITUTION'));

export const romanizeChinese = (line: string) => {
  return line.replaceAll(/[\u4E00-\u9FFF]+/g, (match) =>
    pinyin.convertToPinyin(match, ' ', true),
  );
};

const thaiSegmenter = Intl.Segmenter.supportedLocalesOf('th').includes('th')
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null;

export const romanizeThai = (line: string) => {
  if (!thaiSegmenter) return romanizeThaiFrag(line);

  const segments = Array.from(thaiSegmenter.segment(line));
  const latin = segments
    .map((segment) =>
      segment.isWordLike
        ? romanizeThaiFrag(segment.segment)
        : segment.segment.trim(),
    )
    .join(' ')
    .trim();

  return latin;
};

const handlers: Record<string, (line: string) => Promise<string> | string> = {
  ja: romanizeJapanese,
  ko: romanizeHangul,
  zh: romanizeChinese,
  th: romanizeThai,
};

export const romanize = async (line: string) => {
  const lang = detect(line);

  const handler = handlers[lang];
  if (handler) {
    return handler(line);
  }

  // fallback
  if (hasJapanese([line])) line = await romanizeJapanese(line);
  if (hasKorean([line])) line = romanizeHangul(line);
  if (hasChinese([line])) line = romanizeChinese(line);
  if (hasThai([line])) line = romanizeThai(line);

  return line;
};
