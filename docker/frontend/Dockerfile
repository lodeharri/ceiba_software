FROM node:20-alpine
RUN npm install -g pnpm@9
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile || pnpm install

COPY packages/frontend/ ./packages/frontend/

WORKDIR /app/packages/frontend

EXPOSE 5173

COPY docker/frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
