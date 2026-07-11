# apps/server/Dockerfile
#
# Multi-stage build for @payna/server. Build context is the repo root
# (npm workspaces resolve @payna/shared -> ../../packages/shared via a
# node_modules symlink, so the whole workspace has to be present at build
# time). Build with:
#
#   docker build -f apps/server/Dockerfile -t payna-server .
#
# Config is read entirely from process.env at runtime (see src/config.ts) —
# no .env file is baked in or expected in the image. Pass NEO4J_URI,
# NEO4J_USER, NEO4J_PASSWORD, DATABASE_URL, LLM_*, MOCK_EXTRACTION, PORT via
# `docker run -e` / compose `environment:` / k8s Secret+ConfigMap.

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app

# Full workspace copy (not just manifests): apps/web may or may not exist
# depending on when this is built, and `npm ci` needs every workspace listed
# in package-lock.json to have its package.json present. Root-level source
# rarely changes, and the .dockerignore keeps node_modules/dist out of the
# build context, so this stays reasonably cache-friendly.
COPY . .

RUN npm ci

# Root "build" script compiles packages/shared then apps/server (see root
# package.json) via plain tsc — it does not copy non-.ts assets.
RUN npm run build

# db/migrate.ts and graph/seed.ts resolve their SQL/Cypher files relative to
# __dirname at runtime; tsc only emits .js, so the migration SQL and the
# schema.cypher file have to be copied into dist by hand at the same
# relative paths the compiled code expects.
RUN mkdir -p apps/server/dist/db/migrations \
 && cp apps/server/src/db/migrations/*.sql apps/server/dist/db/migrations/ \
 && cp apps/server/src/graph/schema.cypher apps/server/dist/graph/schema.cypher

# Drop devDependencies from the installed tree now that the build is done;
# npm prune preserves the workspace symlinks (node_modules/@payna/shared).
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
