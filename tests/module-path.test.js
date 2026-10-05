import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { test, expect } from '@playwright/test';
import { build } from 'vite';

import { modulePath } from './helpers/module-path.js';

test('Windows fixture module paths preserve separators rather than escape sequences', () => {
  const native = path.win32.join(
    'C:\\fixture',
    'node_modules',
    'tests',
    'index.js',
  );
  const normalized = modulePath(native);
  expect(normalized).toBe('C:/fixture/node_modules/tests/index.js');
  // Model the generated JavaScript literal consumed by the fixture bundle.
  expect(JSON.parse(JSON.stringify(normalized))).toBe(normalized);
  expect(normalized).not.toMatch(/[\n\r\t\\]/);
});

test('bundled generated imports and external mappings retain Windows module paths', async () => {
  const target = modulePath(
    path.win32.join('C:\\fixture', 'node_modules', "song's app", 'index.js'),
  );
  for (const specifier of [target, 'fixture-dependency']) {
    const result = await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'module-path-fixture',
          resolveId: (id) =>
            id === 'module-path-fixture' ||
            modulePath(id).endsWith('/module-path-fixture')
              ? '\0module-path-fixture'
              : null,
          load: (id) =>
            id === '\0module-path-fixture'
              ? `import value from ${JSON.stringify(specifier)}; export default value;`
              : null,
        },
      ],
      build: {
        write: false,
        lib: { entry: 'module-path-fixture', formats: ['cjs'] },
        rollupOptions: {
          external: [specifier],
          output: { paths: { [specifier]: target } },
        },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const chunk = output.find((item) => item.type === 'chunk');
    const requests = [];
    runInNewContext(chunk.code, {
      module: { exports: {} },
      exports: {},
      require: (id) => {
        requests.push(id);
        return 'fixture';
      },
    });
    expect(requests).toEqual([target]);
  }
});

test('module paths preserve spaces and quotes and leave POSIX paths unchanged', () => {
  const native = path.win32.join(
    'C:\\fixture',
    "song's app",
    'src',
    'view.tsx',
  );
  expect(modulePath(native)).toBe("C:/fixture/song's app/src/view.tsx");
  expect(modulePath('/fixture/src/view.tsx')).toBe('/fixture/src/view.tsx');
});
