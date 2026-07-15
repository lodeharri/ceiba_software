/**
 * Drizzle ORM schema — mirrors packages/backend/prisma/schema.prisma
 *
 * Generated from Prisma models via manual translation.
 * Both ORMs coexist during PR 1.1 (setup phase only).
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  bigint,
  index,
  customType,
} from 'drizzle-orm/pg-core';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', ['admin']);

export const movementTypeEnum = pgEnum('movement_type', ['ENTRADA', 'SALIDA']);

export const alertStatusEnum = pgEnum('alert_status', ['ACTIVA', 'RESUELTA']);

export const orderStatusEnum = pgEnum('order_status', [
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'RECIBIDA',
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * users — auth BC
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').default('admin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    usernameIdx: index('users_username_idx').on(table.username),
  }),
);

/**
 * categories — categories BC
 */
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
});

/**
 * products — products BC
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    price: decimal('price', { precision: 12, scale: 0 }).notNull(),
    stock: integer('stock').default(0).notNull(),
    stockMin: integer('stock_min').notNull(),
    supplier: text('supplier').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    categoryIdIdx: index('products_category_id_idx').on(table.categoryId),
    supplierIdx: index('products_supplier_idx').on(table.supplier),
    stockIdx: index('products_stock_idx').on(table.stock),
  }),
);

/**
 * login_attempts — auth BC (RISK-003 Postgres rate limiter)
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    ip: text('ip').notNull(), // Drizzle pg-core text; db is Inet — cast in queries
    username: text('username').notNull(),
    success: boolean('success').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true, precision: 6 })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    ipUsernameFailureIdx: index('login_attempts_ip_username_failure_idx').on(
      table.ip,
      table.username,
      table.attemptedAt,
    ),
  }),
);

/**
 * idempotency_keys — shared (RISK-W05)
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: customType<{ data: Record<string, unknown> }>({
      dataType: () => 'jsonb',
    })('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    userIdCreatedAtIdx: index('idempotency_keys_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

/**
 * stock_movements — inventory BC (append-only per BR-6)
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull(),
    type: movementTypeEnum('type').notNull(),
    quantity: integer('quantity').notNull(),
    reason: text('reason').notNull(), // @db.VarChar(280) → text (no limit)
    userId: uuid('user_id').notNull(),
    stockAfter: integer('stock_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    productIdCreatedAtIdx: index('stock_movements_product_id_created_at_idx').on(
      table.productId,
      table.createdAt,
    ),
  }),
);

/**
 * alerts — alerts BC
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull(),
    type: text('type').default('STOCK_BAJO').notNull(),
    status: alertStatusEnum('status').default('ACTIVA').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    statusCreatedAtIdx: index('alerts_status_created_at_idx').on(table.status, table.createdAt),
    productIdIdx: index('alerts_product_id_idx').on(table.productId),
  }),
);

/**
 * purchase_orders — orders BC
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: orderStatusEnum('status').default('PENDIENTE').notNull(),
    supplierSnapshot: text('supplier_snapshot').notNull(), // @db.VarChar(120)
    fromAlertId: uuid('from_alert_id'),
    reason: text('reason'), // @db.VarChar(500) → text
    createdBy: uuid('created_by').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, precision: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  },
  (table) => ({
    productIdCreatedAtIdx: index('purchase_orders_product_id_created_at_idx').on(
      table.productId,
      table.createdAt,
    ),
    statusCreatedAtIdx: index('purchase_orders_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);
