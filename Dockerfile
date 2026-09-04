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
# stale file.
#
# Left EMPTY on purpose. src/utils/api.ts then emits relative /api/v1/... URLs
# and the bundled nginx.conf proxies them to the api Service, so the API is
# always same-origin with the page. Baking a host in here would nail every
# counter to that one route; empty lets this image be reached over the LAN
# (NodePort) or the Cloudflare tunnel with no rebuild. Override only for a
# deployment with no proxy in front of the bundle.
ARG EXPO_PUBLIC_API_BASE_URL=
ENV EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL}

ENV NODE_ENV=production
RUN npx expo export --platform web --output-dir dist

# ---- runtime ---------------------------------------------------------------
# nginx-unprivileged runs as uid 101 and listens on 8080; the bundled
# nginx.conf matches that port.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
# Security response headers, included by every location in nginx.conf (see the
# comment at the top of that file for why it is an include and not one block).
COPY --chown=nginx:nginx security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
