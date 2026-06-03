/* ESLint configuration for the AgentForge frontend (React 18 + TypeScript). */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: '18' },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'src-tauri/target',
    'src-tauri/gen',
    '*.config.ts',
    '*.config.js',
    '.eslintrc.cjs',
  ],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Allow intentionally unused args/vars when prefixed with `_`.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // `while (true) { … }` is the idiomatic shape for streaming readers.
    'no-constant-condition': ['error', { checkLoops: false }],
    // Intentionally empty catch blocks (best-effort JSON parsing on a stream).
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
