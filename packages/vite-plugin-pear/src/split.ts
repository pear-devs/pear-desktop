// Context splitting: the `#[cfg]` of pear plugins. A plugin file exports one
// `definePlugin({...})` object; for the page bundle the `host` property is
// removed, for the host bundle `page` and `style` are. Afterwards, imports and
// local helpers that are no longer referenced are pruned until nothing changes,
// so host-only dependencies (node:*, native modules) never reach the page and
// vice versa.
//
// Types are stripped first: a host class named only in a type (`WeakMap<object,
// Presence>`, `ReturnType<typeof createNotifier>`) must not keep it in the page.

import MagicString from "magic-string";
import { transformSync } from "rolldown/utils";
import {
  type ExportDefaultDeclaration,
  type ImportDeclaration,
  type ImportDeclarationSpecifier,
  type Node,
  type ObjectExpression,
  type ParenthesizedExpression,
  parseSync,
  type Program,
  type PropertyKey,
  type Span,
  type VariableDeclaration,
  type VariableDeclarator,
} from "oxc-parser";

export type SplitTarget = "host" | "page";

const REMOVED_PROPERTIES: Record<SplitTarget, readonly string[]> = {
  host: ["page", "style"],
  page: ["host"],
};

export function splitPlugin(source: string, filename: string, target: SplitTarget): string {
  const code = stripTypes(source, filename);
  const program = parse(code, filename);
  const object = findPluginObject(program);
  if (!object) {
    throw new Error(`[pear] ${filename}: expected \`export default definePlugin({ ... })\``);
  }

  const s = new MagicString(code);
  for (const property of object.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const key = propertyName(property.key);
    if (key && REMOVED_PROPERTIES[target].includes(key)) removeListItem(s, code, property);
  }
  return prune(s.toString(), filename);
}

/** The file as JavaScript (JSX and comments, such as a `@jsxImportSource` pragma, kept). */
function stripTypes(code: string, filename: string): string {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const { code: js, errors } = transformSync(filename, code, { lang, jsx: "preserve" });
  if (errors.length > 0) {
    throw new Error(`[pear] ${filename}: ${errors.map((e) => e.message).join("; ")}`);
  }
  return js;
}

function parse(code: string, filename: string): Program {
  const { program, errors } = parseSync(filename, code, { sourceType: "module" });
  if (errors.length > 0) {
    throw new Error(`[pear] ${filename}: ${errors.map((e) => e.message).join("; ")}`);
  }
  return program;
}

const isWrapper = (node: Node): node is ParenthesizedExpression => node.type === "ParenthesizedExpression";

/** `(x)` → `x`. */
function unwrap(node: Node): Node {
  while (isWrapper(node)) node = node.expression;
  return node;
}

/** The object literal of `{...}` or `definePlugin({...})`. */
function pluginObjectOf(node: Node | null | undefined): ObjectExpression | undefined {
  if (!node) return;
  const inner = unwrap(node);
  if (inner.type === "ObjectExpression") return inner;
  if (inner.type === "CallExpression") return pluginObjectOf(inner.arguments[0]);
}

function findPluginObject(program: Program): ObjectExpression | undefined {
  const exported = program.body.find((n): n is ExportDefaultDeclaration => n.type === "ExportDefaultDeclaration")?.declaration;
  const direct = pluginObjectOf(exported);
  if (direct) return direct;
  if (exported?.type !== "Identifier") return;
  // `const plugin = definePlugin({...}); export default plugin;`
  const declarator = topLevelDeclarators(program).find((d) => d.id.type === "Identifier" && d.id.name === exported.name);
  return pluginObjectOf(declarator?.init);
}

/** `const`/`let` declarators at the top level, exported ones included. */
function topLevelDeclarators(program: Program): VariableDeclarator[] {
  return program.body.flatMap((statement) => {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    return declaration?.type === "VariableDeclaration" ? declaration.declarations : [];
  });
}

function propertyName(key: PropertyKey): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
}

/** Removes a node from a comma-separated list along with its trailing comma. */
function removeListItem(s: MagicString, code: string, node: Span) {
  let end = node.end;
  const rest = /^\s*,/.exec(code.slice(end));
  if (rest) end += rest[0].length;
  s.remove(node.start, end);
}

// ---------------------------------------------------------------- pruning

/** Pure whatever they contain: a function's body only runs when it is called. */
const ALWAYS_PURE = new Set(["Literal", "Identifier", "ArrowFunctionExpression", "FunctionExpression", "ThisExpression"]);

