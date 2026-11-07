import { describe, expect, test } from "vitest";
import { APP_PROTOCOL, findProtocolLink, parseProtocolLink, protocolActions, protocolTasks } from "../src/main/protocol.ts";

const link = (command: string) => `${APP_PROTOCOL}://${command}`;

describe("app protocol", () => {
  test("parses pear-desktop's links", () => {
    expect(parseProtocolLink(link("playPause"))).toEqual({ command: "playPause", args: [] });
    expect(parseProtocolLink(link("seekTo%2042/"))).toEqual({ command: "seekTo", args: ["42"] });
    expect(parseProtocolLink("https://example.com")).toBeNull();
    expect(findProtocolLink(["/usr/bin/app", "--flag", link("next")])).toEqual({ command: "next", args: [] });
  });

  test("maps song controls onto player actions", () => {
    expect(protocolActions({ command: "playPause", args: [] })).toEqual([{ type: "toggle" }]);
    expect(protocolActions({ command: "goBack", args: ["10"] })).toEqual([{ type: "seekBy", seconds: -10 }]);
    expect(protocolActions({ command: "setVolume", args: ["40"] })).toEqual([{ type: "volume", value: 40 }]);
    expect(protocolActions({ command: "switchRepeat", args: ["2"] })).toEqual([{ type: "repeat" }, { type: "repeat" }]);
    expect(protocolActions({ command: "seekTo", args: ["soon"] })).toEqual([]);
    expect(protocolActions({ command: "rm -rf", args: [] })).toEqual([]);
  });

  test("maps pear-desktop's queue, full screen and search box commands", () => {
    const tasks = (command: string, ...args: string[]) => protocolTasks({ command, args });
    expect(tasks("addSongToQueue", "abc")).toEqual([{ type: "page", event: "queue:add", payload: { videoId: "abc", insertPosition: "INSERT_AT_END" } }]);
    expect(tasks("addSongToQueue", "abc", "INSERT_AFTER_CURRENT_VIDEO")).toEqual([
      { type: "page", event: "queue:add", payload: { videoId: "abc", insertPosition: "INSERT_AFTER_CURRENT_VIDEO" } },
    ]);
    expect(tasks("addSongToQueue", "abc", "SOMEWHERE")).toEqual([]);
    expect(tasks("moveSongInQueue", "2", "0")).toEqual([{ type: "page", event: "queue:move", payload: { fromIndex: 2, toIndex: 0 } }]);
    expect(tasks("moveSongInQueue", "2")).toEqual([]);
    expect(tasks("removeSongFromQueue", "1")).toEqual([{ type: "page", event: "queue:remove", payload: 1 }]);
    expect(tasks("removeSongFromQueue", "-1")).toEqual([]);
    expect(tasks("setQueueIndex", "3")).toEqual([{ type: "page", event: "queue:set-index", payload: 3 }]);
    expect(tasks("clearQueue")).toEqual([{ type: "page", event: "queue:clear" }]);
    expect(tasks("setFullscreen", "true")).toEqual([{ type: "fullscreen", fullscreen: true }]);
    expect(tasks("setFullscreen", "maybe")).toEqual([]);
    expect(tasks("openSearchBox")).toEqual([{ type: "open-search" }]);
    expect(tasks("playPause")).toEqual([]);
  });
});
