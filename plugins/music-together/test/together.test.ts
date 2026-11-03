import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ConnectionLike, ConnectionListener, ConnectionMode } from "../connection.ts";
import { Queue, type QueueElement, type QueueItem, type StoreEvent } from "../queue.ts";
import { Together, type TogetherEnvironment } from "../together.ts";
import type { ConnectionEventMap, ConnectionEventUnion } from "../types.ts";

// An in-memory PeerJS: the host sees each guest's connection, guests see the host.
class Network {
  host: FakeConnection | undefined;
  guests: FakeConnection[] = [];
}

class FakeConnection implements ConnectionLike {
  mode: ConnectionMode = "disconnected";
  listeners: ConnectionListener[] = [];
  connectionListeners: ((connection?: never) => void)[] = [];
  constructor(
    public id: string,
    private network: Network,
  ) {}
  waitForReady() {
    if (this.mode === "disconnected") {
      this.mode = "host";
      this.network.host ??= this;
    }
    return Promise.resolve(this.id);
  }
  async connect() {
    this.mode = "guest";
    if (this.network.host === this) this.network.host = undefined;
    this.network.guests.push(this);
  }
  disconnect() {
    this.mode = "disconnected";
  }
  async broadcast<E extends keyof ConnectionEventMap>(type: E, payload: ConnectionEventMap[E], after?: ConnectionEventUnion[]) {
    const event = structuredClone({ type, payload, ...(after ? { after } : {}) }) as ConnectionEventUnion;
    const targets = this.mode === "host" ? this.network.guests : this.network.host ? [this.network.host] : [];
    for (const target of targets) {
      const conn = this.mode === "host" ? null : ({ peer: this.id, open: true } as never);
      for (const listener of target.listeners) await listener(structuredClone(event), conn);
    }
  }
  on(listener: ConnectionListener) {
    this.listeners.push(listener);
  }
  onConnections(listener: (connection?: never) => void) {
    this.connectionListeners.push(listener);
  }
}

/** YTM's queue store, reduced to items of video ids. */
function fakeQueue(ids: string[] = []) {
  let items: QueueItem[] = ids.map((videoId) => ({ playlistPanelVideoRenderer: { videoId } }));
  const applied: StoreEvent[] = [];
  const store = {
    getState: () => ({ queue: { items, queueContextParams: "", nextQueueItemId: items.length } }),
    dispatch(event: StoreEvent) {
      applied.push(event);
      const payload = event.payload as { items?: QueueItem[]; index?: number | null } | number | undefined;
      if (event.type === "ADD_ITEMS" && typeof payload === "object" && payload?.items) {
        const at = typeof payload.index === "number" ? payload.index + 1 : items.length;
        items = [...items.slice(0, at), ...payload.items, ...items.slice(at)];
      } else if (event.type === "REMOVE_ITEM" && typeof payload === "number") items = items.filter((_, i) => i !== payload);
      else if (event.type === "CLEAR") items = [];
      else if (event.type === "UPDATE_ITEMS" && typeof payload === "object" && payload?.items) items = payload.items;
    },
  };
  // YTM's #queue dispatches through its store (and so through the session's wrapper).
  const element = { queue: { store: { store } }, dispatch: (event: StoreEvent) => store.dispatch(event) } as unknown as QueueElement;
  /** What YTM does when a user uses "Add to queue". */
  const userAdds = (videoId: string) => store.dispatch({ type: "ADD_ITEMS", payload: { items: [{ playlistPanelVideoRenderer: { videoId } }] } });
  return { element, store, applied, ids: () => items.map((item) => ("playlistPanelVideoRenderer" in item ? item.playlistPanelVideoRenderer.videoId : "")), userAdds };
}

