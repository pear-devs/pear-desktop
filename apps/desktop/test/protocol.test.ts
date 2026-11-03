import { describe, expect, test } from "vitest";
import { APP_PROTOCOL, findProtocolLink, parseProtocolLink, protocolActions } from "../src/main/protocol.ts";

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
});
