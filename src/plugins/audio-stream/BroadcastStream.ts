export class BroadcastStream {
  private subscribers: Set<ReadableStreamDefaultController<Uint8Array>> =
    new Set();

  // Get a new stream. Any priming pages (e.g. cached Ogg header pages) are
  // enqueued first so the subscriber can initialise its decoder before the
  // live audio pages arrive.
  subscribe(primingPages: Uint8Array[] = []) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const subscribers = this.subscribers;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const page of primingPages) c.enqueue(page);
        subscribers.add(c);
      },
      cancel() {
        subscribers.delete(controller);
      },
    });

    return stream;
  }

  // Write data to all readers.
  write(chunk: Uint8Array) {
    for (const controller of this.subscribers) {
      // Drop slow clients whose queue has backed up rather than buffering
      // chunks for them unboundedly.
      if ((controller.desiredSize ?? 0) <= 0) {
        this.subscribers.delete(controller);
        continue;
      }
      try {
        controller.enqueue(chunk);
      } catch {
        this.subscribers.delete(controller);
      }
    }
  }

  close() {
    for (const controller of this.subscribers) {
      controller.close();
    }
    this.subscribers.clear();
  }
}