beforeEach(() => {
  // YTM's /music/get_queue answers with queue items for the ids.
  const app = {
    networkManager: {
      fetch: async (_: string, body: { videoIds: string[] }) => ({
        queueDatas: body.videoIds.map((videoId) => ({ content: { playlistPanelVideoRenderer: { videoId } } })),
      }),
    },
  };
  vi.stubGlobal("document", { querySelector: () => app, querySelectorAll: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

function environment(network: Network, id: string, queue: ReturnType<typeof fakeQueue>, toasts: string[]): TogetherEnvironment {
  return {
    createConnection: () => new FakeConnection(id, network),
    queueElement: () => queue.element,
    player: () => null,
    toast: (message) => toasts.push(message),
    t: (_key, fallback = "", vars) => fallback.replace(/{{(\w+)}}/g, (_, name: string) => String(vars?.[name] ?? "")),
    name: () => id,
    defaultPermission: () => "playlist",
    log: { warn() {}, error() {} },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("pear-desktop's Music Together", () => {
  test("YTM's own queue changes go to the session instead of the queue", () => {
    const queue = fakeQueue(["a"]);
    const shared = new Queue({ queue: queue.element, getProfile: () => undefined, t: (_k, f = "") => f });
    const events: ConnectionEventUnion[] = [];
    shared.on((event) => events.push(event));
    shared.setOwner({ id: "me", handleId: "", name: "Me", thumbnail: "" });
    shared.injection();
    queue.userAdds("b");
    expect(events).toEqual([{ type: "ADD_SONGS", payload: { videoList: [{ videoId: "b", ownerId: "me" }] } }]);
    expect(queue.ids()).toEqual(["a"]);
    // Autoplay is off during a session.
    queue.store.dispatch({ type: "ADD_AUTOMIX_ITEMS", payload: {} });
    shared.rollbackInjection();
    queue.userAdds("c");
    expect(queue.ids()).toEqual(["a", "c"]);
  });

  test("a guest's song reaches the host's queue and every guest's, with its owner", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue();
    const toasts: string[] = [];
    const host = new Together(environment(network, "host-id", hostQueue, toasts));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    expect(await host.host()).toBe(true);
    expect(await guest.join("host-id")).toBe(true);
    await settle();
    // The guest got the host's queue and identified itself.
    expect(guestQueue.ids()).toEqual(["a"]);
    expect(toasts).toContain("guest-id joined Music Together");
    expect(Object.keys(guest.profiles).sort()).toEqual(["guest-id", "host-id"]);

    guestQueue.userAdds("b");
    await settle();
    expect(hostQueue.ids()).toEqual(["a", "b"]);
    expect(host.queue!.videoList.at(-1)).toEqual({ videoId: "b", ownerId: "guest-id" });
    expect(guestQueue.ids()).toEqual(["a", "b"]);
    host.stop();
    guest.stop();
  });

  test("with host-only, a guest's change is refused and the host's queue sent back", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue();
    const host = new Together(environment(network, "host-id", hostQueue, []));
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    await host.host();
    await guest.join("host-id");
    await host.setPermission("host-only");
    await settle();
    expect(guest.permission).toBe("host-only");
    guestQueue.userAdds("b");
    await settle();
    expect(hostQueue.ids()).toEqual(["a"]);
    expect(guestQueue.ids()).toEqual(["a"]);
    host.stop();
    guest.stop();
  });

  test("stopping while hosting waits for PeerJS destroys the peer and sets nothing up", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const toasts: string[] = [];
    const connection = new PendingConnection("host-id", network);
    const host = new Together({ ...environment(network, "host-id", hostQueue, toasts), createConnection: () => connection });
    const hosting = host.host();
    expect(host.connecting).toBe(true);
    host.stop();
    expect(connection.disconnects).toBe(1);
    expect(host.connecting).toBe(false);
    connection.open();
    expect(await hosting).toBe(false);
    // No queue injection: YTM's own changes apply as usual.
    hostQueue.userAdds("b");
    expect(hostQueue.ids()).toEqual(["a", "b"]);
    expect(host.queue).toBeUndefined();
    expect(toasts).toEqual([]);
  });

  test("a guest stopped while joining leaves YTM's queue alone", async () => {
    const network = new Network();
    const hostQueue = fakeQueue(["a"]);
    const guestQueue = fakeQueue(["mine"]);
    const guest = new Together(environment(network, "guest-id", guestQueue, []));
    // The guest stops while its IDENTIFY is on the way to the host.
    const host = new Together({ ...environment(network, "host-id", hostQueue, []), toast: () => guest.stop() });
    await host.host();
    expect(await guest.join("host-id")).toBe(false);
    await settle();
    expect(guestQueue.ids()).toEqual(["mine"]);
    expect(guest.mode).toBe("disconnected");
    host.stop();
  });

  test("hosting fails after a while when PeerJS never opens", async () => {
    vi.useFakeTimers();
    try {
      const network = new Network();
      const toasts: string[] = [];
      const connection = new PendingConnection("host-id", network);
      const host = new Together({ ...environment(network, "host-id", fakeQueue(), toasts), createConnection: () => connection });
      const hosting = host.host();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await hosting).toBe(false);
      expect(toasts).toEqual(["Failed to host Music Together"]);
      expect(connection.disconnects).toBe(1);
      expect(host.connecting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A connection whose PeerJS peer opens only when told to. */
class PendingConnection extends FakeConnection {
  disconnects = 0;
  #open!: () => void;
  #ready = new Promise<void>((resolve) => (this.#open = resolve));
  open() {
    this.#open();
  }
  override async waitForReady() {
    await this.#ready;
    return super.waitForReady();
  }
  override disconnect() {
    this.disconnects++;
    super.disconnect();
  }
}
