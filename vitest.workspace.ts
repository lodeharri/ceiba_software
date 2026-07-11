// Workspace-root vitest workspace.
//
// Lists every workspace package that owns a vitest.config.ts, plus a
// root-level project for the scripts/ tree (PR 1, design.md section 6.1
// Group A) and tests/architecture/ (cross-cutting tests added across
// PR 1 / PR 2 / PR 3). Both run under pnpm -w vitest run without a
// separate --config flag.
export default [
  'packages/shared',
  'packages/backend',
  'packages/frontend',
  'packages/infra',
  {
    test: {
      name: 'scripts',
      root: '.',
      include: [
        'scripts/**/*.test.ts',
        'scripts/**/*.event-shape.test.ts',
        'tests/architecture/**/*.test.ts',
      ],
      environment: 'node',
    },
  },
];
