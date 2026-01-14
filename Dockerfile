# MT5 API Trader - Production Dockerfile
FROM node:20-slim

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js app (if using the web UI)
RUN npm run build

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment variables (override in docker-compose or runtime)
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/trading.db

# Expose port for web UI (optional)
EXPOSE 3001

# Default command - run the trading bot
CMD ["node", "scripts/trading-bot.mjs"]
