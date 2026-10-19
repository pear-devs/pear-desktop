// Host side: romanization and Chinese script conversion. Everything is loaded
// lazily with dynamic imports, so it costs nothing until a song needs it, and
// none of it ever reaches the page bundle.

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const HAN_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;

export type Script = "ja" | "ko" | "zh";

/**
 * Decides per song rather than per line: a kanji-only line in a Japanese song is
 * Japanese, not Chinese (per-line guessing is how romanization regressed upstream).
 */
export function detectScripts(lines: readonly string[]): (Script | null)[] {
  const japanese = lines.some((line) => KANA.test(line));
  return lines.map((line) => {
    if (HANGUL.test(line)) return "ko";
    if (KANA.test(line) || (japanese && HAN.test(line))) return "ja";
    if (HAN.test(line)) return "zh";
    return null;
  });
}

const KUROMOJI_DICT = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const DICT_FILES = [
  "base.dat.gz",
  "cc.dat.gz",
  "check.dat.gz",
  "tid.dat.gz",
  "tid_map.dat.gz",
  "tid_pos.dat.gz",
  "unk.dat.gz",
  "unk_char.dat.gz",
  "unk_compat.dat.gz",
  "unk_invoke.dat.gz",
  "unk_map.dat.gz",
  "unk_pos.dat.gz",
];

interface KuroshiroInstance {
  convert(text: string, options: { to: "romaji"; mode: "spaced" }): Promise<string>;
}

export class Romanizer {
  #dictDir: string;
  #fetch: (url: string) => Promise<Response>;
  #kuroshiro: Promise<KuroshiroInstance> | undefined;

  /** `dictDir` caches the Japanese dictionary (~17 MB, downloaded on first use). */
  constructor(dictDir: string, fetch: (url: string) => Promise<Response>) {
    this.#dictDir = dictDir;
    this.#fetch = fetch;
  }

  async romanize(lines: readonly string[]): Promise<(string | null)[]> {
    const scripts = detectScripts(lines);
    return Promise.all(
      lines.map(async (line, i) => {
        const script = scripts[i];
        if (!script) return null;
        const result = tidy(await this.#line(line, script));
        return result && result.toLowerCase() !== line.trim().toLowerCase() ? result : null;
      }),
    );
  }

  async #line(line: string, script: Script) {
    switch (script) {
      case "ko": {
        const [{ romanize }, hanja] = await Promise.all([import("es-hangul"), import("hanja")]);
        const translate = (hanja.default ?? hanja).translate;
        return romanize(translate(line, "SUBSTITUTION"));
      }
      case "zh": {
        const { pinyin } = await import("pinyin-pro");
        return line.replace(HAN_RUN, (run) => ` ${pinyin(run, { separator: " " })} `);
      }
      case "ja": {
        const kuroshiro = await (this.#kuroshiro ??= this.#loadKuroshiro().catch((error: unknown) => {
          this.#kuroshiro = undefined;
          throw error;
        }));
        return kuroshiro.convert(line, { to: "romaji", mode: "spaced" });
      }
    }
  }

  async #loadKuroshiro(): Promise<KuroshiroInstance> {
    await this.#ensureDictionary();
    const [kuroshiroModule, analyzerModule] = await Promise.all([
      import("kuroshiro"),
      import("kuroshiro-analyzer-kuromoji"),
    ]);
    const Kuroshiro = defaultExport(kuroshiroModule);
    const Analyzer = defaultExport(analyzerModule);
    const kuroshiro = new Kuroshiro();
    await kuroshiro.init(new Analyzer({ dictPath: `${this.#dictDir}/` }));
    return kuroshiro;
  }

  async #ensureDictionary() {
    await mkdir(this.#dictDir, { recursive: true });
    await Promise.all(
      DICT_FILES.map(async (file) => {
        const target = join(this.#dictDir, file);
        if (existsSync(target)) return;
        const response = await this.#fetch(`${KUROMOJI_DICT}${file}`);
        if (!response.ok) throw new Error(`dictionary download failed: ${file} (${response.status})`);
        const temporary = `${target}.part`;
        await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
        await rename(temporary, target);
      }),
    );
  }
}

export async function convertChinese(lines: readonly string[], mode: "s2t" | "t2s") {
  const { sify, tify } = await import("chinese-conv");
  return lines.map((line) => (HAN.test(line) ? (mode === "s2t" ? tify(line) : sify(line)) : line));
}

function tidy(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:)\]」』])/g, "$1")
    .replace(/([(\[「『])\s+/g, "$1")
    .trim();
}

function defaultExport(module: any): any {
  return module?.default?.default ?? module?.default ?? module;
}
