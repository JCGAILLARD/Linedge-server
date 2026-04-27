# Linedge Backend Server

## Environment Variables (set in Railway)
- ANTHROPIC_API_KEY — your Anthropic API key
- ODDS_API_KEY — your The Odds API key

## Endpoints
- GET / — health check
- GET /odds/:sport — live odds from sportsbooks
- POST /analyze — Claude AI analysis
- GET /usage/:userId — check user's daily usage
