# MT5 Strategy Analyst - Dockerfile
# Build context must be the REPO ROOT (not strategy-analyst/)
FROM node:20-slim

# Install git (for cloning repo) and build tools (for native deps)
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /analyst

# Copy and install analyst dependencies
COPY strategy-analyst/package*.json ./
RUN npm ci

# Copy analyst source code
COPY strategy-analyst/ ./

# Pre-install main app dependencies at build time.
# At runtime, these are symlinked into the cloned repo so we avoid
# running npm ci in the sandbox (which fails with waitpid/EOF errors).
WORKDIR /app-deps-cache
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci --ignore-scripts && npx prisma generate

WORKDIR /analyst
ENV NODE_ENV=production

CMD ["node", "run-analysis.mjs"]
