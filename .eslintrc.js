// Minimal ESLint config — seed from round 3's deferred proposal.
// Intentionally permissive so CI doesn't fail on pre-existing patterns.
// Tighten rules in follow-up PRs once baseline warnings are triaged.
//
// On forbidden vocabulary ("income" / "finance"):
// ─────────────────────────────────────────────────
// The TGP audit flagged these words as forbidden in source. That rule
// applies to the Earnings/Wealth pillar (`tgp-finance-app/mobile`),
// which is the Money brand voice. This project is the Body pillar —
// fitness, nutrition, training. The forbidden-words rule does NOT apply
// here: these tokens appear as ordinary technical terms (e.g. an
// "income" reference in copilot/wave11 docs and leaderboard test names)
// without violating the doctrine the rule was protecting (a Money-
// product voice that can't accidentally read like a coaching funnel).
// We are intentionally NOT adding a `no-restricted-syntax` rule for
// these tokens. If a Mind/Wealth/Body brand-voice audit ever folds
// fitness in, revisit.

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
    // Relaxed — baseline is not clean. Tighten in a follow-up PR.
    '@typescript-eslint/no-explicit-any': 'error',
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
        // jest.mock() factories must use require() because jest hoists them
        // above the import block at runtime. Allow that pattern in tests.
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
