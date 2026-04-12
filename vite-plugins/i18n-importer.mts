import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { Project } from 'ts-morph';

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

export const i18nImporter = () => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync(['src/i18n/resources/*.json']).map((path) => {
    const nameWithExt = basename(path);
    const name = nameWithExt.replace(extname(nameWithExt), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:i18n',
    (writer) => {
      writer.writeLine('export const languageResources = async () => {');
      writer.writeLine('  const entries = await Promise.all([');
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(
          /\\/g,
          '/',
        );

        writer.writeLine(
          `    import('${absolutePath}').then((mod) => ({ "${name}": { translation: mod.default } })),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine('  return Object.assign({}, ...entries);');
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};
