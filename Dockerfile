# syntax=docker/dockerfile:1.7
# AdLedger — single production image (dashboard + API + pixel + MCP + background jobs).

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN addgroup -S -g 1001 adledger && adduser -S -u 1001 -G adledger adledger \
  && mkdir -p /data && chown adledger:adledger /data
COPY --from=build --chown=adledger:adledger /app/.next/standalone ./
COPY --from=build --chown=adledger:adledger /app/.next/static ./.next/static
COPY --from=build --chown=adledger:adledger /app/public ./public
COPY --from=build --chown=adledger:adledger /app/drizzle ./drizzle
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER adledger
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "server.js"]
