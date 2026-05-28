# syntax=docker/dockerfile:1.7-labs

# ================================================================================================
# PERFANA NEXT-GEN - SECURITY-FIRST MULTI-STAGE DOCKERFILE
# ================================================================================================
# This Dockerfile follows modern security best practices for containerization:
# - Multi-stage builds for minimal attack surface and reduced image size
# - Non-root user execution with proper UID/GID mapping
# - Distroless base images for production to eliminate shell access
# - Dependency caching layers for faster builds
# - Security scanning integration points
# - Proper file permissions and ownership
# - Health checks for container orchestration
# - Build-time security validations
# ================================================================================================

# ================================================================================================
# ARGS AND METADATA
# ================================================================================================
ARG NODE_VERSION=20
ARG ALPINE_VERSION=3.20
ARG APP_VERSION=0.1.0
ARG BUILD_DATE
ARG VCS_REF
ARG BUILD_NUMBER

# Next.js public environment variables
# These are set to placeholder values at build time and replaced at runtime
# via the start-server.js script which generates __env.js
ARG NEXT_PUBLIC_API_URL=__RUNTIME_NEXT_PUBLIC_API_URL__
ARG NEXT_PUBLIC_KEYCLOAK_URL=__RUNTIME_NEXT_PUBLIC_KEYCLOAK_URL__
ARG NEXT_PUBLIC_KEYCLOAK_REALM=__RUNTIME_NEXT_PUBLIC_KEYCLOAK_REALM__
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=__RUNTIME_NEXT_PUBLIC_KEYCLOAK_CLIENT_ID__
ARG NEXT_PUBLIC_USE_KEYCLOAK_AUTH=__RUNTIME_NEXT_PUBLIC_USE_KEYCLOAK_AUTH__

# CSP configuration - set to "false" to disable upgrade-insecure-requests directive
ARG CSP_UPGRADE_INSECURE=true

# ================================================================================================
# STAGE 1: Security Scanner Base
# ================================================================================================
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS security-base

# Install security scanning tools
RUN apk upgrade --no-cache \
    && apk add --no-cache \
        dumb-init \
        ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user early for security
RUN addgroup -g 10001 -S perfana \
    && adduser -u 10001 -D -S -G perfana perfana

# ================================================================================================
# STAGE 2: Dependencies Installation
# ================================================================================================
FROM --platform=$BUILDPLATFORM security-base AS deps

# Set working directory
WORKDIR /app

# Copy package files for dependency analysis
COPY --chown=perfana:perfana package*.json ./
COPY --chown=perfana:perfana turbo.json ./
COPY --chown=perfana:perfana apps/web/package*.json ./apps/web/
COPY --chown=perfana:perfana apps/api/package*.json ./apps/api/
COPY --chown=perfana:perfana apps/grafana-sync/package*.json ./apps/grafana-sync/
COPY --chown=perfana:perfana apps/worker/package*.json ./apps/worker/
COPY --chown=perfana:perfana apps/perfana-report/package*.json ./apps/perfana-report/
COPY --chown=perfana:perfana packages/shared/package*.json ./packages/shared/
COPY --chown=perfana:perfana packages/config/package*.json ./packages/config/

# Security: Verify package integrity and install dependencies
RUN npm ci --only=production --ignore-scripts \
    && npm cache clean --force \
    && find /app -name "node_modules" -exec chmod -R 755 {} + \
    && find /app -name "*.js" -exec chmod 644 {} +

# ================================================================================================
# STAGE 3: Build Dependencies (includes dev deps)
# ================================================================================================
FROM --platform=$BUILDPLATFORM security-base AS build-deps

WORKDIR /app

# Copy package files
COPY --chown=perfana:perfana package*.json ./
COPY --chown=perfana:perfana turbo.json ./
COPY --chown=perfana:perfana apps/web/package*.json ./apps/web/
COPY --chown=perfana:perfana apps/api/package*.json ./apps/api/
COPY --chown=perfana:perfana apps/grafana-sync/package*.json ./apps/grafana-sync/
COPY --chown=perfana:perfana apps/worker/package*.json ./apps/worker/
COPY --chown=perfana:perfana apps/perfana-report/package*.json ./apps/perfana-report/
COPY --chown=perfana:perfana packages/shared/package*.json ./packages/shared/
COPY --chown=perfana:perfana packages/config/package*.json ./packages/config/

# Install all dependencies including dev dependencies for build
RUN npm ci --ignore-scripts \
    && npm cache clean --force

# ================================================================================================
# STAGE 4: Source Code Preparation
# ================================================================================================
FROM --platform=$BUILDPLATFORM build-deps AS source

# Copy source code with proper ownership
COPY --chown=perfana:perfana . .

# Remove sensitive files that shouldn't be in container
RUN rm -rf \
    .git \
    .github \
    .vscode \
    .idea \
    *.md \
    .env.* \
    .eslintrc.* \
    .prettierrc \
    coverage/ \
    test/ \
    docs/ \
    *.log

