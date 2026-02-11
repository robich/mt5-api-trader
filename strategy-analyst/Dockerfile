# MT5 Strategy Analyst - Dockerfile
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
# Works with both docker-compose (context=repo root) and Railway (root=/strategy-analyst)
COPY package*.json ./
RUN npm ci

# Copy analyst source code
COPY . ./

ENV NODE_ENV=production

CMD ["node", "run-analysis.mjs"]
