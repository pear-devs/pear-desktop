//@ts-check

import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier/recommended';
import solid from 'eslint-plugin-solid/configs/recommended';
import stylistic from '@stylistic/eslint-plugin';
import tsEslint from 'typescript-eslint';

import * as importPlugin from 'eslint-plugin-import';

export default tsEslint.config(
  eslint.configs.recommended,
  tsEslint.configs.eslintRecommended,
  ...tsEslint.configs.recommendedTypeChecked,
  prettier,
  solid,
  { ignores: ['dist', 'node_modules', '*.config.*js', '*.test.*js'] },
  {
    plugins: {
      stylistic,
      importPlugin
    },
    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: {
        project: true,
        sourceType: 'module',
        ecmaVersion: 'latest'
      }
    },
    rules: {
      'stylistic/arrow-parens': ['error', 'always'],
      'stylistic/object-curly-spacing': ['error', 'always'],
      'stylistic/jsx-pascal-case': 'error',
      'stylistic/jsx-curly-spacing': ['error', { when: 'never', children: true }],
      'stylistic/jsx-sort-props': 'error',
      'prettier/prettier': ['error', { singleQuote: true, semi: true, tabWidth: 2, trailingComma: 'all', quoteProps: 'preserve' }],
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': ['off', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', {
        fixStyle: 'inline-type-imports',
        prefer: 'type-imports',
        disallowTypeAnnotations: false,
      }],
      'importPlugin/first': 'error',
      'importPlugin/newline-after-import': 'off',
      'importPlugin/no-default-export': 'off',
      'importPlugin/no-duplicates': 'error',
      'importPlugin/no-unresolved': ['error', { ignore: ['^virtual:', '\\?inline$', '\\?raw$', '\\?asset&asarUnpack'] }],
      'importPlugin/order': ['error', {
        'groups': ['builtin', 'external', ['internal', 'index', 'sibling'], 'parent', 'type'],
        'newlines-between': 'always-and-inside-groups',
        'alphabetize': { order: 'ignore', caseInsensitive: false }
      }],
      'importPlugin/prefer-default-export': 'off',
      'camelcase': ['error', { properties: 'never' }],
      'class-methods-use-this': 'off',
      'stylistic/lines-around-comment': ['error', {
        beforeBlockComment: false,
        afterBlockComment: false,
        beforeLineComment: false,
        afterLineComment: false,
      }],
      'stylistic/max-len': 'off',
      'stylistic/no-mixed-operators': 'warn', // prettier does not support no-mixed-operators
      'stylistic/no-multi-spaces': ['error', { ignoreEOLComments: true }],
      'stylistic/no-tabs': 'error',
      'no-void': 'error',
      'no-empty': 'off',
      'prefer-promise-reject-errors': 'off',
      'stylistic/quotes': ['error', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: 'never',
      }],
      'stylistic/quote-props': ['error', 'consistent'],
      'stylistic/semi': ['error', 'always'],
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts']
      },
      'import/resolver': {
        typescript: {},
        exports: {},
      },
    },
  },
);
