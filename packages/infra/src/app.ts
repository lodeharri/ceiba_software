/**
 * CDK app entry stub. PR 0 ships only the entry shape; real stacks
 * (DatabaseStack, ApiStack, FrontendStack, ObservabilityStack) land in PR 1
 * per openspec/changes/add-inventory-mvp/tasks.md.
 *
 * The constant below proves the package is importable so the workspace's
 * `pnpm -w vitest run` smoke test (PR 0) can resolve `@mercadoexpress/infra`.
 */

export const INFRA_PACKAGE_VERSION = '0.0.0-pr0';
