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

# Install all dependencies (need devDeps for build)
RUN npm ci

# Copy application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js app (if using the web UI)
RUN npm run build

# Environment variables (override at runtime)
ENV NODE_ENV=production

# Expose port for web UI (optional)
EXPOSE 3001

# Default command - start Next.js production server
CMD ["npm", "start"]
