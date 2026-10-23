import { describe, expect, test } from "vitest";
import { openableUrl } from "../open.ts";

describe("OpenUri", () => {
  test("opens YTM links, and the video site's, in YTM", () => {
    expect(openableUrl("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc&list=PL1")).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc&list=PL1");
    expect(openableUrl("https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc")).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc");
    expect(openableUrl("https://youtu.be/abc")).toBe("https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=abc");
  });

  test("refuses anything else", () => {
    expect(openableUrl("https://example.com/watch?v=abc")).toBeNull();
    expect(openableUrl("http://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/")).toBeNull();
    expect(openableUrl("file:///etc/passwd")).toBeNull();
    expect(openableUrl("not a url")).toBeNull();
  });
});
