import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import { killTree } from "../engines/ytdlp.ts";
import { parseDestination } from "../ytdlp.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("cancelling yt-dlp", () => {
  test("knows the files it starts", () => {
    expect(parseDestination("[download] Destination: /music/A - B.webm")).toBe("/music/A - B.webm");
    expect(parseDestination("[ExtractAudio] Destination: /music/A - B.mp3")).toBe("/music/A - B.mp3");
    expect(parseDestination("[download] 50.0% of 3.00MiB")).toBeUndefined();
  });

  test.skipIf(process.platform === "win32")("stops the programs it started too", async () => {
    // A shell that starts a child, as yt-dlp starts ffmpeg; it prints the child's pid.
    const child = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const grandchild = await new Promise<number>((resolve) => child.stdout.once("data", (data: Buffer) => resolve(Number(String(data).trim()))));
    expect(alive(grandchild)).toBe(true);
    killTree(child);
    await new Promise((resolve) => child.once("close", resolve));
    await expect.poll(() => alive(grandchild)).toBe(false);
  });
});