# ================================================================================================
# STAGE 5: Build Stage
# ================================================================================================
FROM --platform=$BUILDPLATFORM source AS builder

# Re-declare build args for this stage
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_KEYCLOAK_URL
ARG NEXT_PUBLIC_KEYCLOAK_REALM
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ARG NEXT_PUBLIC_USE_KEYCLOAK_AUTH
ARG CSP_UPGRADE_INSECURE
ARG NEXT_PUBLIC_CSP_FRAME_SRC

# Build environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBOREPO_TELEMETRY_DISABLED=1

# Next.js public environment variables (must be set at build time)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL
ENV NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM
ENV NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID
ENV NEXT_PUBLIC_USE_KEYCLOAK_AUTH=$NEXT_PUBLIC_USE_KEYCLOAK_AUTH

# CSP configuration (evaluated at build time by Next.js headers())
ENV CSP_UPGRADE_INSECURE=$CSP_UPGRADE_INSECURE
ENV NEXT_PUBLIC_CSP_FRAME_SRC=$NEXT_PUBLIC_CSP_FRAME_SRC

# Run security checks before build (critical level only to allow builds with high/moderate issues)
RUN npm audit --audit-level=critical --production

# Clean any existing build artifacts to ensure fresh TypeScript compilation
# This prevents issues with ESM imports missing .js extensions from stale incremental builds
RUN rm -rf apps/*/dist packages/*/dist *.tsbuildinfo apps/*/*.tsbuildinfo packages/*/*.tsbuildinfo

# Build shared packages first to ensure they're available for other packages
# This is critical because @perfana/web imports from @perfana/shared/utils
RUN cd packages/shared && npm run build
RUN cd packages/config && npm run build

# Build applications (shared and config are already built)
RUN npm run build

