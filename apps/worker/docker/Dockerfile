# Worker Dockerfile - Standalone build for the worker service
# NOTE: This Dockerfile must be built from the monorepo root context
# Example: docker build -f apps/worker/docker/Dockerfile -t perfana-worker .

FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

# Copy root package files first for dependency resolution
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy shared package (worker dependency)
COPY packages/shared/package*.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src

# Copy worker package files
COPY apps/worker/package*.json ./apps/worker/
COPY apps/worker/tsconfig.json ./apps/worker/

# Install all dependencies (including dev for build)
RUN npm install --workspace=@perfana/shared --workspace=@perfana/worker

# Copy worker source code
COPY apps/worker/src ./apps/worker/src

# Clean any existing build artifacts to ensure fresh TypeScript compilation
# This prevents issues with ESM imports missing .js extensions from stale incremental builds
RUN rm -rf apps/worker/dist packages/shared/dist *.tsbuildinfo apps/worker/*.tsbuildinfo packages/shared/*.tsbuildinfo

# Build shared package first (dependency)
RUN npm run build --workspace=@perfana/shared

# Build worker
RUN npm run build --workspace=@perfana/worker

# ================================================================================================
# Production stage
# ================================================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/worker/package.json ./apps/worker/

# Install production dependencies only
RUN npm install --workspace=@perfana/shared --workspace=@perfana/worker --omit=dev && npm cache clean --force

# Copy built artifacts from builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S perfana -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R perfana:nodejs /app

# Switch to non-root user
USER perfana

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Expose debugging port (optional)
EXPOSE 9229

# Set production environment
ENV NODE_ENV=production

# Start the worker
CMD ["node", "apps/worker/dist/worker.js"]
