export class StartupLifecycle {
  #disposed = false;
  #generation = 0;

  async initialize<T>(
    getConfig: () => T | Promise<T>,
    onReady: (config: T) => void,
  ) {
    this.#disposed = false;
    const generation = ++this.#generation;
    const config = await getConfig();

    if (this.#disposed || generation !== this.#generation) {
      return;
    }

    onReady(config);
  }

  dispose() {
    this.#disposed = true;
    this.#generation++;
  }
}