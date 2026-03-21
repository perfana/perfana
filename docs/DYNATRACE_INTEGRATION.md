# Dynatrace Integration

This document describes how to configure Dynatrace integration with Perfana for metrics collection and analysis.

## Overview

Perfana integrates with Dynatrace to collect performance metrics during test runs. The integration supports both:
- **Dynatrace SaaS** - Uses DQL (Dynatrace Query Language) via the Platform API
- **Dynatrace Managed** - Uses Metrics API v2 selectors

## Required API Token Scopes

When creating an API token in Dynatrace, the following scopes are required:

### API v2 Scopes

| Scope | Description |
|-------|-------------|
| **Read entities** | Access entity data (hosts, services, applications) |
| **Read metrics** | Query metrics via Metrics API v2 |
| **Read problems** | Access problem data and events |
| **Read settings** | Read Dynatrace settings and configurations |

### API v1 Scopes

| Scope | Description |
|-------|-------------|
| **Access problem and event feed, metrics, and topology** | Legacy API access for metrics and topology data |
| **Read configuration** | Read Dynatrace configuration objects |

### Platform Token Scopes (SaaS Only)

For Dynatrace SaaS environments using DQL queries, a separate Platform token is required with these OAuth scopes:

| Scope | Description |
|-------|-------------|
| `storage:events:read` | Read events from Grail storage |
| `storage:metrics:read` | Read metrics from Grail storage |
| `storage:logs:read` | Read logs from Grail storage |
| `storage:entities:read` | Read entities from Grail storage |
| `storage:buckets:read` | Read bucket configurations |

## Token Creation

1. Navigate to **Settings > Integration > Dynatrace API** in your Dynatrace environment
2. Click **Generate new token**
3. Enter a descriptive name (e.g., "Perfana Integration")
4. Select the required scopes listed above
5. Click **Generate token**
6. Copy and securely store the token

## Configuration in Perfana

### Database Configuration

Dynatrace configurations are stored in the `dynatrace_configs` table:

| Field | Description |
|-------|-------------|
| `host` | Dynatrace environment URL (e.g., `https://abc12345.live.dynatrace.com`) |
| `api_token` | API token with v1/v2 scopes |
| `platform_api_token` | Platform token for DQL queries (SaaS only) |
| `dynatrace_type` | Either `saas` or `managed` |
| `label` | Human-readable identifier |

### Environment Variables (Fallback)

If tokens are not configured in the database, the worker falls back to environment variables:

```bash
DYNATRACE_API_TOKEN=dt0c01.xxxxx...
DYNATRACE_PLATFORM_TOKEN=dt0c01.xxxxx...  # Required for SaaS/DQL
```

## Query Configuration

Dynatrace queries are defined in the `dynatrace_queries` table and associated with:
- System under test
- Test environment
- Workload

Each query specifies:
- DQL query or Metrics API v2 selector
- Panel mapping for visualization
- Metric name patterns

## Troubleshooting

### Common Issues

1. **"Platform API token required for SaaS instance"**
   - SaaS instances require a Platform token for DQL queries
   - Generate a token with OAuth scopes if using Platform API

2. **"Dynatrace API token not found"**
   - Verify the token is configured in `dynatrace_configs` table
   - Or set `DYNATRACE_API_TOKEN` environment variable

3. **"No Dynatrace queries configured"**
   - Add query configurations in `dynatrace_queries` table for your system/environment/workload

### Verifying Token Scopes

Use the Dynatrace API to verify your token has the required scopes:

```bash
curl -X GET "https://YOUR_ENV.live.dynatrace.com/api/v2/apiTokens/lookup" \
  -H "Authorization: Api-Token YOUR_TOKEN" \
  -H "Content-Type: application/json"
```
