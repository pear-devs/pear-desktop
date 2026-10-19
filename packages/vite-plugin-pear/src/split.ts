// Context splitting: the `#[cfg]` of pear plugins. A plugin file exports one
// `definePlugin({...})` object; for the page bundle the `host` property is
// removed, for the host bundle `page` and `style` are. Afterwards, imports and
// local helpers that are no longer referenced are pruned until nothing changes,
// so host-only dependencies (node:*, native modules) never reach the page and
// vice versa.

import MagicString from "magic-string";
import { parseSync } from "oxc-parser";

export type SplitTarget = "host" | "page";

const REMOVED_PROPERTIES: Record<SplitTarget, readonly string[]> = {
  host: ["page", "style"],
  page: ["host"],
};

type Node = { type: string; start: number; end: number; [key: string]: any };

export function splitPlugin(code: string, filename: string, target: SplitTarget): string {
  const program = parse(code, filename);
  const object = findPluginObject(program);
  if (!object) {
    throw new Error(`[pear] ${filename}: expected \`export default definePlugin({ ... })\``);
  }

  const s = new MagicString(code);
  for (const property of object.properties as Node[]) {
    if (property.type !== "Property" || property.computed) continue;
    const key = propertyName(property.key);
    if (key && REMOVED_PROPERTIES[target].includes(key)) removeListItem(s, code, property);
  }
  return prune(s.toString(), filename);
}

function parse(code: string, filename: string): Node {
  const { program, errors } = parseSync(filename, code, { sourceType: "module" });
  if (errors.length > 0) {
    throw new Error(`[pear] ${filename}: ${errors.map((e) => e.message).join("; ")}`);
  }
  return program as unknown as Node;
}

function unwrap(node: Node | null | undefined): Node | undefined {
  while (node && (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression" || node.type === "ParenthesizedExpression")) {
    node = node.expression;
  }
  return node ?? undefined;
}

function pluginObjectOf(node: Node | undefined): Node | undefined {
  node = unwrap(node);
  if (!node) return;
  if (node.type === "ObjectExpression") return node;
  if (node.type === "CallExpression") return pluginObjectOf(node.arguments[0]);
}

function findPluginObject(program: Node): Node | undefined {
  const exported = program.body.find((n: Node) => n.type === "ExportDefaultDeclaration")?.declaration as Node | undefined;
  const direct = pluginObjectOf(exported);
  if (direct) return direct;
  if (exported?.type !== "Identifier") return;
  // `const plugin = definePlugin({...}); export default plugin;`
  for (const statement of program.body as Node[]) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations as Node[]) {
      if (declarator.id.type === "Identifier" && declarator.id.name === exported.name) {
        return pluginObjectOf(declarator.init);
      }
    }
  }
}

function propertyName(key: Node): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
}

/** Removes a node from a comma-separated list along with its trailing comma. */
function removeListItem(s: MagicString, code: string, node: Node) {
  let end = node.end;
  const rest = /^\s*,/.exec(code.slice(end));
  if (rest) end += rest[0].length;
  s.remove(node.start, end);
}

// ---------------------------------------------------------------- pruning

interface Reference {
  name: string;
  start: number;
}

/** Expressions whose evaluation has no side effects, so an unused declaration of one can go. */
function isPure(node: Node | null | undefined): boolean {
  if (!node) return true;
  switch (node.type) {
    case "Literal":
    case "Identifier":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ThisExpression":
      return true;
    case "ClassExpression":
      return !node.superClass || isPure(node.superClass);
    case "TemplateLiteral":
      return node.expressions.every(isPure);
    case "ArrayExpression":
      return node.elements.every((e: Node | null) => !e || isPure(e.type === "SpreadElement" ? e.argument : e));
    case "ObjectExpression":
      return node.properties.every((p: Node) =>
        p.type === "SpreadElement" ? isPure(p.argument) : (!p.computed || isPure(p.key)) && isPure(p.value),
      );
    case "MemberExpression":
      return isPure(node.object) && (!node.computed || isPure(node.property));
    case "UnaryExpression":
      return node.operator !== "delete" && isPure(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return isPure(node.left) && isPure(node.right);
    case "ConditionalExpression":
      return isPure(node.test) && isPure(node.consequent) && isPure(node.alternate);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return isPure(node.expression);
    default:
      return false;
  }
}

function prune(code: string, filename: string): string {
  for (let pass = 0; pass < 20; pass++) {
    const program = parse(code, filename);
    const references = collectReferences(program);
    const isReferenced = (name: string, span: Node) =>
      references.some((r) => r.name === name && (r.start < span.start || r.start >= span.end));

    const s = new MagicString(code);
    let changed = false;

    for (const statement of program.body as Node[]) {
      if (statement.type === "ImportDeclaration") {
        const specifiers = statement.specifiers as Node[];
        if (specifiers.length === 0) continue; // side-effect import: keep
        const kept = specifiers.filter((spec) => isReferenced(spec.local.name, statement));
        if (kept.length === specifiers.length) continue;
        changed = true;
        if (kept.length === 0) s.remove(statement.start, statement.end);
        else s.overwrite(statement.start, statement.end, rebuildImport(code, statement, kept));
      } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        if (statement.id && !isReferenced(statement.id.name, statement)) {
          s.remove(statement.start, statement.end);
          changed = true;
        }
      } else if (statement.type === "VariableDeclaration") {
        const declarators = statement.declarations as Node[];
        const prunable = declarators.every(
          (d) => d.id.type === "Identifier" && isPure(d.init),
        );
        if (prunable && declarators.every((d) => !isReferenced(d.id.name, statement))) {
          s.remove(statement.start, statement.end);
          changed = true;
        }
      }
    }

    if (!changed) return code;
    code = s.toString();
  }
  return code;
}

function rebuildImport(code: string, statement: Node, kept: Node[]): string {
  const text = (node: Node) => code.slice(node.start, node.end);
  const defaults = kept.filter((spec) => spec.type !== "ImportSpecifier").map(text);
  const named = kept.filter((spec) => spec.type === "ImportSpecifier").map(text);
  const clause = [...defaults, ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : [])].join(", ");
  const typeKeyword = statement.importKind === "type" ? "type " : "";
  // Everything from the source string on, including `with { type: "macro" }`.
  const tail = code.slice(statement.source.start, statement.end);
  return `import ${typeKeyword}${clause} from ${tail}`;
}

function collectReferences(program: Node): Reference[] {
  const references: Reference[] = [];
  const visit = (node: unknown, parent: Node | undefined, key: string | undefined) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, key);
      return;
    }
    if (!node || typeof node !== "object" || typeof (node as Node).type !== "string") return;
    const n = node as Node;
    if (n.type === "ImportDeclaration") return;
    if ((n.type === "Identifier" || n.type === "JSXIdentifier") && !isPropertyName(parent, key)) {
      references.push({ name: n.name, start: n.start });
    }
    for (const [childKey, child] of Object.entries(n)) {
      if (childKey !== "type" && child && typeof child === "object") visit(child, n, childKey);
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
    case "TSPropertySignature":
    case "TSMethodSignature":
      return key === "key" && !parent.computed;
    case "JSXAttribute":
      return key === "name";
    default:
      return false;
  }
}
