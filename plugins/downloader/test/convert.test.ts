import { describe, expect, test } from "vitest";
import {
  chooseConverter,
  type Converter,
  codecOf,
  ffmetadata,
  ffmpegArgs,
  loudnessTags,
  metadataOf,
  outputFor,
  parseLoudness,
  parseProgressLine,
  pictureBlock,
  preferredContainer,
} from "../convert.ts";

const after = (args: string[], flag: string) => args.filter((_, i) => args[i - 1] === flag);

describe("formats", () => {
  test("streams are copied when the format keeps their codec", () => {
    expect(outputFor("mp3", { codec: "opus" })).toEqual({ ext: "mp3", codecArgs: ["-c:a", "libmp3lame", "-q:a", "0"] });
    expect(outputFor("m4a", { codec: "aac" })).toEqual({ ext: "m4a", codecArgs: ["-c:a", "copy"] });
    expect(outputFor("m4a", { codec: "opus" }).codecArgs).toContain("aac");
    expect(outputFor("opus", { codec: "opus" })).toEqual({ ext: "opus", codecArgs: ["-c:a", "copy"] });
    expect(outputFor("source", { codec: "aac" })).toEqual({ ext: "m4a", codecArgs: ["-c:a", "copy"] });
    expect(outputFor("source", { codec: "opus" })).toEqual({ ext: "opus", codecArgs: ["-c:a", "copy"] });
    expect(preferredContainer("m4a")).toBe("mp4");
    expect(preferredContainer("opus")).toBe("webm");
    expect(codecOf('audio/webm; codecs="opus"')).toBe("opus");
    expect(codecOf('audio/mp4; codecs="mp4a.40.2"')).toBe("aac");
  });
});

describe("ffmpegArgs", () => {
  const base = { input: "in.part", metadataFile: "meta.txt", output: "out.temp", codecArgs: ["-c:a", "copy"] };

  test("MP3: the cover as an attached picture, ID3v2.3", () => {
    const args = ffmpegArgs({ ...base, ext: "mp3", coverFile: "cover.jpg" });
    expect(after(args, "-i")).toEqual(["in.part", "meta.txt", "cover.jpg"]);
    expect(after(args, "-map")).toEqual(["0:a:0", "2:v"]);
    expect(after(args, "-map_metadata")).toEqual(["1"]);
    expect(after(args, "-disposition:v")).toEqual(["attached_pic"]);
    expect(after(args, "-id3v2_version")).toEqual(["3"]);
    expect(args.slice(-3)).toEqual(["-f", "mp3", "out.temp"]);
  });

  test("M4A: the cover as an attached picture in the ipod muxer", () => {
    const args = ffmpegArgs({ ...base, ext: "m4a", coverFile: "cover.jpg" });
    expect(after(args, "-map")).toEqual(["0:a:0", "2:v"]);
    expect(after(args, "-f")).toEqual(["ipod"]);
    expect(args).not.toContain("-id3v2_version");
  });

  test("Opus: the cover goes in the tags, so no picture stream", () => {
    const args = ffmpegArgs({ ...base, ext: "opus", coverFile: "cover.jpg" });
    expect(after(args, "-i")).toEqual(["in.part", "meta.txt"]);
    expect(after(args, "-map")).toEqual(["0:a:0"]);
    expect(after(args, "-f")).toEqual(["ogg"]);
  });

  test("without a cover, only the audio", () => {
    expect(after(ffmpegArgs({ ...base, ext: "mp3" }), "-map")).toEqual(["0:a:0"]);
  });
});

