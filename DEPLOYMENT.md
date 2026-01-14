# MT5 Trading Bot - Deployment Guide

## Quick Start

### 1. Local Testing
```bash
# Test the bot locally first
npm install
cp .env.example .env
# Edit .env with your MetaAPI credentials

# Run the bot
node scripts/trading-bot.mjs
```

### 2. Docker Deployment (Recommended)

#### Build and run locally
```bash
# Build the image
docker-compose build

# Run the trading bot only
docker-compose up -d trading-bot

# Run with web UI
docker-compose --profile with-ui up -d

# View logs
docker-compose logs -f trading-bot
```

---

## VPS Deployment (Contabo/Hetzner/DigitalOcean)

### Step 1: Provision VPS
- **Minimum specs:** 1 vCPU, 1GB RAM, 20GB SSD
- **Recommended:** 2 vCPU, 2GB RAM (for web UI)
- **OS:** Ubuntu 22.04 LTS

### Step 2: Initial Server Setup
```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
apt install docker-compose-plugin -y

# Create non-root user (optional but recommended)
adduser trader
usermod -aG docker trader
su - trader
```

### Step 3: Deploy the Bot
```bash
# Clone your repository
git clone https://github.com/yourusername/mt5-api-trader.git
cd mt5-api-trader

# Create environment file
cat > .env << 'EOF'
META_API_TOKEN=your_metaapi_token_here
META_API_ACCOUNT_ID=your_account_id_here
DATABASE_URL=file:/app/data/trading.db
EOF

# Build and start
docker-compose build
docker-compose up -d trading-bot

# Check status
docker-compose ps
docker-compose logs -f trading-bot
```

### Step 4: Enable Auto-Restart on Reboot
```bash
# Docker containers with 'restart: unless-stopped' will auto-restart
# To enable Docker on boot:
systemctl enable docker
```

---

## Configuration

### Trading Parameters
Edit `scripts/trading-bot.mjs` to adjust:

```javascript
const CONFIG = {
  // Symbols to trade
  symbols: ['XAUUSD.s', 'BTCUSD'],

  // Strategy (from backtesting)
  strategy: {
    minOBScore: 70,           // 70 for quality, 65 for more trades
    useKillZones: false,      // true = conservative, false = aggressive
    maxDailyDD: 8,            // Daily drawdown limit %
    fixedRR: 2,               // Risk:Reward ratio
    confirmationType: 'engulf', // 'close', 'strong', 'engulf'
  },

  // Risk management
  risk: {
    riskPerTrade: 1,          // % per trade (1-2% recommended)
    maxOpenTrades: 3,
    maxTradesPerSymbol: 1,
  },
};
```

### Strategy Profiles

#### Aggressive (Higher Returns, Higher Risk)
```javascript
strategy: {
  minOBScore: 70,
  useKillZones: false,
  maxDailyDD: 8,
  confirmationType: 'engulf',
}
// Expected: 75% WR, 2.65+ PF, 20-30% max DD
```

#### Balanced (Good Risk/Reward)
```javascript
strategy: {
  minOBScore: 65,
  useKillZones: true,
  maxDailyDD: 6,
  confirmationType: 'close',
}
// Expected: 73% WR, 2.69 PF, 10-15% max DD
```

#### Conservative (For Prop Firms)
```javascript
strategy: {
  minOBScore: 70,
  useKillZones: true,
  maxDailyDD: 5,
  confirmationType: 'strong',
}
// Expected: 71% WR, 2.0+ PF, 5-10% max DD
```

---

## Monitoring

### View Logs
```bash
# Real-time logs
docker-compose logs -f trading-bot

# Last 100 lines
docker-compose logs --tail 100 trading-bot
```

### Check Status
```bash
# Container status
docker-compose ps

# Resource usage
docker stats mt5-trading-bot
```

### Web UI (Optional)
```bash
# Start with web UI
docker-compose --profile with-ui up -d

# Access at http://your-server-ip:3001
```

---

## Maintenance

### Update the Bot
```bash
cd mt5-api-trader

# Pull latest code
git pull

# Rebuild and restart
docker-compose build
docker-compose up -d trading-bot
```

### Backup Database
```bash
# Copy SQLite database
docker cp mt5-trading-bot:/app/data/trading.db ./backup-$(date +%Y%m%d).db
```

### Stop the Bot
```bash
# Graceful stop
docker-compose stop trading-bot

# Remove container
docker-compose down
```

---

## Troubleshooting

### Bot Not Connecting
```bash
# Check MetaAPI credentials in .env
cat .env | grep META_API

# Check container logs
docker-compose logs trading-bot | grep -i error
```

### High Memory Usage
```bash
# Restart the container
docker-compose restart trading-bot

# Check for memory leaks
docker stats mt5-trading-bot
```

### Rate Limiting
MetaAPI has rate limits. If you see 429 errors:
- Increase `scanInterval` in CONFIG
- Use cached historical data
- Reduce number of symbols

---

## Security Checklist

- [ ] Use non-root user on VPS
- [ ] Enable firewall (ufw)
- [ ] Keep .env file secure (chmod 600)
- [ ] Use SSH keys, disable password auth
- [ ] Regular backups of database
- [ ] Monitor logs for errors
- [ ] Set up alerts (optional: use Uptime Robot)

---

## Recommended VPS Providers

| Provider | Price | Location | Notes |
|----------|-------|----------|-------|
| **Contabo** | $6/mo | Germany | Best value |
| **Hetzner** | $5/mo | Germany/Finland | Low latency EU |
| **DigitalOcean** | $6/mo | Multiple | Easy to use |
| **Vultr** | $6/mo | Multiple | Good performance |
| **AWS Lightsail** | $5/mo | Multiple | AWS ecosystem |

For lowest latency to MT5 brokers, choose a location near your broker's server.

---

## Railway Deployment (PaaS - Recommended for Simplicity)

Railway provides easy deployment with automatic SSL, health checks, and zero infrastructure management.

### Step 1: Setup Railway

1. Create account at [railway.app](https://railway.app)
2. Install Railway CLI (optional): `npm install -g @railway/cli`
3. Connect your GitHub repository

### Step 2: Add PostgreSQL Database

1. In Railway dashboard, click "New Service" → "Database" → "PostgreSQL"
2. Copy the `DATABASE_URL` from the PostgreSQL service variables

### Step 3: Configure Environment Variables

In Railway, go to your service settings and add:

```
META_API_TOKEN=your_metaapi_token
META_API_ACCOUNT_ID=your_account_id
DATABASE_URL=postgresql://... (from step 2)
NODE_ENV=production
```

### Step 4: Deploy

Railway will automatically:
- Detect the `railway.toml` configuration
- Build using `Dockerfile.railway`
- Run both web UI and trading bot in a single service
- Expose the web UI on a public URL

### Step 5: Verify Deployment

1. Check deployment logs in Railway dashboard
2. Visit your Railway URL to see the web UI
3. Check `/api/health` endpoint for service status

### Railway Configuration Files

- `railway.toml` - Railway deployment configuration
- `Dockerfile.railway` - Single-service Docker build
- `scripts/start-all.mjs` - Runs both bot and web UI

### Railway Commands

```bash
# Deploy from CLI
railway up

# View logs
railway logs

# Open dashboard
railway open
```

### Railway Pricing

- **Free tier**: 500 hours/month, limited resources
- **Pro**: $5/month + usage (recommended for 24/7 trading)

---
