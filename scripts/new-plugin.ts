// Scaffolds plugins/<id>/ as a workspace package: `nub scripts/new-plugin.ts <id> [deps...]`

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [id, ...deps] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("usage: nub scripts/new-plugin.ts <kebab-case-id> [dependency@range...]");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "plugins", id);
if (existsSync(dir)) {
  console.error(`plugins/${id} already exists`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const dependencies: Record<string, string> = { "@pear/sdk": "workspace:*" };
for (const dep of deps) {
  const at = dep.lastIndexOf("@");
  if (at > 0) dependencies[dep.slice(0, at)] = dep.slice(at + 1);
  else dependencies[dep] = "*";
}

const write = (file: string, content: string) => writeFileSync(join(dir, file), content);
write(
  "package.json",
  `${JSON.stringify(
    {
      name: `@pear/plugin-${id}`,
      private: true,
      type: "module",
      scripts: { typecheck: "tsc -p ." },
      dependencies,
      devDependencies: { "@types/node": "^24.0.0", electron: "^44.9.0" },
    },
    null,
    2,
  )}\n`,
);
write(
  "tsconfig.json",
  `${JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { types: ["node"] }, include: ["**/*.ts", "**/*.tsx"] }, null, 2)}\n`,
);
write(
  "index.ts",
  `import { definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "${id}",
  name: "${id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())}",
  page: (ctx) => {
    ctx.log.info("started");
  },
});
`,
);
console.log(`created plugins/${id}`);
