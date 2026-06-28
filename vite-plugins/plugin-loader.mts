import { readFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Project,
  ts,
  VariableDeclarationKind,
  type ObjectLiteralExpression,
  type Node,
  type ObjectLiteralElementLike,
} from 'ts-morph';

import type { PluginOption } from 'vite';

// Initialize a global project instance to reuse across load calls
const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

// Helper to extract a property’s name from its node
const getPropertyName = (prop: Node): string | null => {
  const kind = prop.getKind();
  if (
    kind === ts.SyntaxKind.PropertyAssignment ||
    kind === ts.SyntaxKind.ShorthandPropertyAssignment ||
    kind === ts.SyntaxKind.MethodDeclaration
  ) {
    return prop.getFirstChildByKindOrThrow(ts.SyntaxKind.Identifier).getText();
  }
  return null;
};

export default function (
  mode: 'backend' | 'preload' | 'renderer' | 'none',
): PluginOption {
  return {
    name: 'ytm-plugin-loader',
    load: {
      filter: {
        id: /(?:\/plugins\/[^/]+\/index\.(?:js|ts|jsx|tsx)|\/plugins\/[^/]+\.(?:js|ts|jsx|tsx))$/,
      },
      handler(id) {
        const fileContent = readFileSync(id, 'utf8');
        // Create or update source file in the global project instance
        const src = globalProject.createSourceFile(
          '_pf' + basename(id),
          fileContent,
          { overwrite: true },
        );

        let objExpr: ObjectLiteralExpression | undefined;

        // Check for `export default ...`
        const defaultExportAssignment = src.getExportAssignment(
          (ea) => !ea.isExportEquals(), // Filter out `export = `
        );

        if (defaultExportAssignment) {
          const expression = defaultExportAssignment.getExpression();
          if (expression.getKind() === ts.SyntaxKind.ObjectLiteralExpression) {
            objExpr = expression.asKindOrThrow(
              ts.SyntaxKind.ObjectLiteralExpression,
            );
          } else if (expression.getKind() === ts.SyntaxKind.CallExpression) {
            const callExpr = expression.asKindOrThrow(
              ts.SyntaxKind.CallExpression,
            );
            if (
              callExpr.getArguments().length === 1 &&
              callExpr.getExpression().getText() === 'createPlugin'
            ) {
              const arg = callExpr.getArguments()[0];
              if (arg.getKind() === ts.SyntaxKind.ObjectLiteralExpression) {
                objExpr = arg.asKindOrThrow(
                  ts.SyntaxKind.ObjectLiteralExpression,
                );
              }
            }
          }
        }

        // If not found via `export default`, check for a named export aliased as 'default'
        if (!objExpr) {
          const defaultExportDeclaration = src
            .getExportedDeclarations()
            .get('default');
          if (defaultExportDeclaration && defaultExportDeclaration.length > 0) {
            const expr = defaultExportDeclaration[0];
            if (expr.getKind() === ts.SyntaxKind.ObjectLiteralExpression) {
              objExpr = expr.asKindOrThrow(
                ts.SyntaxKind.ObjectLiteralExpression,
              );
            } else if (expr.getKind() === ts.SyntaxKind.CallExpression) {
              const callExpr = expr.asKindOrThrow(ts.SyntaxKind.CallExpression);
              if (
                callExpr.getArguments().length === 1 &&
                callExpr.getExpression().getText() === 'createPlugin'
              ) {
                const arg = callExpr.getArguments()[0];
                if (arg.getKind() === ts.SyntaxKind.ObjectLiteralExpression) {
                  objExpr = arg.asKindOrThrow(
                    ts.SyntaxKind.ObjectLiteralExpression,
                  );
                }
              }
            }
          }
        }

        if (!objExpr) return null;

        // Build a map of property names to their AST nodes for fast lookup
        const propMap = new Map<string, ObjectLiteralElementLike>();
        for (const prop of objExpr.getProperties()) {
          const name = getPropertyName(prop);
          if (name) propMap.set(name, prop);
        }

        const contexts = ['backend', 'preload', 'renderer', 'menu'];
        for (const ctx of contexts) {
          if (mode === 'none' && propMap.has(ctx)) {
            propMap.get(ctx)?.remove();
            continue;
          }
          if (ctx === mode || (ctx === 'menu' && mode === 'backend')) continue;
          if (propMap.has(ctx)) propMap.get(ctx)?.remove();
        }

        // Add an exported variable 'pluginStub' with the modified object literal's text
        const varStmt = src.addVariableStatement({
          isExported: true,
          declarationKind: VariableDeclarationKind.Const,
          declarations: [
            {
              name: 'pluginStub',
              initializer: (writer) => writer.write(objExpr.getText()),
            },
          ],
        });
        const stubObjExpr = varStmt
          .getDeclarations()[0]
          .getInitializerIfKindOrThrow(ts.SyntaxKind.ObjectLiteralExpression);

        // Similarly build a map for the stub properties
        const stubMap = new Map<string, ObjectLiteralElementLike>();
        for (const prop of stubObjExpr.getProperties()) {
          const name = getPropertyName(prop);
          if (name) stubMap.set(name, prop);
        }

        const stubContexts =
          mode === 'backend'
            ? contexts.filter((ctx) => ctx !== 'menu')
            : contexts;
        for (const ctx of stubContexts) {
          if (stubMap.has(ctx)) {
            stubMap.get(ctx)?.remove();
          }
        }

        return {
          code: src.getText(),
        };
      },
    },
  };
}
