# Daily Market Analysis Feature

## Overview

This feature uses Claude Opus 4.5 AI to analyze key market news and economic events for the upcoming trading week, providing actionable trading recommendations directly via Telegram.

## Features

- **Daily Automated Analysis**: Runs automatically once per day (default: 9 AM UTC)
- **AI-Powered Insights**: Uses Claude Opus 4.5 for comprehensive market analysis
- **Multi-Asset Coverage**: Analyzes XAUUSD (Gold), XAGUSD (Silver), BTCUSD (Bitcoin), EURUSD, and GBPUSD
- **Trade Recommendations**: Provides clear RECOMMENDED/NOT_RECOMMENDED/NEUTRAL signals
- **Confidence Scoring**: Each analysis includes a confidence level (0-100%)
- **Telegram Notifications**: Sends formatted analysis reports directly to your Telegram
- **Historical Records**: Maintains a complete database of all past analyses
- **Manual Trigger**: Run analysis on-demand via API endpoint

## Setup

### 1. Get Anthropic API Key

1. Visit [https://console.anthropic.com/](https://console.anthropic.com/)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Required for market analysis
ANTHROPIC_API_KEY=your_api_key_here

# Optional: Customize schedule (default: 9 AM UTC daily)
ANALYSIS_SCHEDULE=0 9 * * *

# Required for notifications
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Update Database Schema

Run the following command to update your database with the new MarketAnalysis table:

```bash
npm run db:push
```

Or if using migrations:

```bash
npm run db:migrate
```

### 4. Start the Bot

The market analysis scheduler starts automatically when you start the trading bot:

```bash
npm run start:bot
```

Or via the API/UI by starting the bot normally.

## Usage

### Automatic Daily Analysis

Once configured, the analysis runs automatically according to the schedule. Default is 9 AM UTC every day.

### Manual Analysis via API

Trigger an analysis on-demand:

```bash
# Run analysis now
curl -X POST http://localhost:3001/api/market-analysis

# Get analysis history
curl http://localhost:3001/api/market-analysis?limit=10

# Check scheduler status
curl http://localhost:3001/api/market-analysis/status
```

### Customize Schedule

Use cron expressions to customize when analysis runs:

```bash
# Every day at 8 AM UTC
ANALYSIS_SCHEDULE=0 8 * * *

# Monday-Friday at 7 AM UTC
ANALYSIS_SCHEDULE=0 7 * * 1-5

# Twice daily: 6 AM and 6 PM UTC
ANALYSIS_SCHEDULE=0 6,18 * * *
```

## Analysis Output

Each analysis includes:

### 1. Market News Summary
Key news, economic data releases, central bank decisions, and geopolitical events

### 2. Detailed Analysis
Technical and fundamental analysis of current market conditions for each tracked symbol

### 3. Likely Outcome
Primary forecast for the most likely market scenario

### 4. Trade Recommendation
- **RECOMMENDED**: Strong conviction to trade
- **NOT_RECOMMENDED**: High risk, avoid trading
- **NEUTRAL**: Monitor markets, no clear edge

### 5. Recommended Symbols
Specific symbols to trade (if RECOMMENDED)

### 6. Confidence Level
Score from 0-100% indicating analysis confidence

### 7. Reasoning
Detailed explanation of the recommendation

## Telegram Notification Format

You'll receive a formatted message like:

```
📊 WEEKLY MARKET ANALYSIS

📅 Week: Jan 20 - Jan 26, 2026
─────────────────

🟢 ✅ TRADE RECOMMENDED

🎯 Recommended Symbols:
   • XAUUSD
   • BTCUSD

📈 Market Outlook:
[Detailed market forecast...]

💡 Key Points:
[Key reasoning and factors...]

🎯 Confidence: 75%
███████░░░

🤖 Analysis powered by Claude Opus 4.5
```

## Database Schema

The `MarketAnalysis` table stores:

- Analysis date and week range
- Market news summary
- Full analysis text
- Likely outcome forecast
- Trade recommendation
- Recommended symbols (JSON array)
- Confidence score
- Reasoning
- Telegram notification status

## API Endpoints

### `GET /api/market-analysis`
Fetch analysis history

**Query Parameters:**
- `limit` (optional): Number of records to return (default: 10)

**Response:**
```json
{
  "success": true,
  "count": 10,
  "analyses": [
    {
      "id": "uuid",
      "analysisDate": "2026-01-19T09:00:00Z",
      "weekStartDate": "2026-01-20",
      "weekEndDate": "2026-01-26",
      "tradeRecommendation": "RECOMMENDED",
      "recommendedSymbols": ["XAUUSD", "BTCUSD"],
      "confidence": 0.75,
      "likelyOutcome": "...",
      "reasoning": "...",
      "sentToTelegram": true,
      "telegramSentAt": "2026-01-19T09:00:10Z"
    }
  ]
}
```

### `POST /api/market-analysis`
Manually trigger a new analysis

**Response:**
```json
{
  "success": true,
  "message": "Market analysis completed and notification sent",
  "analysisId": "uuid"
}
```

### `GET /api/market-analysis/status`
Get scheduler and service status

**Response:**
```json
{
  "success": true,
  "scheduler": {
    "isRunning": true,
    "schedule": "0 9 * * *",
    "marketAnalysisEnabled": true,
    "telegramEnabled": true
  },
  "latestAnalysis": {
    "id": "uuid",
    "analysisDate": "2026-01-19T09:00:00Z",
    "tradeRecommendation": "RECOMMENDED",
    "confidence": 0.75,
    "sentToTelegram": true
  }
}
```

## Troubleshooting

### Analysis Not Running

1. **Check API Key**: Ensure `ANTHROPIC_API_KEY` is set in `.env`
2. **Check Logs**: Look for `[MarketAnalysis]` and `[AnalysisScheduler]` messages
3. **Verify Schedule**: Check that cron expression is valid
4. **Check Status**: Call `/api/market-analysis/status` endpoint

### No Telegram Notifications

1. **Check Telegram Config**: Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
2. **Test Telegram**: Use `/api/telegram/test` endpoint to verify connection
3. **Check Logs**: Look for `[Telegram]` messages

### Database Errors

1. **Update Schema**: Run `npm run db:push` to ensure MarketAnalysis table exists
2. **Check Connection**: Verify `DATABASE_URL` is correct
3. **Check Permissions**: Ensure database user has CREATE TABLE permissions

## Cost Considerations

- Each analysis uses Claude Opus 4.5 (highest quality model)
- Typical analysis costs ~$0.15-0.30 per run
- Daily analysis = ~$5-10/month
- Consider using scheduled runs only on trading days to reduce costs

## Smart Money Concepts Integration

The analysis is tailored for the SMC (Smart Money Concepts) trading strategy used by this bot:

- Considers Order Block formations
- Analyzes liquidity sweep opportunities
- Evaluates break of structure patterns
- Assesses market structure alignment across timeframes

This ensures recommendations align with the bot's automated trading logic.

## Future Enhancements

Potential improvements:

- [ ] Symbol-specific analysis (one per trading pair)
- [ ] Technical indicator integration
- [ ] Sentiment analysis from social media
- [ ] Economic calendar integration
- [ ] Backtesting recommendation accuracy
- [ ] Multi-language support for notifications

## Support

For issues or questions:
1. Check the logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure database schema is up to date
4. Test with manual trigger first before relying on scheduled runs
