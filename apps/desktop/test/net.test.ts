import { YTM_ORIGIN } from "@pear/sdk/util";
import { expect, test } from "vitest";
import { rewriteResponseHeaders } from "../src/main/net.ts";

test("responses lose their CSP, in any spelling", () => {
  const headers = rewriteResponseHeaders({
    "Content-Security-Policy": ["default-src 'self'"],
    "content-security-policy-report-only": ["x"],
    "Content-Type": ["text/html"],
  });
  expect(headers).toEqual({ "Content-Type": ["text/html"], "access-control-allow-origin": [YTM_ORIGIN] });
});

test("YTM may read responses without a CORS header; an existing one stays", () => {
  expect(rewriteResponseHeaders({})["access-control-allow-origin"]).toEqual([YTM_ORIGIN]);
  expect(rewriteResponseHeaders({ "Access-Control-Allow-Origin": ["*"] })).toEqual({ "Access-Control-Allow-Origin": ["*"] });
});
