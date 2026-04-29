// Minimal ESLint config — seed from round 3's deferred proposal.
// Intentionally permissive so CI doesn't fail on pre-existing patterns.
// Tighten rules in follow-up PRs once baseline warnings are triaged.

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  env: { es2022: true, node: true, jest: true },
  globals: { __DEV__: 'readonly' },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: { react: { version: 'detect' } },
  ignorePatterns: [
    'node_modules/',
    '.expo/',
    'dist/',
    'build/',
    'babel.config.js',
    'jest.setup.js',
    '**/*.d.ts',
  ],
  rules: {
    // Doctrine: no explicit `any` in production paths (`src/` outside tests).
    // Tests are exempted by the override block below because mock helpers and
    // JSON fixtures still use ad-hoc shapes.
    // TODO(any-burndown): flip from 'warn' → 'error' once PR #69 lands and the
    // remaining ~200 violations across 60 files are eliminated. Do NOT
    // mass-suppress with eslint-disable; fix the types properly.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-require-imports': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-catch': 'warn',
    'no-useless-escape': 'warn',
    'prefer-const': 'warn',
    'no-undef': 'off', // TS handles this.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/display-name': 'off',
    'react/no-unescaped-entities': 'off',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*.{ts,tsx,js,jsx}', '**/*.test.{ts,tsx,js,jsx}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
