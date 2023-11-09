import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

import { globSync } from 'glob';

const snakeToCamel = (text: string) => text.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

export const pluginVirtualModuleGenerator = (mode: 'main' | 'preload' | 'renderer' | 'menu') => {
  const srcPath = resolve(__dirname, '..', 'src');

  const plugins = globSync(`${srcPath}/plugins/*`)
    .map((path) => ({ name: basename(path), path }))
    .filter(({ name, path }) => !name.startsWith('utils') && existsSync(resolve(path, `${mode}.ts`)));

  let result = '';

  for (const { name, path } of plugins) {
    result += `import ${snakeToCamel(name)}Plugin from "./${relative(resolve(srcPath, '..'), path).replace(/\\/g, '/')}/${mode}";\n`;
  }

  result += `export const ${mode}Plugins = {\n`;
  for (const { name } of plugins) {
    result += `  "${name}": ${snakeToCamel(name)}Plugin,\n`;
  }
  result += '};';

  return result;
};
