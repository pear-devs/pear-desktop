export class BroadcastStream {
  private subscribers: Set<ReadableStreamDefaultController<Uint8Array>> =
    new Set();

  // A way for readers to get a new stream
  subscribe() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel: () => {
        this.subscribers.delete(controller);
      },
    });

    this.subscribers.add(controller);
    return stream;
  }

  // A way for you to write data to all readers
  write(chunk: Uint8Array) {
    for (const controller of this.subscribers) {
      controller.enqueue(chunk);
    }
  }

  close() {
    for (const controller of this.subscribers) {
      controller.close();
    }
    this.subscribers.clear();
  }
}
