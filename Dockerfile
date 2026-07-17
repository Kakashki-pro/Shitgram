# Multi-stage build for optimized Node.js 20 Alpine image
# Optimized for Back4App hosting with WebSocket support

# Stage 1: Builder
FROM node:22-alpine AS builder

LABEL maintainer="Kakashki-pro"
LABEL description="Shitgram - Encrypted messaging platform with WebSocket & voice calls"

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++ && \
    npm install -g npm@latest

WORKDIR /build

# Copy package files
COPY backend/package*.json ./

# Install dependencies with cache optimization
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Runtime
FROM node:22-alpine

# Set environment
ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy application files
COPY backend/ .

# Health check for Back4App
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port 3000 as fallback (Back4App sets PORT environment variable)
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
