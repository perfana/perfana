-- ================================================================================================
-- PERFANA NATIVE POSTGRESQL INITIALIZATION SCRIPT
-- ================================================================================================
-- This script initializes the PostgreSQL database for Perfana migration
-- Includes TimescaleDB setup and required extensions
-- ================================================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;

-- Create perfana user with appropriate permissions
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'perfana') THEN

      CREATE ROLE perfana LOGIN PASSWORD 'perfana_dev_password';
   END IF;
END
$do$;

-- Grant database access to perfana user
GRANT ALL PRIVILEGES ON DATABASE perfana TO perfana;
GRANT ALL PRIVILEGES ON SCHEMA public TO perfana;

-- Create initial schema structure (based on existing Supabase schema)
-- This will be populated by TypeORM migrations later

-- Set up proper permissions for all future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO perfana;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO perfana;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO perfana;

-- Configure timezone
SET timezone = 'UTC';

-- Log initialization completion
SELECT 'PostgreSQL initialized successfully for Perfana migration' as status;