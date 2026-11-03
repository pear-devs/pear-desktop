// JSX that builds real DOM elements: `<button class="x" onClick={go} />` is an
// HTMLButtonElement, ready to append. No virtual DOM, no re-rendering; for
// stateful UIs use Preact. A file opts in with `/** @jsxImportSource @pear/sdk */`.
//
//   - `on<Event>` props add listeners (`onClick`, `onKeydown`, `onBeforetoggle`).
//   - `class`, `aria-*`, `data-*`, `role` and other unknown names are attributes;
//     names the element has as a property (`hidden`, `popover`, `value`…) are set as such.
//   - `style` is a string or an object (custom properties included).
//   - `ref` is called with the element.
//   - Children are nodes, strings, numbers, arrays; `false`, `null` and `undefined` are skipped.

export type Child = Node | string | number | boolean | null | undefined | readonly Child[];

type Component<P> = (props: P) => JSX.Element;

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg", "path", "g", "circle", "ellipse", "line", "polyline", "polygon", "rect", "defs", "use", "mask", "clipPath",
  "linearGradient", "radialGradient", "stop", "title",
]);

export function jsx(type: string | Component<any>, props: Record<string, unknown>): JSX.Element {
  if (typeof type === "function") return type(props);
  const element = SVG_TAGS.has(type) ? document.createElementNS(SVG_NS, type) : document.createElement(type);
  for (const [name, value] of Object.entries(props)) setProp(element, name, value);
  return element as JSX.Element;
}

export const jsxs = jsx;

/** `<>…</>`: its children, as a DocumentFragment. */
export function Fragment({ children }: { children?: Child }): JSX.Element {
  const fragment = document.createDocumentFragment();
  append(fragment, children);
  return fragment as unknown as JSX.Element;
}

/** Appends JSX children (arrays flattened, `false`/`null`/`undefined` skipped). */
export function append(parent: ParentNode, child: Child) {
  if (child === null || child === undefined || typeof child === "boolean") return;
  if (Array.isArray(child)) {
    for (const item of child as readonly Child[]) append(parent, item);
    return;
  }
  parent.append(child as Node | string);
}

function setProp(element: Element, name: string, value: unknown) {
  if (name === "children") return append(element, value as Child);
  if (value === null || value === undefined) return;
  // `aria-checked={false}` means "false"; any other `false` leaves the attribute out.
  if (name.startsWith("aria-")) return element.setAttribute(name, String(value));
  if (value === false) return;
  if (name === "ref") return (value as (element: Element) => void)(element);
  if (name === "style") return setStyle(element as HTMLElement, value);
  if (isListener(name, value)) return element.addEventListener(name.slice(2).toLowerCase(), value);
  if (isProperty(element, name)) {
    (element as unknown as Record<string, unknown>)[name] = value;
    return;
  }
  // A boolean attribute (`<input required>`) is present when true.
  element.setAttribute(name, value === true ? "" : String(value));
}

function setStyle(element: HTMLElement, value: unknown) {
  if (typeof value === "string") {
    element.setAttribute("style", value);
    return;
  }
  for (const [property, entry] of Object.entries(value as Record<string, string | number>)) {
    element.style.setProperty(property, String(entry));
  }
}

function isListener(name: string, value: unknown): value is EventListener {
  return name.startsWith("on") && typeof value === "function";
}

/** Writable DOM properties, except on SVG elements (whose properties are animated values, set as attributes). */
function isProperty(element: Element, name: string) {
  return !(element instanceof SVGElement) && !name.includes("-") && name !== "class" && name in element;
}

// ---------------------------------------------------------------- types

type Elements = HTMLElementTagNameMap & Omit<SVGElementTagNameMap, keyof HTMLElementTagNameMap>;

type Listeners<E> = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: (event: HTMLElementEventMap[K] & { currentTarget: E }) => void;
};

/** Properties worth setting from JSX (the rest are attributes). */
type PropertyName =
  | "id" | "title" | "hidden" | "inert" | "tabIndex" | "textContent" | "dir" | "lang" | "draggable"
  | "type" | "name" | "value" | "checked" | "disabled" | "placeholder" | "min" | "max" | "step"
  | "popover" | "popoverTargetElement" | "popoverTargetAction"
  | "src" | "alt" | "href" | "target" | "width" | "height" | "loading" | "decoding" | "crossOrigin" | "dateTime";

type Props<E> = Listeners<E> &
  Partial<Pick<E, PropertyName & keyof E>> & {
    class?: string | undefined;
    style?: string | Record<string, string | number> | undefined;
    ref?: ((element: E) => void) | undefined;
    children?: Child;
    [attribute: string]: unknown;
  };

export declare namespace JSX {
  /** What every JSX expression gives: a real element (SVG ones included; cast if you need their own API). */
  type Element = HTMLElement;
  type IntrinsicElements = { [K in keyof Elements]: Props<Elements[K]> };
  interface ElementChildrenAttribute {
    children: {};
  }
}
