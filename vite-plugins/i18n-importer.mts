import { readFileSync } from 'node:fs';
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

  // Display names are read at build time so that listing the languages does
  // not require loading every translation bundle.
  const labels: Record<string, { name: string; localName: string }> = {};
  for (const { name, path } of plugins) {
    const json = JSON.parse(readFileSync(path, 'utf8')) as {
      language?: { name?: string; 'local-name'?: string };
    };
    labels[name] = {
      name: json.language?.name ?? 'Unknown',
      localName: json.language?.['local-name'] ?? 'Unknown',
    };
  }

  const src = globalProject.createSourceFile(
    'vm:i18n',
    (writer) => {
      writer.writeLine(
        `export const languageLabels = ${JSON.stringify(labels)};`,
      );
      writer.writeLine(
        'export const availableLanguages = Object.keys(languageLabels);',
      );
      writer.blankLine();

      writer.writeLine('const loaders = {');
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');

        writer.writeLine(
          `  "${name}": () => import('${absolutePath}').then((mod) => mod.default),`,
        );
      }
      writer.writeLine('};');
      writer.blankLine();

      writer.writeLine('export const loadLanguageResource = async (name) => {');
      writer.writeLine('  const loader = loaders[name];');
      writer.writeLine('  return loader ? await loader() : undefined;');
      writer.writeLine('};');
      writer.blankLine();

      writer.writeLine('export const languageResources = async () => {');
      writer.writeLine('  const entries = await Promise.all(');
      writer.writeLine(
        '    Object.entries(loaders).map(async ([name, load]) => ({ [name]: { translation: await load() } })),',
      );
      writer.writeLine('  );');
      writer.writeLine('  return Object.assign({}, ...entries);');
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};
