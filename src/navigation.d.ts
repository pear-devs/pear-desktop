/** biome-ignore-all lint/suspicious/noExplicitAny: Type definitions for experimental Navigation API use 'any' to match browser API specification */

interface NavigationOptions {
  info: any;
}

interface NavigationHistoryEntry extends EventTarget {
  readonly url?: string;
  readonly key: string;
  readonly id: string;
  readonly index: number;
  readonly sameDocument: boolean;
  getState(): any;
  ondispose: ((this: NavigationHistoryEntry, ev: Event) => any) | null;
}

interface NavigationTransition {
  readonly navigationType: NavigationType;
  readonly from: NavigationHistoryEntry;
  readonly finished: Promise<undefined>;
}

interface NavigationResult {
  committed: Promise<NavigationHistoryEntry>;
  finished: Promise<NavigationHistoryEntry>;
}

interface NavigationNavigateOptions extends NavigationOptions {
  state: any;
  history?: NavigationHistoryBehavior;
}

interface NavigationReloadOptions extends NavigationOptions {
  state: any;
}

interface NavigationUpdateCurrentEntryOptions {
  state: any;
}

interface NavigationEventsMap {
  currententrychange: NavigateEvent;
  navigate: NavigateEvent;
  navigateerror: NavigateEvent;
  navigatesuccess: NavigateEvent;
}

interface Navigation extends EventTarget {
  entries(): Array<NavigationHistoryEntry>;
  readonly currentEntry?: NavigationHistoryEntry;
  updateCurrentEntry(options: NavigationUpdateCurrentEntryOptions): undefined;
  readonly transition?: NavigationTransition;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  navigate(url: string, options?: NavigationNavigateOptions): NavigationResult;
  reload(options?: NavigationReloadOptions): NavigationResult;
  traverseTo(key: string, options?: NavigationOptions): NavigationResult;
  back(options?: NavigationOptions): NavigationResult;
  forward(options?: NavigationOptions): NavigationResult;
  onnavigate: ((this: Navigation, ev: Event) => any) | null;
  onnavigatesuccess: ((this: Navigation, ev: Event) => any) | null;
  onnavigateerror: ((this: Navigation, ev: Event) => any) | null;
  oncurrententrychange: ((this: Navigation, ev: Event) => any) | null;

  addEventListener<K extends keyof NavigationEventsMap>(
    name: K,
    listener: (event: NavigationEventsMap[K]) => void,
  );
}

declare class NavigateEvent extends Event {
  canIntercept: boolean;
  destination: NavigationHistoryEntry;
  downloadRequest: string | null;
  formData: FormData;
  hashChange: boolean;
  info: Record<string, string>;
  navigationType: 'push' | 'reload' | 'replace' | 'traverse';
  signal: AbortSignal;
  userInitiated: boolean;

  intercept(options?: Record<string, unknown>): void;
  scroll(): void;
}

type NavigationHistoryBehavior = 'auto' | 'push' | 'replace';

declare const Navigation: {
  prototype: Navigation;
  new (): Navigation;
};
