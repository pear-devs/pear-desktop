// The development flavour of the JSX transform calls `jsxDEV`; it builds the same elements.

import { jsx } from "./jsx-runtime.ts";

export { Fragment, type JSX } from "./jsx-runtime.ts";

export const jsxDEV = (type: Parameters<typeof jsx>[0], props: Record<string, unknown>) => jsx(type, props);