/** Expressions whose evaluation has no side effects, so an unused declaration of one can go. */
function isPure(node: Node | null | undefined): boolean {
  if (!node || ALWAYS_PURE.has(node.type)) return true;
  if (isWrapper(node)) return isPure(node.expression);
  switch (node.type) {
    case "ClassExpression":
      return isPure(node.superClass);
    case "TemplateLiteral":
      return node.expressions.every(isPure);
    case "ArrayExpression":
      return node.elements.every(isPure);
    case "ObjectExpression":
      return node.properties.every(isPure);
    case "Property":
      return (!node.computed || isPure(node.key)) && isPure(node.value);
    case "SpreadElement":
      return isPure(node.argument);
    case "MemberExpression":
      return isPure(node.object) && (!node.computed || isPure(node.property));
    case "UnaryExpression":
      return node.operator !== "delete" && isPure(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return isPure(node.left) && isPure(node.right);
    case "ConditionalExpression":
      return isPure(node.test) && isPure(node.consequent) && isPure(node.alternate);
    default:
      return false;
  }
}

/** Each pass can only free what the previous one removed; real plugins settle in two or three. */
const MAX_PRUNE_PASSES = 20;

function prune(code: string, filename: string): string {
  for (let pass = 0; pass < MAX_PRUNE_PASSES; pass++) {
    const pruned = prunePass(code, filename);
    if (pruned === code) return code;
    code = pruned;
  }
  return code;
}

/** Whether `name` is referenced anywhere but inside `span` (its own declaration). */
type IsUsed = (name: string, span: Span) => boolean;

/** Removes the unused top-level imports and declarations, once. */
function prunePass(code: string, filename: string): string {
  const program = parse(code, filename);
  const references = collectReferences(program);
  const isUsed: IsUsed = (name, span) => references.some((r) => r.name === name && (r.start < span.start || r.start >= span.end));

  const s = new MagicString(code);
  for (const statement of program.body) {
    switch (statement.type) {
      case "ImportDeclaration":
        pruneImport(s, code, statement, isUsed);
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
        if (statement.id && !isUsed(statement.id.name, statement)) s.remove(statement.start, statement.end);
        break;
      case "VariableDeclaration":
        if (isUnusedPureDeclaration(statement, isUsed)) s.remove(statement.start, statement.end);
        break;
    }
  }
  return s.toString();
}

function pruneImport(s: MagicString, code: string, statement: ImportDeclaration, isUsed: IsUsed) {
  const { specifiers } = statement;
  // A side-effect import (`import "./x.css"`) stays.
  if (specifiers.length === 0) return;
  const kept = specifiers.filter((spec) => isUsed(spec.local.name, statement));
  if (kept.length === specifiers.length) return;
  if (kept.length === 0) s.remove(statement.start, statement.end);
  else s.overwrite(statement.start, statement.end, rebuildImport(code, statement, kept));
}

/** `const a = …, b = …;` where nothing uses a or b and evaluating them does nothing. */
function isUnusedPureDeclaration(statement: VariableDeclaration, isUsed: IsUsed) {
  return statement.declarations.every((d) => d.id.type === "Identifier" && isPure(d.init) && !isUsed(d.id.name, statement));
}

function rebuildImport(code: string, statement: ImportDeclaration, kept: ImportDeclarationSpecifier[]): string {
  const text = (node: Span) => code.slice(node.start, node.end);
  const defaults = kept.filter((spec) => spec.type !== "ImportSpecifier").map(text);
  const named = kept.filter((spec) => spec.type === "ImportSpecifier").map(text);
  const clause = [...defaults, ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : [])].join(", ");
  // Everything from the source string on, including `with { type: "macro" }`.
  const tail = code.slice(statement.source.start, statement.end);
  return `import ${clause} from ${tail}`;
}

interface Reference {
  name: string;
  start: number;
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

/** Every identifier that names a binding, outside import declarations. */
function collectReferences(program: Program): Reference[] {
  const references: Reference[] = [];
  const visit = (value: unknown, parent: Node | undefined, key: string | undefined) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parent, key);
      return;
    }
    if (!isNode(value) || value.type === "ImportDeclaration") return;
    const isIdentifier = value.type === "Identifier" || value.type === "JSXIdentifier";
    if (isIdentifier && !isPropertyName(parent, key)) references.push({ name: value.name, start: value.start });
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey !== "type" && child && typeof child === "object") visit(child, value, childKey);
    }
  };
  visit(program, undefined, undefined);
  return references;
}

/** True for identifiers that name a property rather than reference a binding. */
function isPropertyName(parent: Node | undefined, key: string | undefined) {
  if (!parent) return false;
  switch (parent.type) {
    case "MemberExpression":
      return key === "property" && !parent.computed;
    case "Property":
      return key === "key" && !parent.computed && !parent.shorthand;
    case "MethodDefinition":
    case "PropertyDefinition":
      return key === "key" && !parent.computed;
    case "JSXAttribute":
      return key === "name";
    default:
      return false;
  }
}
