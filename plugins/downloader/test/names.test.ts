import { describe, expect, test } from "vitest";
import { cleanupName } from "../names.ts";

describe("cleanupName", () => {
  test("drops the video's dressing as pear-desktop did, whatever the case", () => {
    expect(cleanupName("Rick Astley - Topic")).toBe("Rick Astley");
    expect(cleanupName("Rick Astley - TOPIC")).toBe("Rick Astley");
    expect(cleanupName("RickAstleyVEVO")).toBe("RickAstley");
    expect(cleanupName("Never Gonna Give You Up (Official Music Video)")).toBe("Never Gonna Give You Up");
    expect(cleanupName("Song [Official Visualizer]")).toBe("Song");
    expect(cleanupName("Song (Lyric Video)")).toBe("Song");
    expect(cleanupName("Song [lyrics]")).toBe("Song");
    expect(cleanupName("Song (Official Audio)")).toBe("Song");
    expect(cleanupName("Song (Performance Video)")).toBe("Song");
    expect(cleanupName("Song (Video Version)")).toBe("Song");
    expect(cleanupName("Song [HD Audio]")).toBe("Song");
    expect(cleanupName("Song (Live)")).toBe("Song");
    expect(cleanupName("Song (4K Upgrade)")).toBe("Song");
    // Only at the end where pear-desktop anchored it.
    expect(cleanupName("Live (Live) Forever")).toBe("Live (Live) Forever");
    expect(cleanupName("Song (Remix)")).toBe("Song (Remix)");
    expect(cleanupName("")).toBe("");
    expect(cleanupName(undefined)).toBeUndefined();
  });
});
