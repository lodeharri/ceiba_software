/**
 * Backend entry stub. PR 0 only ships the skeleton; the real Lambda handlers
 * (auth, products, inventory, alerts, orders) land in PR 2a / 2b / 2c per
 * openspec/changes/add-inventory-mvp/tasks.md.
 *
 * The constant below proves the package is importable so the workspace's
 * `pnpm -w vitest run` smoke test (PR 0) can resolve `@mercadoexpress/backend`.
 */

export const BACKEND_PACKAGE_VERSION = '0.0.0-pr0';
