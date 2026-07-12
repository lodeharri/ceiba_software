import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = process.env.INFRA_ENV_FILE
  ? process.env.INFRA_ENV_FILE
  : resolve(fileURLToPath(import.meta.url), '../../../../.env.dev');

config({ path: envFile });
