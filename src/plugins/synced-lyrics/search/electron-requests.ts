import { bounded, classifyFailure, type Transport } from './http';

// Main-process owner of privileged requests; testable without importing Electron.
export class ElectronLyricsRequests {
  private requests = new Map<string, AbortController>();
  constructor(
    private transport: Transport,
    private timeoutMs = 10000,
  ) {}
  get size() {
    return this.requests.size;
  }
  async fetch(id: string, url: string, init: RequestInit) {
    const controller = new AbortController();
    this.requests.set(id, controller);
    try {
      return await bounded(
        async (signal) => {
          const response = await this.transport(url, { ...init, signal });
          return {
            status: response.status,
            body: await response.text(),
            headers: Object.fromEntries(response.headers.entries()),
          };
        },
        controller.signal,
        this.timeoutMs,
      );
    } catch (error) {
      const failure = classifyFailure(error);
      return { error: failure.kind, message: failure.message };
    } finally {
      this.requests.delete(id);
    }
  }
  cancel(id: string) {
    this.requests.get(id)?.abort();
  }
  dispose() {
    for (const request of this.requests.values()) request.abort();
    this.requests.clear();
  }
}