describe("tags", () => {
  test("metadata by ffmpeg's names, in an escaped ffmetadata file", () => {
    const metadata = metadataOf({ title: "A=B; #1", artist: "C", album: "D", albumArtist: "E", year: 1987, track: 3, trackCount: 10 }, "m4a");
    expect(metadata).toEqual({ title: "A=B; #1", artist: "C", album: "D", album_artist: "E", date: "1987", track: "3/10" });
    expect(ffmetadata({ title: "A=B; #1", comment: "x\\y\nz" })).toBe(";FFMETADATA1\ntitle=A\\=B\\; \\#1\ncomment=x\\\\y\\\nz\n");
    expect(metadataOf({ title: "Only" }, "mp3")).toEqual({ title: "Only" });
    // MP3 lyrics are written as USLT separately.
    expect(metadataOf({ title: "t", lyrics: "la la" }, "opus")).toEqual({ title: "t", lyrics: "la la" });
    expect(metadataOf({ title: "t", lyrics: "la la" }, "mp3")).toEqual({ title: "t" });
  });

  test("Opus covers as a FLAC picture block", () => {
    const block = Buffer.from(pictureBlock({ data: Buffer.from([1, 2, 3]), width: 500, height: 400 }), "base64");
    expect(block.readUInt32BE(0)).toBe(3);
    expect(block.subarray(8, 18).toString()).toBe("image/jpeg");
    const description = 18;
    expect(block.readUInt32BE(description)).toBe(5);
    const width = description + 4 + 5;
    expect(block.readUInt32BE(width)).toBe(500);
    expect(block.readUInt32BE(width + 4)).toBe(400);
    expect(block.readUInt32BE(width + 16)).toBe(3);
    expect([...block.subarray(-3)]).toEqual([1, 2, 3]);
  });

  test("ffmpeg's -progress lines", () => {
    expect(parseProgressLine("out_time_us=12500000")).toBe(12.5);
    expect(parseProgressLine("out_time_ms=1000000")).toBe(1);
    expect(parseProgressLine("progress=continue")).toBeUndefined();
  });
});

describe("ReplayGain", () => {
  const summary = [
    "[Parsed_ebur128_0 @ 0x7f2800003d00] t: 4.9  TARGET:-23 LUFS    M: -21.8 S: -21.8     I: -21.9 LUFS",
    "[Parsed_ebur128_0 @ 0x7f2800003d00] Summary:",
    "",
    "  Integrated loudness:",
    "    I:         -21.8 LUFS",
    "    Threshold: -31.8 LUFS",
    "",
    "  True peak:",
    "    Peak:      -17.9 dBFS",
  ].join("\n");

  test("reads ffmpeg's ebur128 summary", () => {
    expect(parseLoudness(summary)).toEqual({ integrated: -21.8, peak: -17.9 });
    expect(parseLoudness("no summary")).toBeUndefined();
  });

  test("ReplayGain 2.0 for MP3, R128 for Opus, nothing ffmpeg would drop for M4A", () => {
    const loudness = { integrated: -14, peak: -1 };
    expect(loudnessTags("mp3", loudness)).toEqual({ REPLAYGAIN_TRACK_GAIN: "-4.00 dB", REPLAYGAIN_TRACK_PEAK: "0.891251" });
    expect(loudnessTags("mp3", { integrated: -21.8, peak: -17.9 }).REPLAYGAIN_TRACK_GAIN).toBe("+3.80 dB");
    expect(loudnessTags("opus", loudness)).toEqual({ R128_TRACK_GAIN: String(-9 * 256) });
    expect(loudnessTags("m4a", loudness)).toEqual({});
  });
});

describe("chooseConverter", () => {
  const wasm: Converter = { kind: "wasm", convert: async () => {} };

  test("native ffmpeg when there is one, ffmpeg.wasm otherwise", () => {
    expect(chooseConverter("/usr/bin/ffmpeg", () => wasm).kind).toBe("native");
    expect(chooseConverter(undefined, () => wasm)).toBe(wasm);
  });

  test("an ffmpeg that won't start falls back to ffmpeg.wasm", async () => {
    let used = false;
    const converter = chooseConverter("/nonexistent/ffmpeg", () => ({ kind: "wasm", convert: async () => void (used = true) }));
    await converter.convert({
      input: "in",
      output: "out",
      ext: "mp3",
      codecArgs: [],
      tags: { title: "t" },
      duration: 1,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(used).toBe(true);
  });
});
