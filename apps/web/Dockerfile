# apps/web/Dockerfile
#
# UNVERIFIED: written to match apps/server/Dockerfile's convention and
# docs/SPEC.md §6/§7 (Vite + React 18 + TS, built by another executor in a
# parallel worktree that does not exist in this checkout yet). This image
# has not been built or run — do so once apps/web/{package.json,src,...}
# land, and adjust the `npm run build` output dir below if Vite is
# configured with a non-default `build.outDir`.
#
# Build with (from repo root, once apps/web exists):
#
#   docker build -f apps/web/Dockerfile -t payna-web .

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Same rationale as apps/server/Dockerfile: full workspace copy so `npm ci`
# sees every workspace's package.json regardless of build order.
COPY . .

RUN npm ci
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
