/**
 * Seed construct stub (PR 1, tasks.md §2 PR 1).
 *
 * The real seed body (admin user upsert + 6 categories + 6 products)
 * ships in PR 2a alongside `prisma/schema.prisma`. PR 1 only ships
 * the placeholder so the migration chain above can reference a single
 * import path that resolves today.
 *
 * The CustomResource Lambda entry (`migrations-lambda.ts`) calls this
 * indirectly — there is no separate `seed-lambda.ts` in PR 1.
 */

export const SEED_PR_BODY = 'seed stub, body in PR 2a';
