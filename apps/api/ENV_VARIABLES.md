# Environment Variables

This document lists all environment variables used by the Perfana API.

## Required Variables

The following environment variables **must** be set for the application to start:

### Database Configuration

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `DB_HOST` | string | PostgreSQL database host | `localhost` or `postgres.example.com` |
| `DB_USERNAME` | string | PostgreSQL database username | `perfana` |
| `DB_PASSWORD` | string | PostgreSQL database password | `your_secure_password` |
| `DB_NAME` | string | PostgreSQL database name | `perfana` |

### Keycloak Configuration

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `KEYCLOAK_URL` | string (URI) | Keycloak server URL | `http://localhost:8080` |
| `KEYCLOAK_REALM` | string | Keycloak realm name | `perfana-prod` |
| `KEYCLOAK_CLIENT_ID` | string | Keycloak client ID | `perfana-api` |

## Optional Variables

The following variables have default values and are optional:

### Application Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | enum | `development` | Application environment (`development`, `production`, `test`) |
| `PORT` | number | `3001` | Server port |
| `LOG_LEVEL` | enum | `info` | Application log level (`error`, `warn`, `info`, `debug`, `verbose`) |
| `CORS_ORIGIN` | string | `http://localhost:3000` | CORS allowed origin |

### Database Configuration (Optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DB_PORT` | number | `5432` | PostgreSQL database port |
| `DB_SSL` | enum | `false` | PostgreSQL SSL mode (`true`, `false`, `require`) |

### Keycloak Configuration (Optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `KEYCLOAK_CLIENT_SECRET` | string | (empty) | Keycloak client secret (optional for public clients) |
| `KEYCLOAK_POLICY_ENFORCEMENT` | enum | `PERMISSIVE` | Policy enforcement mode (`ENFORCING`, `PERMISSIVE`, `DISABLED`) |
| `KEYCLOAK_TOKEN_VALIDATION` | enum | `ONLINE` | Token validation method (`ONLINE`, `OFFLINE`, `NONE`) |

### Redis Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `REDIS_HOST` | string | `127.0.0.1` | Redis server host |
| `REDIS_PORT` | number | `6379` | Redis server port |
| `REDIS_PASSWORD` | string | (empty) | Redis password (optional) |

## Environment File Templates

### Development (.env.local)

```bash
# Application
NODE_ENV=development
PORT=3001
LOG_LEVEL=debug
CORS_ORIGIN=http://localhost:3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana
DB_PASSWORD=perfana_dev_password
DB_NAME=perfana
DB_SSL=false

# Keycloak
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=perfana-prod
KEYCLOAK_CLIENT_ID=perfana-api
KEYCLOAK_CLIENT_SECRET=
KEYCLOAK_POLICY_ENFORCEMENT=PERMISSIVE
KEYCLOAK_TOKEN_VALIDATION=ONLINE

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
```

### Production (.env)

```bash
# Application
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
CORS_ORIGIN=https://perfana.example.com

# Database
DB_HOST=your-db-host.example.com
DB_PORT=5432
DB_USERNAME=perfana_prod
DB_PASSWORD=your_secure_production_password
DB_NAME=perfana_production
DB_SSL=require

# Keycloak
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_REALM=perfana-prod
KEYCLOAK_CLIENT_ID=perfana-api
KEYCLOAK_CLIENT_SECRET=your_keycloak_client_secret
KEYCLOAK_POLICY_ENFORCEMENT=ENFORCING
KEYCLOAK_TOKEN_VALIDATION=ONLINE

# Redis
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
```

## Validation

The application uses Joi to validate all environment variables on startup. If any required variable is missing or invalid:

1. The application will **fail to start**
2. A detailed error message will be logged indicating which variables are invalid
3. The error message will include the expected format/values

Example validation error:

```
[Nest] ERROR [ConfigService] Configuration validation error:
"DB_HOST" is required
"KEYCLOAK_URL" must be a valid uri
"DB_PORT" must be a number
```

## Security Best Practices

1. **Never commit `.env.local` or `.env` files to version control**
2. Use strong, randomly generated passwords for production
3. Enable SSL for database connections in production (`DB_SSL=require`)
4. Use `KEYCLOAK_POLICY_ENFORCEMENT=ENFORCING` in production
5. Store sensitive values in a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault)
6. Rotate credentials regularly
7. Use different credentials for each environment

## Troubleshooting

### Application won't start

Check that:
- All required variables are set
- Database credentials are correct
- Keycloak URL is accessible
- Redis is running (if using queue/realtime features)

### Database connection fails

- Verify `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, and `DB_NAME`
- Check network connectivity to database server
- Verify SSL settings match database requirements
- Check database server logs for connection errors

### Keycloak authentication fails

- Verify `KEYCLOAK_URL` is correct and accessible
- Check `KEYCLOAK_REALM` matches your Keycloak realm name
- Verify `KEYCLOAK_CLIENT_ID` exists in the realm
- For confidential clients, ensure `KEYCLOAK_CLIENT_SECRET` is correct
