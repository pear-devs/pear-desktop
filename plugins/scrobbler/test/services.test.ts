import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Fetch, LastFmError, lastFm, lastFmSignature, type Listen, listenBrainzBody, listenBrainzSubmit } from "../services.ts";

const md5 = (text: string) => createHash("md5").update(text).digest("hex");
const credentials = { apiRoot: "https://lastfm.test/2.0/", apiKey: "KEY", secret: "SECRET" };
const listen: Listen = {
  title: "Song",
  artist: "Artist",
  album: "Album",
  durationSeconds: 212.6,
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc",
  startedAt: 1_700_000_000_500,
};

function fakeFetch(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(reply), { status });
  };
  return { fetch, calls };
}

describe("Last.fm", () => {
  it("signs sorted parameters without format", () => {
    expect(lastFmSignature({ method: "auth.getToken", api_key: "KEY", format: "json" }, "SECRET")).toBe(
      md5("api_keyKEYmethodauth.getTokenSECRET"),
    );
  });

  it("scrobbles with the play's start time and a signature", async () => {
    const { fetch, calls } = fakeFetch({ scrobbles: {} });
    await lastFm.scrobble(fetch, credentials, "SK", listen);
    const [call] = calls;
    expect(call!.url).toBe(credentials.apiRoot);
    expect(call!.init!.method).toBe("POST");
    const body = Object.fromEntries(call!.init!.body as URLSearchParams);
    expect(body).toMatchObject({
      method: "track.scrobble",
      sk: "SK",
      track: "Song",
      artist: "Artist",
      album: "Album",
      duration: "213",
      timestamp: "1700000000",
      api_key: "KEY",
      format: "json",
    });
    const { api_sig, format: _, ...signed } = body;
    expect(api_sig).toBe(lastFmSignature(signed, "SECRET"));
  });

  it("surfaces API errors with their code", async () => {
    const { fetch } = fakeFetch({ error: 9, message: "Invalid session key" }, 403);
    await expect(lastFm.updateNowPlaying(fetch, credentials, "SK", listen)).rejects.toEqual(
      new LastFmError(9, "Invalid session key"),
    );
  });

  it("exchanges an approved token for a session", async () => {
    const { fetch, calls } = fakeFetch({ session: { key: "SESSION", name: "user" } });
    expect(await lastFm.getSession(fetch, credentials, "TOKEN")).toEqual({ key: "SESSION", name: "user" });
    expect(calls[0]!.url).toContain("method=auth.getSession");
    expect(calls[0]!.url).toContain("token=TOKEN");
  });
});

describe("ListenBrainz", () => {
  it("submits playing_now without a timestamp and listens with one", async () => {
    expect(listenBrainzBody("playing_now", listen).payload[0]).not.toHaveProperty("listened_at");
    expect(listenBrainzBody("single", listen).payload[0]).toMatchObject({
      listened_at: 1_700_000_000,
      track_metadata: { artist_name: "Artist", track_name: "Song", release_name: "Album" },
    });
  });

  it("authenticates with the user token", async () => {
    const { fetch, calls } = fakeFetch({ status: "ok" });
    await listenBrainzSubmit(fetch, "https://lb.test/1", "TOKEN", "single", listen);
    expect(calls[0]!.url).toBe("https://lb.test/1/submit-listens");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Token TOKEN");
  });

  it("rejects on HTTP errors", async () => {
    const { fetch } = fakeFetch({ error: "Invalid authorization token." }, 401);
    await expect(listenBrainzSubmit(fetch, "https://lb.test/1/", "BAD", "single", listen)).rejects.toThrow(
      "ListenBrainz responded 401: Invalid authorization token.",
    );
  });
});
