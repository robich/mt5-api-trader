import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const NEWS_PROMPT = `Search for the latest market news from the last 2 days on these topics:
1. Gold (XAU/USD) price movement and outlook
2. Bitcoin (BTC/USD) price movement and analysis
3. Silver (XAG/USD) price movement
4. Federal Reserve / interest rate decisions / USD strength
5. Major geopolitical events affecting financial markets

For each topic, provide:
- Key recent headlines and developments
- Overall sentiment: Bullish, Bearish, or Neutral
- Potential impact on trading

Format as a structured market briefing with ## headers per topic. Be concise.`;

/**
 * Fetch market news using Claude's built-in web search tool.
 * Replaces NewsAPI and Alpha Vantage with a single Claude call.
 * @returns {Object} news data with summary
 */
export async function fetchMarketNews() {
  console.log('[news] Fetching market news via Claude web search...');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
      }],
      messages: [{ role: 'user', content: NEWS_PROMPT }],
    });

    // Extract text blocks (skip tool_use / web_search_tool_result blocks)
    const textBlocks = response.content.filter(b => b.type === 'text');
    const summary = textBlocks.map(b => b.text).join('\n\n');

    if (!summary) {
      console.warn('[news] No text in web search response.');
      return fallback();
    }

    console.log(`[news] Market news fetched (${summary.length} chars).`);
    console.log(`[news] Tokens: ${response.usage?.input_tokens}in / ${response.usage?.output_tokens}out`);

    return {
      articles: [],
      sentiment: [],
      summary,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[news] Claude web search failed:', err.message);
    return fallback();
  }
}

function fallback() {
  return {
    articles: [],
    sentiment: [],
    summary: 'No market news available for this analysis period.',
    fetchedAt: new Date().toISOString(),
  };
}
