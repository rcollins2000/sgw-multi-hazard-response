# SGW frontend — multi-stage: Vite build in node:20-alpine → nginx serves the
# static dist/. This is the production shape (CDN-ready static bundle) — dev
# server (`pnpm dev`) is used only outside Docker via `make dev-frontend`.

# ---- Stage 1: build ------------------------------------------------------
# node:22 minimum — the pinned pnpm version in package.json requires it.
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

# Cache-friendly install layer
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# Build
COPY . .
RUN pnpm build

# ---- Stage 2: serve ------------------------------------------------------
FROM nginx:1.27-alpine

# The reverse-proxy config forwards /api/* to the backend service (see
# docker-compose.yml — service name `backend` resolves inside the network).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
    CMD wget --spider -q http://localhost:5173/ || exit 1
