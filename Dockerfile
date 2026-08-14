# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Lockfile-only layer so dependency installs are cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# EXPO_PUBLIC_* variables are inlined into the bundle by Metro at BUILD time —
# they are not read at runtime. That is why this is an ARG and why
# .dockerignore excludes .env: the value must come from the build, not from a
# stale file. src/utils/api.ts already defaults to the cloud API host, so this
# ARG only needs overriding for a non-default backend.
ARG EXPO_PUBLIC_API_BASE_URL=https://aleson-test-2.brylletan.com
ENV EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL}

ENV NODE_ENV=production
RUN npx expo export --platform web --output-dir dist

# ---- runtime ---------------------------------------------------------------
# nginx-unprivileged runs as uid 101 and listens on 8080; the bundled
# nginx.conf matches that port.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
