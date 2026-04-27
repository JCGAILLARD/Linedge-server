const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// ─── TIER LIMITS (analyses per day) ───
const TIER_LIMITS = {
  starter: 5,
  sharp: 20,
  pro: 999999
};

// ─── Simple in-memory cache (resets on server restart) ───
const cache = new Map();
const userUsage = new Map();

function getCacheKey(type, params) {
  return `${type}_${JSON.stringify(params)}`;
}

function getUsageKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `${userId}_${today}`;
}

function checkLimit(userId, tier) {
  const key = getUsageKey(userId);
  const usage = userUsage.get(key) || 0;
  const limit = TIER_LIMITS[tier] || TIER_LIMITS.starter;
  return { allowed: usage < limit, usage, limit };
}

function incrementUsage(userId) {
  const key = getUsageKey(userId);
  const usage = userUsage.get(key) || 0;
  userUsage.set(key, usage + 1);
}

// ─── HEALTH CHECK ───
app.get('/', (req, res) => {
  res.json({ status: 'Linedge server running', version: '1.0.0' });
});

// ─── LIVE ODDS (from The Odds API) ───
app.get('/odds/:sport', async (req, res) => {
  const { sport } = req.params;
  const cacheKey = getCacheKey('odds', { sport });
  
  // Cache odds for 5 minutes
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return res.json(cached.data);
    }
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,h2h,totals&bookmakers=fanduel,draftkings,betmgm,caesars&oddsFormat=american`;
    const response = await fetch(url);
    const data = await response.json();
    
    cache.set(cacheKey, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── CLAUDE AI ANALYSIS ───
app.post('/analyze', async (req, res) => {
  const { prompt, useWebSearch, userId, tier } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Check tier limits
  const id = userId || 'anonymous';
  const userTier = tier || 'starter';
  const { allowed, usage, limit } = checkLimit(id, userTier);

  if (!allowed) {
    return res.status(429).json({ 
      error: `Daily limit reached. You have used ${usage}/${limit} analyses today. Upgrade your plan for more.`,
      limitReached: true,
      usage,
      limit
    });
  }

  // Check cache for AI responses (cache for 30 minutes)
  const cacheKey = getCacheKey('analyze', { prompt: prompt.slice(0, 100) });
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 30 * 60 * 1000) {
      incrementUsage(id);
      return res.json(cached.data);
    }
  }

  try {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    };

    if (useWebSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
      body.max_tokens = 4000;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'API error' });
    }

    const data = await response.json();
    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const result = { text };
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    incrementUsage(id);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET USER USAGE ───
app.get('/usage/:userId', (req, res) => {
  const { userId } = req.params;
  const tier = req.query.tier || 'starter';
  const { usage, limit } = checkLimit(userId, tier);
  res.json({ usage, limit, remaining: limit - usage });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Linedge server running on port ${PORT}`);
});
