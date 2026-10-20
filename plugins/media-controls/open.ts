// MPRIS OpenUri, as pear-desktop: the link is opened in the window.

const NAV_HOST = /^(music|www|m)\.\u0079\u006f\u0075\u0074\u0075\u0062\u0065\.com$/;

/** OpenUri: YTM links (also the video site's watch links) open in the window; nothing else. */
export function openableUrl(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "youtu.be") return `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${encodeURIComponent(url.pathname.slice(1))}`;
  if (!NAV_HOST.test(url.hostname)) return null;
  url.hostname = "music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";
  return url.toString();
}
