// Environment setup for tests
const dotenv = require('dotenv');

// Load environment variables in the correct order
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Set test-specific environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.REDIS_REQUIRED = 'false'; // Disable Redis requirement in tests

// Required Keycloak environment variables for tests that import AppModule
process.env.KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
process.env.KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'perfana-test';
process.env.KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'perfana-api';
process.env.KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || 'test-secret';

// Encryption key for sensitive data (64 hex characters = 32 bytes)
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);