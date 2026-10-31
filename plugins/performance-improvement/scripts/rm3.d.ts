declare class Rm3LinkedArrayNode<T> {
  value: T;
  next: Rm3LinkedArrayNode<T> | null;
  prev: Rm3LinkedArrayNode<T> | null;
  constructor(value: T);
}

declare class Rm3LinkedArray<T> {
  head: Rm3LinkedArrayNode<T> | null;
  tail: Rm3LinkedArrayNode<T> | null;
  length: number;

  constructor();

  push(value: T): number;
  pop(): T | undefined;
  unshift(value: T): number;
  shift(): T | undefined;
  size(): number;
  getNode(index: number): Rm3LinkedArrayNode<T> | null;
  get(index: number): T | undefined;
  findNode(value: T): { node: Rm3LinkedArrayNode<T> | null; index: number };
  toArray(): T[];
  insertBeforeNode(node: Rm3LinkedArrayNode<T> | null, newValue: T): boolean;
  insertAfterNode(node: Rm3LinkedArrayNode<T> | null, newValue: T): boolean;
  insertBefore(existingValue: T, newValue: T): boolean;
  insertAfter(existingValue: T, newValue: T): boolean;
  deleteNode(node: Rm3LinkedArrayNode<T>): boolean; // Note: Original JS allowed deleting null, but TS implies non-null here

  static Node: typeof Rm3LinkedArrayNode;
}

// Define the structure of the internal LimitedSizeSet class
declare class Rm3LimitedSizeSet<T> extends Set<T> {
  limit: number;
  constructor(n: number);
  add(key: T): this;
  removeAdd(key: T): void;
}

// Define the structure of the entryRecord tuple used internally
// [ WeakRef<HTMLElement>, attached time, detached time, time of change, inside availablePool, reuse count ]
type Rm3EntryRecord = [
  WeakRef<HTMLElement>,
  number,
  number,
  number,
  boolean,
  number,
];

// Define the interface for the exported rm3 object
export interface Rm3 {
  /**
   * Removes duplicate values from an array.
   * @param array The input array.
   * @returns A new array with unique values.
   */
  uniq: <T>(array: T[]) => T[];

  /**
   * [Debug only] The current page URL. Only available if DEBUG_OPT was true.
   */
  location?: string;

  /**
   * [Debug only] Inspects the document for elements with a polymerController and returns their unique node names.
   * @returns An array of unique node names.
   */
  inspect: () => string[];

  /**
   * A Set containing records of element operations (attach/detach).
   * Each record tracks an element's lifecycle state.
   */
  operations: Set<Rm3EntryRecord>;

  /**
   * A Map where keys are component identifiers (e.g., "creatorTag.componentTag")
   * and values are LinkedArrays of potentially reusable EntryRecords for detached elements.
   */
  availablePools: Map<string, Rm3LinkedArray<Rm3EntryRecord>>;

  /**
   * Checks the parent status of elements tracked in the operations set.
   * Primarily for elements that have been detached (detached time > 0).
   * @returns An array of tuples: [elementExists: boolean, nodeName: string | undefined, isParentNull: boolean]
   */
  checkWhetherUnderParent: () => [boolean, string | undefined, boolean][];

  /**
   * Gets a list of unique element tag names (from `element.is`) that have been tracked.
   * @returns An array of unique tag names.
   */
  hookTags: () => string[];

  /**
   * [Debug only] A Set containing tags that have had their methods hooked. Only available if DEBUG_OPT was true.
   */
  hookTos?: Set<string>;

  /**
   * [Debug only] A function that returns an array representation of the reuse record log. Only available if DEBUG_OPT was true.
   * @returns An array of tuples: [timestamp, tagName, entryRecord]
   */
  reuseRecord?: () => [number, string, Rm3EntryRecord][];

  /**
   * [Debug only] A Map tracking the reuse count per component tag name. Only available if DEBUG_OPT was true.
   */
  reuseCount_?: Map<string, number>;

  /**
   * A counter for the total number of times elements have been reused.
   */
  reuseCount: number;
}

export const rm3: Rm3;

export function injectRm3(): void;
