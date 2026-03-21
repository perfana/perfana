# API Keys

Create, validate, and manage API keys with caching.

## Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api-keys | List all API keys |
| POST | /api-keys | Create new API key |
| DELETE | /api-keys/:id | Revoke API key |
| POST | /api-keys/validate | Validate token (rate-limited) |
| GET | /api-keys/cache/stats | Cache statistics (admin) |
