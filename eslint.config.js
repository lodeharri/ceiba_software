/**
 * Flat ESLint config (ESLint 9.x). Encodes the boundary rule:
 *   - shared/src/** domain layer must not import any *sdk* / *provider*
 *     package (RISK-W06 in openspec/changes/add-inventory-mvp/reviews/risk-review.md).
 *   - packages/backend/src/** domain layer must not import infrastructure or
 *     interface layers.
 *
 * PR 0 ships the policy + the cross-package scan; per-BC files arrive in
 * PR 2a / 2b / 2c. The policy is enforced via eslint-plugin-boundaries.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vuePlugin from 'eslint-plugin-vue';
import vitestPlugin from 'eslint-plugin-vitest';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/cdk.out/**',
      '**/*.d.ts',
      '**/.git/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vuePlugin.configs['flat/recommended'],
  {
    files: ['**/*.{test,spec}.ts'],
    plugins: { vitest: vitestPlugin },
    languageOptions: {
      globals: { ...globals.node, ...vitestPlugin.environments.env.globals },
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
    },
  },
  {
    // CommonJS config files use `module.exports` — expose the CJS globals.
    files: ['**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared-domain', pattern: 'packages/shared/src/**/domain/**' },
        { type: 'backend-domain', pattern: 'packages/backend/src/**/domain/**' },
        { type: 'backend-application', pattern: 'packages/backend/src/**/application/**' },
        { type: 'backend-infrastructure', pattern: 'packages/backend/src/**/infrastructure/**' },
        { type: 'backend-interface', pattern: 'packages/backend/src/**/interface/**' },
        { type: 'frontend-pages', pattern: 'packages/frontend/src/pages/**' },
        { type: 'frontend-organisms', pattern: 'packages/frontend/src/components/organisms/**' },
        { type: 'frontend-molecules', pattern: 'packages/frontend/src/components/molecules/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            // Shared domain stays pure — no SDK / provider / infrastructure.
            {
              from: 'shared-domain',
              disallow: ['backend-*', 'frontend-*', '*sdk*', '*provider*', '*prisma*'],
            },
            // Backend domain depends only on shared primitives.
            {
              from: 'backend-domain',
              disallow: ['backend-application', 'backend-infrastructure', 'backend-interface'],
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `consistent-type-imports` requires type-aware linting. It is enabled
      // for plain `.ts` files only (where the parser is @typescript-eslint
      // itself). For `.vue` SFCs we skip it because vue-eslint-parser does
      // not forward parserOptions.project in our flat config (PR 0 scope).
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
];
