import { IDLE } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/main/api/jwt.ts";
import { validateBody } from "../src/main/api/body-schema.ts";
import { songInfo } from "../src/main/api/song-info.ts";
import { isAuthorized } from "../src/main/api/server.ts";

describe("tokens", () => {
  it("round-trips and rejects tampering or another secret", () => {
    const token = signToken({ id: "remote", iat: 1 }, "secret");
    expect(verifyToken(token, "secret")).toEqual({ id: "remote", iat: 1 });
    expect(verifyToken(token, "other")).toBeNull();
    const [header, , sig] = token.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ id: "admin", iat: 1 })).toString("base64url")}.${sig}`;
    expect(verifyToken(forged, "secret")).toBeNull();
    expect(verifyToken("garbage", "secret")).toBeNull();
  });

  it("authorizes only listed clients unless auth is off", () => {
    const token = signToken({ id: "remote", iat: 1 }, "secret");
    const auth = { authStrategy: "AUTH_AT_FIRST" as const, secret: "secret", authorizedClients: ["remote"] };
    expect(isAuthorized(auth, `Bearer ${token}`)).toBe(true);
    expect(isAuthorized({ ...auth, authorizedClients: [] }, `Bearer ${token}`)).toBe(false);
    expect(isAuthorized(auth, undefined)).toBe(false);
    expect(isAuthorized(auth, token, false)).toBe(true);
    expect(isAuthorized({ ...auth, authStrategy: "NONE" }, undefined)).toBe(true);
  });
});

describe("validateBody", () => {
  it("checks types, optional fields and enums", () => {
    expect(validateBody({ seconds: "number" }, { seconds: 4.5 })).toBeNull();
    expect(validateBody({ seconds: "number" }, { seconds: "4" })).toBe("seconds must be a number");
    expect(validateBody({ index: "integer" }, { index: -1 })).toBe("index must be a non-negative integer");
    expect(validateBody({ query: "string", params: "string?" }, { query: "x" })).toBeNull();
    expect(validateBody({ at: ["A", "B"] }, { at: "C" })).toBe("at must be one of A, B");
    expect(validateBody({ at: ["A", "B"] }, {})).toBeNull();
    expect(validateBody({}, [])).toBe("expected a JSON object");
  });
});

describe("songInfo", () => {
  it("maps the player state onto the original SongInfo shape", () => {
    const state = {
      ...IDLE,
      status: "paused" as const,
      positionSeconds: 12.7,
      track: {
        videoId: "v",
        title: "T",
        artist: "A",
        durationSeconds: 100,
        url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=v",
        mediaType: "video" as const,
      },
    };
    expect(songInfo(state, { videoId: "v", views: 5, tags: ["x"], musicVideoType: "MUSIC_VIDEO_TYPE_UGC" })).toMatchObject({
      title: "T",
      isPaused: true,
      elapsedSeconds: 12,
      views: 5,
      album: null,
      imageSrc: null,
      tags: ["x"],
      mediaType: "USER_GENERATED_CONTENT",
    });
    // Details of another track are ignored.
    expect(songInfo(state, { videoId: "w", views: 5, tags: [] })).toMatchObject({ views: 0, mediaType: "ORIGINAL_MUSIC_VIDEO" });
    expect(songInfo(IDLE, undefined)).toBeNull();
  });
});