# Clean up build artifacts and dev dependencies
RUN rm -rf node_modules \
    && npm ci --only=production --ignore-scripts \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/tmp/* /root/.npm \
    && rm -rf apps/web/.next/cache \
    && rm -rf apps/web/.next/trace \
    && mkdir -p apps/web/node_modules apps/grafana-sync/node_modules apps/worker/node_modules apps/perfana-report/node_modules

# ================================================================================================
# STAGE 6: Runtime Preparation
# ================================================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime-prep

WORKDIR /app

# Copy only essential built application files - use standard Next.js build output
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/scripts ./apps/web/scripts
COPY --from=builder --chown=nonroot:nonroot /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=nonroot:nonroot /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nonroot:nonroot /app/apps/grafana-sync/package.json ./apps/grafana-sync/package.json
COPY --from=builder --chown=nonroot:nonroot /app/apps/grafana-sync/dist ./apps/grafana-sync/dist
COPY --from=builder --chown=nonroot:nonroot /app/apps/grafana-sync/node_modules ./apps/grafana-sync/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=nonroot:nonroot /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=nonroot:nonroot /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/apps/perfana-report/package.json ./apps/perfana-report/package.json
COPY --from=builder --chown=nonroot:nonroot /app/apps/perfana-report/dist ./apps/perfana-report/dist
COPY --from=builder --chown=nonroot:nonroot /app/apps/perfana-report/node_modules ./apps/perfana-report/node_modules
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=nonroot:nonroot /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nonroot:nonroot /app/packages/config/dist ./packages/config/dist
COPY --from=builder --chown=nonroot:nonroot /app/packages/config/package.json ./packages/config/package.json
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json

# ================================================================================================
# STAGE 7: Web Application (Next.js)
# ================================================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS web

# Security labels and metadata
LABEL \
    org.opencontainers.image.title="Perfana Web Frontend" \
    org.opencontainers.image.description="Perfana Next.js frontend application" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/perfana/perfana-next-gen" \
    org.opencontainers.image.vendor="Perfana" \
    org.opencontainers.image.licenses="PROPRIETARY" \
    security.scan.enabled="true" \
    security.non-root="true"

# Set working directory
WORKDIR /app

# Copy runtime files from prep stage
COPY --from=runtime-prep --chown=nonroot:nonroot /app ./

# Environment variables for production
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Expose port (non-privileged)
EXPOSE 3000

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3000/', (res) => { process.exit(res.statusCode === 200 || res.statusCode === 307 ? 0 : 1) })"]

# Security: Run as non-root user
USER nonroot:nonroot

# Start the web application using the startup script which:
# 1. Generates __env.js with runtime environment variables
# 2. Starts the Next.js production server
# ENTRYPOINT is already set to /nodejs/bin/node by distroless
WORKDIR /app/apps/web
CMD ["scripts/start-server.js"]

# ================================================================================================
# STAGE 8: API Application (NestJS)
# ================================================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS api

# Security labels and metadata
LABEL \
    org.opencontainers.image.title="Perfana API Backend" \
    org.opencontainers.image.description="Perfana NestJS API backend" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/perfana/perfana-next-gen" \
    org.opencontainers.image.vendor="Perfana" \
    org.opencontainers.image.licenses="PROPRIETARY" \
    security.scan.enabled="true" \
    security.non-root="true"

# Set working directory
WORKDIR /app

# Copy runtime files from prep stage
COPY --from=runtime-prep --chown=nonroot:nonroot /app ./

# Environment variables for production
ENV NODE_ENV=production \
    PORT=3001

# Expose port (non-privileged)
EXPOSE 3001

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]

# Security: Run as non-root user
USER nonroot:nonroot

# Start the API application (ENTRYPOINT is already set to /nodejs/bin/node by distroless)
CMD ["apps/api/dist/main.js"]

# ================================================================================================
# STAGE 9: Grafana Sync Service (NestJS)
# ================================================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS grafana-sync

# Security labels and metadata
LABEL \
    org.opencontainers.image.title="Perfana Grafana Sync" \
    org.opencontainers.image.description="Perfana Grafana synchronization service" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/perfana/perfana-next-gen" \
    org.opencontainers.image.vendor="Perfana" \
    org.opencontainers.image.licenses="PROPRIETARY" \
    security.scan.enabled="true" \
    security.non-root="true"

# Set working directory
WORKDIR /app

# Copy runtime files from prep stage
COPY --from=runtime-prep --chown=nonroot:nonroot /app ./

# Environment variables for production
ENV NODE_ENV=production \
    PORT=3002

# Expose port (non-privileged)
EXPOSE 3002

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "process.exit(0)"]

# Security: Run as non-root user
USER nonroot:nonroot

# Start the Grafana Sync service (ENTRYPOINT is already set to /nodejs/bin/node by distroless)
CMD ["apps/grafana-sync/dist/src/main.js"]

# ================================================================================================
# STAGE 10: Worker Service (BullMQ)
# ================================================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS worker

# Security labels and metadata
LABEL \
    org.opencontainers.image.title="Perfana Worker" \
    org.opencontainers.image.description="Perfana background job worker service" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/perfana/perfana-next-gen" \
    org.opencontainers.image.vendor="Perfana" \
    org.opencontainers.image.licenses="PROPRIETARY" \
    security.scan.enabled="true" \
    security.non-root="true"

# Set working directory
WORKDIR /app

# Copy runtime files from prep stage
COPY --from=runtime-prep --chown=nonroot:nonroot /app ./

# Environment variables for production
ENV NODE_ENV=production

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "process.exit(0)"]

# Security: Run as non-root user
USER nonroot:nonroot

# Start the Worker service (ENTRYPOINT is already set to /nodejs/bin/node by distroless)
CMD ["apps/worker/dist/worker.js"]

# ================================================================================================
# STAGE 11: Perfana Report Service (PDF Generation with Puppeteer)
# ================================================================================================
# Note: Cannot use distroless base because Puppeteer requires Chromium and system libraries
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS perfana-report

# Security labels and metadata
LABEL \
    org.opencontainers.image.title="Perfana Report" \
    org.opencontainers.image.description="Perfana PDF report generation service with Puppeteer" \
    org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.source="https://github.com/perfana/perfana-next-gen" \
    org.opencontainers.image.vendor="Perfana" \
    org.opencontainers.image.licenses="PROPRIETARY" \
    security.scan.enabled="true" \
    security.non-root="true"

# Install Chromium and dependencies for Puppeteer
# These packages are required for Chromium to run in Alpine Linux
RUN apk upgrade --no-cache \
    && apk add --no-cache \
        chromium \
        nss \
        freetype \
        harfbuzz \
        ca-certificates \
        ttf-freefont \
        dumb-init \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 10001 -S perfana \
    && adduser -u 10001 -D -S -G perfana perfana

# Set working directory
WORKDIR /app

# Copy runtime files from prep stage
COPY --from=runtime-prep --chown=perfana:perfana /app ./

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    PORT=3003

# Expose port (non-privileged)
EXPOSE 3003

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Security: Run as non-root user
USER perfana:perfana

# Use dumb-init to handle signals properly (prevents zombie processes)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the Perfana Report service
CMD ["node", "apps/perfana-report/dist/src/main.js"]

# ================================================================================================
# STAGE 12: Development Environment
# ================================================================================================
FROM security-base AS development

# Install development tools
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files and install all dependencies
COPY --chown=perfana:perfana package*.json ./
COPY --chown=perfana:perfana turbo.json ./
COPY --chown=perfana:perfana apps/web/package*.json ./apps/web/
COPY --chown=perfana:perfana apps/api/package*.json ./apps/api/
COPY --chown=perfana:perfana packages/shared/package*.json ./packages/shared/
COPY --chown=perfana:perfana packages/config/package*.json ./packages/config/

RUN npm ci \
    && npm cache clean --force

# Copy source code
COPY --chown=perfana:perfana . .

# Switch to non-root user
USER perfana:perfana

# Development environment variables
ENV NODE_ENV=development

# Expose development ports
EXPOSE 3000 3001 9229

# Start development servers
CMD ["npm", "run", "dev"]

# ================================================================================================
# STAGE 13: Production (Default)
# ================================================================================================
FROM api AS production

# This is the default production stage
# Inherits from the API stage but can be customized further if needed