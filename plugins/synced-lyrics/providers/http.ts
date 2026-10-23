export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
// LRCLIB asks clients to identify themselves.
const USER_AGENT = "Pear Desktop (synced-lyrics; https://github.com/pear-devs/pear-desktop)";

export async function request(fetch: Fetch, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`);
  return response;
}

export async function getJson<T>(fetch: Fetch, url: string, init?: RequestInit): Promise<T> {
  return (await request(fetch, url, init)).json() as Promise<T>;
}
