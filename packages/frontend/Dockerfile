# Stage 1: build the Vite SPA
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm (locked to the version the repo pins).
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy lockfile + workspace manifests first so Docker can cache the install.
# pnpm-workspace.yaml is REQUIRED so pnpm detects /app as the workspace root
# (otherwise it walks into packages/frontend/ and looks for pnpm-lock.yaml there).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/frontend/package.json ./packages/frontend/

# Install only the frontend's deps (plus its workspace dependency on shared).
# Explicit cd to the workspace root so pnpm finds pnpm-lock.yaml at /app/.
WORKDIR /app
RUN pnpm install --frozen-lockfile --filter @mercadoexpress/frontend...

# Copy the frontend source.
COPY packages/frontend ./packages/frontend

# Also copy the root tsconfig.base.json (extended by packages/frontend/tsconfig.json)
# and packages/shared/ (the workspace dependency referenced from the frontend).
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared

# Build-time env. Vite bakes VITE_* variables into the bundle at build time.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm --filter @mercadoexpress/frontend build

# Stage 2: serve with nginx.
FROM nginx:1.27-alpine

# Replace the default nginx server block with our SPA fallback.
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built SPA from the builder stage.
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# In-container port matches FRONTEND_DOCKER_PORT=80 (declared in .env.dev.example).
# The compose healthcheck hits http://127.0.0.1:${FRONTEND_DOCKER_PORT}/.
EXPOSE 80

# Run nginx in the foreground so the container stays alive.
CMD ["nginx", "-g", "daemon off;"]