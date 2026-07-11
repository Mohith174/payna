# apps/web/Dockerfile
#
# Multi-stage build for the Vite + React dashboard, served by nginx (which
# also proxies /api to the server service — see nginx.conf).
#
# Build with (from repo root):
#
#   docker build -f apps/web/Dockerfile -t payna-web .

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Same rationale as apps/server/Dockerfile: full workspace copy so `npm ci`
# sees every workspace's package.json regardless of build order.
COPY . .

RUN npm ci
# @payna/shared's package.json points main/types at dist/, so it must be
# compiled before the web app's tsc pass can resolve the import.
RUN npm run build --workspace packages/shared
RUN npm run build --workspace apps/web

# ---------- runtime ----------
FROM nginx:alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Vite's default build output is "dist"; update this path if apps/web's
# vite.config.ts overrides build.outDir.
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=5s \
  CMD wget -qO- http://localhost:80 || exit 1
