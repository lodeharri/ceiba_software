/* eslint-disable */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';
import pg from 'pg';

const { Pool } = pg;

async function enableVectorExtension(): Promise<void> {
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const dbHost = process.env['DB_HOST']!;
  const dbPort = Number(process.env['DB_PORT'] ?? '5432');
  const postgresMasterSecretArn = process.env['POSTGRES_MASTER_SECRET_ARN']!;

  // Read postgres master credentials
  const secrets = new SecretsManagerClient({ region });
  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: postgresMasterSecretArn }),
  );

  let creds: { username: string; password: string };
  try {
    creds = JSON.parse(SecretString ?? '{}');
  } catch {
    throw new Error('Failed to parse postgres master credentials JSON');
  }

  // Connect to postgres default db to create extension at cluster level
  const adminPool = new Pool({
    host: dbHost,
    port: dbPort,
    user: creds.username,
    password: creds.password,
    database: 'postgres',
    max: 1,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await adminPool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('vector extension enabled');
  } finally {
    await adminPool.end();
  }

  // Connect to the app database and verify the embedding column
  const appPool = new Pool({
    host: dbHost,
    port: dbPort,
    user: creds.username,
    password: creds.password,
    database: 'mercadoexpress',
    max: 1,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const colCheckQuery = [
      'SELECT column_name, data_type, udt_name',
      'FROM information_schema.columns',
      "WHERE table_name = 'products' AND column_name = 'embedding'",
    ].join('\n');
    const { rows } = await appPool.query(colCheckQuery);

    if (rows.length === 0) {
      console.log('embedding column not found — run migrations first');
      return;
    }

    if ((rows[0] as Record<string, string>).udt_name !== 'vector') {
      console.warn(
        `embedding column is type '${(rows[0] as Record<string, string>).udt_name}' — migrating to vector(768)...`,
      );
      // Migrate: add temp vector col, copy data, swap
      const migrateQueries = [
        'ALTER TABLE products ADD COLUMN embedding_temp vector(768)',
        'UPDATE products SET embedding_temp = embedding::vector WHERE embedding IS NOT NULL',
        'ALTER TABLE products DROP COLUMN embedding',
        'ALTER TABLE products RENAME COLUMN embedding_temp TO embedding',
      ];
      for (const q of migrateQueries) {
        await appPool.query(q);
      }
      console.log('embedding column migrated to vector(768)');
    } else {
      console.log('embedding column is already vector(768)');
    }

    // Ensure HNSW index exists
    await appPool.query(
      'CREATE INDEX IF NOT EXISTS products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops)',
    );
    console.log('HNSW index ready');
  } finally {
    await appPool.end();
  }
}

export async function handler(
  event: CloudFormationCustomResourceEvent,
): Promise<CloudFormationCustomResourceResponse> {
  const physicalResourceId = 'vector-extension-resource';

  try {
    await enableVectorExtension();

    return {
      Status: 'SUCCESS',
      LogicalResourceId: event.LogicalResourceId,
      PhysicalResourceId: physicalResourceId,
      RequestId: event.RequestId,
      StackId: event.StackId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Vector extension setup failed:', message);

    return {
      Status: 'FAILED',
      LogicalResourceId: event.LogicalResourceId ?? 'VectorExtension',
      PhysicalResourceId: physicalResourceId,
      RequestId: event.RequestId,
      StackId: event.StackId ?? '',
      Reason: message,
    };
  }
}
