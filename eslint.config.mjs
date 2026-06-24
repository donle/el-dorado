import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', 'packages/*/dist/**'],
  },
  js.configs.recommended,
  {
    files: ['packages/client/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      'import/no-cycle': ['error', { maxDepth: 5 }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['packages/server/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.node, ...globals.es2022 },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      'import/no-cycle': ['error', { maxDepth: 5 }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.es2022 },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      'import/no-cycle': ['error', { maxDepth: 5 }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    settings: { 'import/resolver': { typescript: true, node: true } },
    rules: {
      'import/no-cycle': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
];
