const NEWS_API_KEY = process.env.NEWS_API_KEY;
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;

const SEARCH_QUERIES = [
  'gold price',
  'bitcoin price',
  'federal reserve interest rate',
  'geopolitical risk market',
  'silver price',
  'USD dollar index',
];

const ALPHA_VANTAGE_TICKERS = ['FOREX:XAU', 'CRYPTO:BTC', 'FOREX:USD'];

/**
 * Fetch market news and sentiment from available APIs.
 * Gracefully falls back if APIs are unavailable.
 * @returns {Object} news data with articles and sentiment
 */
export async function fetchMarketNews() {
  const [newsArticles, sentimentData] = await Promise.all([
    fetchNewsAPI().catch(err => {
      console.warn('[news] NewsAPI failed:', err.message);
      return [];
    }),
    fetchAlphaVantageSentiment().catch(err => {
      console.warn('[news] Alpha Vantage failed:', err.message);
      return [];
    }),
  ]);

  const summary = buildNewsSummary(newsArticles, sentimentData);

  return {
    articles: newsArticles,
    sentiment: sentimentData,
    summary,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch articles from NewsAPI.org
 */
async function fetchNewsAPI() {
  if (!NEWS_API_KEY) {
    console.log('[news] NEWS_API_KEY not set, skipping NewsAPI.');
    return [];
  }

  const articles = [];
  // Limit to 2 queries to stay within free tier
  const queries = SEARCH_QUERIES.slice(0, 3);

  for (const query of queries) {
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', query);
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', '5');
    url.searchParams.set('language', 'en');
    url.searchParams.set('apiKey', NEWS_API_KEY);

    // Only fetch last 2 days of news
    const from = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
    url.searchParams.set('from', from);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`[news] NewsAPI query "${query}" returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.articles) {
        articles.push(...data.articles.map(a => ({
          title: a.title,
          description: a.description,
          source: a.source?.name,
          publishedAt: a.publishedAt,
          query,
        })));
      }
    } catch (err) {
      console.warn(`[news] NewsAPI query "${query}" failed:`, err.message);
    }
  }

  console.log(`[news] Fetched ${articles.length} articles from NewsAPI.`);
  return articles;
}

/**
 * Fetch sentiment data from Alpha Vantage NEWS_SENTIMENT endpoint.
 */
async function fetchAlphaVantageSentiment() {
  if (!ALPHA_VANTAGE_KEY) {
    console.log('[news] ALPHA_VANTAGE_KEY not set, skipping Alpha Vantage.');
    return [];
  }

  const sentiments = [];

  for (const ticker of ALPHA_VANTAGE_TICKERS) {
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'NEWS_SENTIMENT');
    url.searchParams.set('tickers', ticker);
    url.searchParams.set('limit', '10');
    url.searchParams.set('apikey', ALPHA_VANTAGE_KEY);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`[news] Alpha Vantage ${ticker} returned ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.feed) {
        sentiments.push({
          ticker,
          articles: data.feed.slice(0, 5).map(item => ({
            title: item.title,
            sentiment: item.overall_sentiment_label,
            score: item.overall_sentiment_score,
            publishedAt: item.time_published,
          })),
        });
      }
    } catch (err) {
      console.warn(`[news] Alpha Vantage ${ticker} failed:`, err.message);
    }
  }

  console.log(`[news] Fetched sentiment for ${sentiments.length} tickers from Alpha Vantage.`);
  return sentiments;
}

/**
 * Build a concise news summary for Claude's context.
 */
function buildNewsSummary(articles, sentiment) {
  const lines = [];

  if (articles.length === 0 && sentiment.length === 0) {
    return 'No market news available for this analysis period.';
  }

  if (articles.length > 0) {
    lines.push('## Recent Market News');
    // Deduplicate by title similarity and take top 10
    const seen = new Set();
    const unique = articles.filter(a => {
      const key = a.title?.substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);

    for (const a of unique) {
      lines.push(`- **${a.title}** (${a.source}, ${a.publishedAt?.split('T')[0]})`);
      if (a.description) {
        lines.push(`  ${a.description.substring(0, 200)}`);
      }
    }
  }

  if (sentiment.length > 0) {
    lines.push('\n## Market Sentiment');
    for (const s of sentiment) {
      const avgScore = s.articles.reduce((sum, a) => sum + parseFloat(a.score || 0), 0) / s.articles.length;
      const label = avgScore > 0.15 ? 'Bullish' : avgScore < -0.15 ? 'Bearish' : 'Neutral';
      lines.push(`- **${s.ticker}**: ${label} (avg score: ${avgScore.toFixed(3)})`);
      for (const a of s.articles.slice(0, 3)) {
        lines.push(`  - ${a.title} [${a.sentiment}]`);
      }
    }
  }

  return lines.join('\n');
}
