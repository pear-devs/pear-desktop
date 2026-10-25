// Developer-only native checks using Node's built-in TypeScript type stripping.
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.independent-audio-test');
mkdirSync(output, { recursive: true });
const graph = stripTypeScriptTypes(
  readFileSync(join(root, 'src/plugins/independent-audio/graph.ts'), 'utf8'),
);
const declaration = 'export async function attachGraph';
if (!graph.includes(declaration))
  throw new Error('Unexpected graph module exports.');
writeFileSync(
  join(output, 'graph.js'),
  'globalThis.IndependentAudio = (() => {\n' +
    graph.replace(declaration, 'async function attachGraph') +
    '\nreturn { attachGraph };\n})();',
);
writeFileSync(
  join(output, 'backend.mjs'),
  stripTypeScriptTypes(
    readFileSync(
      join(root, 'src/plugins/independent-audio/backend.ts'),
      'utf8',
    ),
  ),
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  join(root, 'node_modules/electron/dist/electron.exe'),
  [join(root, 'tests/independent-audio/test.cjs')],
  {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    timeout: 25000,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
