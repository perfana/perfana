FROM node:20-alpine

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install all dependencies (including dev for build)
# Note: Using npm install instead of npm ci because this is part of a monorepo
# without individual package-lock.json files
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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Set production environment
ENV NODE_ENV=production

# Start the grafana-sync service
CMD ["npm", "start"]
