import { YTM_ORIGIN } from "@pear/sdk/util";
import { describe, expect, test } from "vitest";
import { errorPage, loadFailureAction } from "../src/main/load-failure.ts";

describe("loadFailureAction", () => {
  test("an aborted load, an ad frame or the error page itself is no failure", () => {
    expect(loadFailureAction(-3, `${YTM_ORIGIN}/`)).toBe("ignore");
    expect(loadFailureAction(-2, "https://ad.doubleclick.net/x")).toBe("ignore");
    expect(loadFailureAction(-2, "data:text/html,x")).toBe("ignore");
  });

  test("offline, a page other than home falls back to home", () => {
    expect(loadFailureAction(-106, `${YTM_ORIGIN}/library`)).toBe("home");
  });

  test("anything else shows the error page", () => {
    expect(loadFailureAction(-106, `${YTM_ORIGIN}/`)).toBe("error-page");
    expect(loadFailureAction(-105, `${YTM_ORIGIN}/library`)).toBe("home");
    expect(loadFailureAction(-200, `${YTM_ORIGIN}/library`)).toBe("error-page");
    expect(loadFailureAction(-310, `${YTM_ORIGIN}/watch?v=x`)).toBe("error-page");
  });
});

test("the error page retries the page that failed, with its text escaped", () => {
  const url = `${YTM_ORIGIN}/search?q=a&b="<x>`;
  const page = decodeURIComponent(errorPage(url, { title: "T", message: "Can't <load>", retry: "Retry" }).split(",").slice(1).join(","));
  expect(page).toContain(`href="${url.replaceAll("&", "&#38;").replaceAll('"', "&#34;").replaceAll("<", "&#60;").replaceAll(">", "&#62;")}"`);
  expect(page).toContain("Can&#39;t &#60;load&#62;");
  expect(page).toContain(">Retry</a>");
});
