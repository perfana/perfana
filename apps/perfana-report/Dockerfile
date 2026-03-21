# Standalone Dockerfile for Perfana Report Service
#
# NOTE: This Dockerfile requires the @perfana/shared package from the monorepo.
# For local builds, copy the shared package or build from the monorepo root using:
#   docker build -t perfana-report --target perfana-report -f ../../Dockerfile ../..
#
# For production builds in CI/CD, use the root Dockerfile with target=perfana-report
#
# To use this standalone Dockerfile, you must first:
# 1. Build the shared package: cd ../../packages/shared && npm run build
# 2. Copy shared to this directory: cp -r ../../packages/shared ./shared
# 3. Update package.json to use local path: "@perfana/shared": "file:./shared"

FROM node:20-alpine

# Install Chromium and dependencies for Puppeteer
RUN apk upgrade --no-cache \
    && apk add --no-cache \
        chromium \
        nss \
        freetype \
        harfbuzz \
        ca-certificates \
        ttf-freefont \
        python3 \
        make \
        g++ \
        dumb-init \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Remove dev dependencies for smaller production image
RUN npm install --only=production && npm cache clean --force

# Remove build dependencies
RUN apk del python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S perfana -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R perfana:nodejs /app

# Switch to non-root user
USER perfana

# Tell Puppeteer to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    PORT=3003

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the perfana-report service
CMD ["npm", "start"]
