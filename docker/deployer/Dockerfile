FROM node:20-alpine
RUN apk add --no-cache bash postgresql-client curl python3
RUN npm install -g pnpm@9
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/infra/package.json ./packages/infra/

RUN pnpm install --frozen-lockfile || pnpm install

COPY packages/ ./packages/

WORKDIR /app/packages/infra
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm build

COPY docker/deployer/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY docker/deployer/wait-for-services.sh /docker/wait-for-services.sh
RUN chmod +x /docker/wait-for-services.sh

ENTRYPOINT ["/entrypoint.sh"]
