--
-- PostgreSQL database dump
--

\restrict vfpPc72u8UtVbBCMXJYqAW7FZRdrPhh1dBEFbdbIriDQyf4ZC4GixKu6Hh2QHM5

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: _realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA _realtime;


--
-- Name: timescaledb; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;


--
-- Name: EXTENSION timescaledb; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION timescaledb IS 'Enables scalable inserts and complex queries for time-series data (Apache 2 Edition)';


--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pg_net; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_net; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_net IS 'Async HTTP';


--
-- Name: pgboss; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgboss;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: pgsodium; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgsodium;


--
-- Name: pgsodium; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgsodium WITH SCHEMA pgsodium;


--
-- Name: EXTENSION pgsodium; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgsodium IS 'Pgsodium is a modern cryptography library for Postgres.';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: supabase_functions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_functions;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;


--
-- Name: EXTENSION pg_graphql; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: pgjwt; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;


--
-- Name: EXTENSION pgjwt; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgjwt IS 'JSON Web Token API for Postgresql';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: job_state; Type: TYPE; Schema: pgboss; Owner: -
--

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

    REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: create_queue(text, json); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.create_queue(queue_name text, options json) RETURNS void
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      table_name varchar := 'j' || encode(sha224(queue_name::bytea), 'hex');
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
      INSERT INTO pgboss.queue (
        name,
        policy,
        retry_limit,
        retry_delay,
        retry_backoff,
        expire_seconds,
        retention_minutes,
        dead_letter,
        partition_name
      )
      VALUES (
        queue_name,
        options->>'policy',
        (options->>'retryLimit')::int,
        (options->>'retryDelay')::int,
        (options->>'retryBackoff')::bool,
        (options->>'expireInSeconds')::int,
        (options->>'retentionMinutes')::int,
        options->>'deadLetter',
        table_name
      )
      ON CONFLICT DO NOTHING
      RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', table_name);

      EXECUTE format('ALTER TABLE pgboss.%1$I ADD PRIMARY KEY (name, id)', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('ALTER TABLE pgboss.%1$I ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i1 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''created'' AND policy = ''short''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i2 ON pgboss.%1$I (name, COALESCE(singleton_key, '''')) WHERE state = ''active'' AND policy = ''singleton''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i3 ON pgboss.%1$I (name, state, COALESCE(singleton_key, '''')) WHERE state <= ''active'' AND policy = ''stately''', table_name);
      EXECUTE format('CREATE UNIQUE INDEX %1$s_i4 ON pgboss.%1$I (name, singleton_on, COALESCE(singleton_key, '''')) WHERE state <> ''cancelled'' AND singleton_on IS NOT NULL', table_name);
      EXECUTE format('CREATE INDEX %1$s_i5 ON pgboss.%1$I (name, start_after) INCLUDE (priority, created_on, id) WHERE state < ''active''', table_name);

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', table_name, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', table_name, queue_name);
    END;
    $_$;


--
-- Name: delete_queue(text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.delete_queue(queue_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      table_name varchar;
    BEGIN
      WITH deleted as (
        DELETE FROM pgboss.queue
        WHERE name = queue_name
        RETURNING partition_name
      )
      SELECT partition_name from deleted INTO table_name;

      EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', table_name);
    END;
    $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
begin
    raise debug 'PgBouncer auth request: %', p_usename;

    return query
    select 
        rolname::text, 
        case when rolvaliduntil < now() 
            then null 
            else rolpassword::text 
        end 
    from pg_authid 
    where rolname=$1 and rolcanlogin;
end;
$_$;


--
-- Name: mark_results_fresh_on_analysis(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_results_fresh_on_analysis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only mark as fresh if this appears to be a real analysis update
  -- (i.e., when statistical data is being updated, not just stale status)
  IF (TG_OP = 'INSERT') OR 
     (TG_OP = 'UPDATE' AND (
       OLD.mean IS DISTINCT FROM NEW.mean OR
       OLD.median IS DISTINCT FROM NEW.median OR
       OLD.conclusion IS DISTINCT FROM NEW.conclusion OR
       OLD.compare_config IS DISTINCT FROM NEW.compare_config
     )) THEN
    -- This is a real analysis update, mark as fresh
    NEW.is_stale = false;
    NEW.stale_reason = null;
    NEW.stale_at = null;
    
    -- Set the config_hash_used to current config hash
    IF NEW.compare_config ? 'config_hash' THEN
      NEW.config_hash_used = NEW.compare_config->>'config_hash';
    END IF;
  END IF;

  -- Keep the existing config_hash_used if not explicitly provided
  IF NEW.config_hash_used IS NULL AND OLD.config_hash_used IS NOT NULL THEN
    NEW.config_hash_used = OLD.config_hash_used;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: mark_results_stale_on_config_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_results_stale_on_config_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only proceed if config_data actually changed
    IF OLD.config_data IS NOT DISTINCT FROM NEW.config_data THEN
        RETURN NEW;
    END IF;

    -- Mark corresponding ds_adapt_results as stale
    UPDATE ds_adapt_results
    SET
        is_stale = true,
        stale_reason = 'Configuration updated',
        stale_at = NOW()
    WHERE
        EXISTS (
            SELECT 1 FROM test_runs tr
            WHERE tr.test_run_id = ds_adapt_results.test_run_id
            AND tr.system_under_test_id = NEW.system_under_test_id
            AND tr.test_environment = NEW.test_environment
            AND tr.workload = NEW.workload
        )
        AND application_dashboard_id = NEW.application_dashboard_id
        AND panel_id = NEW.panel_id
        AND (
            (NEW.metric_name IS NULL) OR
            (metric_name = NEW.metric_name)
        )
        AND (
            -- Mark as stale if config_hash_used is null (legacy results) or doesn't match new hash
            config_hash_used IS NULL OR
            config_hash_used != NEW.config_hash
        )
        AND is_stale = false; -- Only update if not already stale

    RETURN NEW;
END;
$$;


--
-- Name: migrate_benchmark_from_mongodb(character varying, character varying, character varying, character varying, character varying, integer, character varying, jsonb, character varying, character varying, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.migrate_benchmark_from_mongodb(p_application character varying, p_test_environment character varying, p_test_type character varying, p_grafana character varying, p_dashboard_label character varying, p_dashboard_id integer, p_dashboard_uid character varying, p_panel jsonb, p_generic_check_id character varying DEFAULT NULL::character varying, p_application_dashboard_id character varying DEFAULT NULL::character varying, p_valid boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_benchmark_id uuid;
    v_system_id uuid;
BEGIN
    -- Find matching system_under_test
    SELECT id INTO v_system_id
    FROM public.systems_under_test
    WHERE name = p_application
    LIMIT 1;
    
    IF v_system_id IS NULL THEN
        RAISE EXCEPTION 'System under test with name % not found', p_application;
    END IF;
    
    -- Insert the benchmark (Grafana source)
    INSERT INTO public.benchmarks_new (
        system_under_test_id,
        test_environment,
        test_type,
        source,
        grafana_instance,
        dashboard_label,
        dashboard_id,
        dashboard_uid,
        configuration,
        generic_check_id,
        valid,
        enabled
    ) VALUES (
        v_system_id,
        p_test_environment,
        p_test_type,
        'grafana',
        p_grafana,
        p_dashboard_label,
        p_dashboard_id,
        p_dashboard_uid,
        p_panel,
        p_generic_check_id,
        p_valid,
        true
    )
    RETURNING id INTO v_benchmark_id;
    
    RETURN v_benchmark_id;
END;
$$;


--
-- Name: update_deep_links_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_deep_links_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_generic_deep_links_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_generic_deep_links_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: validate_benchmark_configuration(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_benchmark_configuration() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Configuration must be a valid JSON object
    IF NEW.configuration IS NULL OR jsonb_typeof(NEW.configuration) != 'object' THEN
        RAISE EXCEPTION 'Configuration must be a valid JSON object';
    END IF;
    
    -- Source-specific validation
    IF NEW.source = 'grafana' THEN
        -- Grafana-specific validation
        IF NEW.configuration->>'dashboardUid' IS NULL THEN
            RAISE EXCEPTION 'Grafana configuration must have a dashboardUid';
        END IF;
        
        IF NEW.configuration->>'id' IS NULL THEN
            RAISE EXCEPTION 'Grafana configuration must have an id';
        END IF;
    ELSIF NEW.source = 'dynatrace' THEN
        -- Dynatrace-specific validation (no additional requirements)
    ELSIF NEW.source IN ('timescaledb', 'influxdb') THEN
        -- Time-series database validation
        IF NEW.configuration->>'query' IS NULL THEN
            RAISE EXCEPTION 'Time-series database configuration must have a query';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_;

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
    declare
      res jsonb;
    begin
      execute format('select to_jsonb(%L::'|| type_::text || ')', val)  into res;
      return res;
    end
    $$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS SETOF realtime.wal_rls
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
      with pub as (
        select
          concat_ws(
            ',',
            case when bool_or(pubinsert) then 'insert' else null end,
            case when bool_or(pubupdate) then 'update' else null end,
            case when bool_or(pubdelete) then 'delete' else null end
          ) as w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
            ''
          ) w2j_add_tables
        from
          pg_publication pp
          left join pg_publication_tables ppt
            on pp.pubname = ppt.pubname
        where
          pp.pubname = publication
        group by
          pp.pubname
        limit 1
      ),
      w2j as (
        select
          x.*, pub.w2j_add_tables
        from
          pub,
          pg_logical_slot_get_changes(
            slot_name, null, max_changes,
            'include-pk', 'true',
            'include-transaction', 'false',
            'include-timestamp', 'true',
            'include-type-oids', 'true',
            'format-version', '2',
            'actions', pub.w2j_actions,
            'add-tables', pub.w2j_add_tables
          ) x
      )
      select
        xyz.wal,
        xyz.is_rls_enabled,
        xyz.subscription_ids,
        xyz.errors
      from
        w2j,
        realtime.apply_rls(
          wal := w2j.data::jsonb,
          max_record_bytes := max_record_bytes
        ) xyz(wal, is_rls_enabled, subscription_ids, errors)
      where
        w2j.w2j_add_tables <> ''
        and xyz.subscription_ids[1] is not null
    $$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  BEGIN
    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (payload, event, topic, private, extension)
    VALUES (payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: add_prefixes(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.add_prefixes(_bucket_id text, _name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    prefixes text[];
BEGIN
    prefixes := "storage"."get_prefixes"("_name");

    IF array_length(prefixes, 1) > 0 THEN
        INSERT INTO storage.prefixes (name, bucket_id)
        SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
    END IF;
END;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: delete_prefix(text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix(_bucket_id text, _name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Check if we can delete the prefix
    IF EXISTS(
        SELECT FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name") + 1
          AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    )
    OR EXISTS(
        SELECT FROM "storage"."objects"
        WHERE "objects"."bucket_id" = "_bucket_id"
          AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
          AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
        LIMIT 1
    ) THEN
    -- There are sub-objects, skip deletion
    RETURN false;
    ELSE
        DELETE FROM "storage"."prefixes"
        WHERE "prefixes"."bucket_id" = "_bucket_id"
          AND level = "storage"."get_level"("_name")
          AND "prefixes"."name" = "_name";
        RETURN true;
    END IF;
END;
$$;


--
-- Name: delete_prefix_hierarchy_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_prefix_hierarchy_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    prefix text;
BEGIN
    prefix := "storage"."get_prefix"(OLD."name");

    IF coalesce(prefix, '') != '' THEN
        PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
    END IF;

    RETURN OLD;
END;
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


--
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


--
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(name COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                        substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
                    ELSE
                        name
                END AS name, id, metadata, updated_at
            FROM
                storage.objects
            WHERE
                bucket_id = $5 AND
                name ILIKE $1 || ''%'' AND
                CASE
                    WHEN $6 != '''' THEN
                    name COLLATE "C" > $6
                ELSE true END
                AND CASE
                    WHEN $4 != '''' THEN
                        CASE
                            WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                                substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                name COLLATE "C" > $4
                            END
                    ELSE
                        true
                END
            ORDER BY
                name COLLATE "C" ASC) as e order by name COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
END;
$_$;


--
-- Name: objects_insert_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_insert_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    NEW.level := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- Name: objects_update_prefix_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.objects_update_prefix_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    old_prefixes TEXT[];
BEGIN
    -- Ensure this is an update operation and the name has changed
    IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
        -- Retrieve old prefixes
        old_prefixes := "storage"."get_prefixes"(OLD."name");

        -- Remove old prefixes that are only used by this object
        WITH all_prefixes as (
            SELECT unnest(old_prefixes) as prefix
        ),
        can_delete_prefixes as (
             SELECT prefix
             FROM all_prefixes
             WHERE NOT EXISTS (
                 SELECT 1 FROM "storage"."objects"
                 WHERE "bucket_id" = OLD."bucket_id"
                   AND "name" <> OLD."name"
                   AND "name" LIKE (prefix || '%')
             )
         )
        DELETE FROM "storage"."prefixes" WHERE name IN (SELECT prefix FROM can_delete_prefixes);

        -- Add new prefixes
        PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    END IF;
    -- Set the new level
    NEW."level" := "storage"."get_level"(NEW."name");

    RETURN NEW;
END;
$$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: prefixes_insert_trigger(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.prefixes_insert_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
    RETURN NEW;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql
    AS $$
declare
    can_bypass_rls BOOLEAN;
begin
    SELECT rolbypassrls
    INTO can_bypass_rls
    FROM pg_roles
    WHERE rolname = coalesce(nullif(current_setting('role', true), 'none'), current_user);

    IF can_bypass_rls THEN
        RETURN QUERY SELECT * FROM storage.search_v1_optimised(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    ELSE
        RETURN QUERY SELECT * FROM storage.search_legacy_v1(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
    END IF;
end;
$$;


--
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- Name: search_v1_optimised(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v1_optimised(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select (string_to_array(name, ''/''))[level] as name
           from storage.prefixes
             where lower(prefixes.name) like lower($2 || $3) || ''%''
               and bucket_id = $4
               and level = $1
           order by name ' || v_sort_order || '
     )
     (select name,
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[level] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where lower(objects.name) like lower($2 || $3) || ''%''
       and bucket_id = $4
       and level = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
BEGIN
    RETURN query EXECUTE
        $sql$
        SELECT * FROM (
            (
                SELECT
                    split_part(name, '/', $4) AS key,
                    name || '/' AS name,
                    NULL::uuid AS id,
                    NULL::timestamptz AS updated_at,
                    NULL::timestamptz AS created_at,
                    NULL::jsonb AS metadata
                FROM storage.prefixes
                WHERE name COLLATE "C" LIKE $1 || '%'
                AND bucket_id = $2
                AND level = $4
                AND name COLLATE "C" > $5
                ORDER BY prefixes.name COLLATE "C" LIMIT $3
            )
            UNION ALL
            (SELECT split_part(name, '/', $4) AS key,
                name,
                id,
                updated_at,
                created_at,
                metadata
            FROM storage.objects
            WHERE name COLLATE "C" LIKE $1 || '%'
                AND bucket_id = $2
                AND level = $4
                AND name COLLATE "C" > $5
            ORDER BY name COLLATE "C" LIMIT $3)
        ) obj
        ORDER BY name COLLATE "C" LIMIT $3;
        $sql$
        USING prefix, bucket_name, limits, levels, start_after;
END;
$_$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: http_request(); Type: FUNCTION; Schema: supabase_functions; Owner: -
--

CREATE FUNCTION supabase_functions.http_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'supabase_functions'
    AS $$
  DECLARE
    request_id bigint;
    payload jsonb;
    url text := TG_ARGV[0]::text;
    method text := TG_ARGV[1]::text;
    headers jsonb DEFAULT '{}'::jsonb;
    params jsonb DEFAULT '{}'::jsonb;
    timeout_ms integer DEFAULT 1000;
  BEGIN
    IF url IS NULL OR url = 'null' THEN
      RAISE EXCEPTION 'url argument is missing';
    END IF;

    IF method IS NULL OR method = 'null' THEN
      RAISE EXCEPTION 'method argument is missing';
    END IF;

    IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
      headers = '{"Content-Type": "application/json"}'::jsonb;
    ELSE
      headers = TG_ARGV[2]::jsonb;
    END IF;

    IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
      params = '{}'::jsonb;
    ELSE
      params = TG_ARGV[3]::jsonb;
    END IF;

    IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
      timeout_ms = 1000;
    ELSE
      timeout_ms = TG_ARGV[4]::integer;
    END IF;

    CASE
      WHEN method = 'GET' THEN
        SELECT http_get INTO request_id FROM net.http_get(
          url,
          params,
          headers,
          timeout_ms
        );
      WHEN method = 'POST' THEN
        payload = jsonb_build_object(
          'old_record', OLD,
          'record', NEW,
          'type', TG_OP,
          'table', TG_TABLE_NAME,
          'schema', TG_TABLE_SCHEMA
        );

        SELECT http_post INTO request_id FROM net.http_post(
          url,
          payload,
          params,
          headers,
          timeout_ms
        );
      ELSE
        RAISE EXCEPTION 'method argument % is invalid', method;
    END CASE;

    INSERT INTO supabase_functions.hooks
      (hook_table_id, hook_name, request_id)
    VALUES
      (TG_RELID, TG_NAME, request_id);

    RETURN NEW;
  END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: extensions; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.extensions (
    id uuid NOT NULL,
    type text,
    settings jsonb,
    tenant_external_id text,
    inserted_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: tenants; Type: TABLE; Schema: _realtime; Owner: -
--

CREATE TABLE _realtime.tenants (
    id uuid NOT NULL,
    name text,
    external_id text,
    jwt_secret text,
    max_concurrent_users integer DEFAULT 200 NOT NULL,
    inserted_at timestamp(0) without time zone NOT NULL,
    updated_at timestamp(0) without time zone NOT NULL,
    max_events_per_second integer DEFAULT 100 NOT NULL,
    postgres_cdc_default text DEFAULT 'postgres_cdc_rls'::text,
    max_bytes_per_second integer DEFAULT 100000 NOT NULL,
    max_channels_per_client integer DEFAULT 100 NOT NULL,
    max_joins_per_second integer DEFAULT 500 NOT NULL,
    suspend boolean DEFAULT false,
    jwt_jwks jsonb,
    notify_private_alpha boolean DEFAULT false,
    private_only boolean DEFAULT false NOT NULL,
    migrations_ran integer DEFAULT 0,
    broadcast_adapter character varying(255) DEFAULT 'gen_rpc'::character varying,
    max_presence_events_per_second integer DEFAULT 10000,
    max_payload_size_in_kb integer DEFAULT 3000
);


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text NOT NULL,
    code_challenge_method auth.code_challenge_method NOT NULL,
    code_challenge text NOT NULL,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'stores metadata for pkce logins';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: archive; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.archive (
    id uuid NOT NULL,
    name text NOT NULL,
    priority integer NOT NULL,
    data jsonb,
    state pgboss.job_state NOT NULL,
    retry_limit integer NOT NULL,
    retry_count integer NOT NULL,
    retry_delay integer NOT NULL,
    retry_backoff boolean NOT NULL,
    start_after timestamp with time zone NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval NOT NULL,
    created_on timestamp with time zone NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    archived_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text
)
PARTITION BY LIST (name);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    singleton_key text,
    singleton_on timestamp without time zone,
    expire_in interval DEFAULT '00:15:00'::interval NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    CONSTRAINT cjc CHECK ((name = '__pgboss__send-it'::text))
);


--
-- Name: queue; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text,
    retry_limit integer,
    retry_delay integer,
    retry_backoff boolean,
    expire_seconds integer,
    retention_minutes integer,
    dead_letter text,
    partition_name text,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedule; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    cron text NOT NULL,
    timezone text,
    data jsonb,
    options jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.version (
    version integer NOT NULL,
    maintained_on timestamp with time zone,
    cron_on timestamp with time zone,
    monitored_on timestamp with time zone
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_key character varying(255) NOT NULL,
    description character varying(255) NOT NULL,
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_used timestamp with time zone
);


--
-- Name: application_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_dashboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    grafana_instance_id uuid NOT NULL,
    grafana_dashboard_id uuid NOT NULL,
    dashboard_name character varying(255) NOT NULL,
    dashboard_id integer,
    dashboard_uid character varying(100),
    dashboard_label character varying(255) NOT NULL,
    tags text[],
    template_dashboard_uid character varying(100),
    variables jsonb,
    replaced_templating_variables jsonb,
    snapshot_timeout integer DEFAULT 4,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE application_dashboards; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.application_dashboards IS 'Application-specific dashboard configurations linking systems under test with Grafana dashboards';


--
-- Name: COLUMN application_dashboards.dashboard_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.application_dashboards.dashboard_label IS 'Human-readable label for the dashboard configuration';


--
-- Name: COLUMN application_dashboards.variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.application_dashboards.variables IS 'Dashboard variable values for this application';


--
-- Name: COLUMN application_dashboards.snapshot_timeout; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.application_dashboards.snapshot_timeout IS 'Timeout in seconds for taking dashboard snapshots';


--
-- Name: profile_grafana_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_grafana_dashboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile character varying(255) NOT NULL,
    dashboard_name character varying(255) NOT NULL,
    dashboard_uid character varying(100) NOT NULL,
    grafana_label character varying(255) DEFAULT 'Default'::character varying NOT NULL,
    create_separate_dashboard_for_variable character varying(255),
    set_hardcoded_value_for_variables jsonb,
    match_regex_for_variables jsonb,
    read_only boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE profile_grafana_dashboards; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profile_grafana_dashboards IS 'Auto-configuration for Grafana dashboards per system/environment/workload combination';


--
-- Name: COLUMN profile_grafana_dashboards.profile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile_grafana_dashboards.profile IS 'Profile identifier (gatling, jmeter, k6, spring-boot-kubernetes, etc.)';


--
-- Name: COLUMN profile_grafana_dashboards.grafana_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile_grafana_dashboards.grafana_label IS 'Reference to grafana instance by label (not foreign key)';


--
-- Name: COLUMN profile_grafana_dashboards.create_separate_dashboard_for_variable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profile_grafana_dashboards.create_separate_dashboard_for_variable IS 'Variable name for which separate dashboards should be created';


--
-- Name: benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benchmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    source character varying(50) DEFAULT 'grafana'::character varying NOT NULL,
    grafana_instance character varying(255),
    dashboard_label character varying(500),
    dashboard_id integer,
    dashboard_uid character varying(255),
    application_dashboard_id uuid,
    generic_check_id character varying(500),
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_title character varying(500) GENERATED ALWAYS AS ((configuration ->> 'title'::text)) STORED,
    config_id character varying(100) GENERATED ALWAYS AS ((configuration ->> 'id'::text)) STORED,
    config_type character varying(100) GENERATED ALWAYS AS ((configuration ->> 'type'::text)) STORED,
    evaluate_type character varying(100) GENERATED ALWAYS AS ((configuration ->> 'evaluateType'::text)) STORED,
    requirement_operator character varying(10) GENERATED ALWAYS AS (((configuration -> 'requirement'::text) ->> 'operator'::text)) STORED,
    requirement_value numeric GENERATED ALWAYS AS ((((configuration -> 'requirement'::text) ->> 'value'::text))::numeric) STORED,
    enabled boolean DEFAULT true,
    valid boolean DEFAULT true,
    description text,
    tags text[] DEFAULT '{}'::text[],
    average_all boolean DEFAULT false,
    match_pattern text,
    validate_with_default_if_no_data boolean DEFAULT false,
    validate_with_default_if_no_data_value numeric,
    exclude_ramp_up_time boolean DEFAULT true,
    panel_title character varying(255),
    metric_unit character varying(50),
    baseline_test_run_id character varying(255),
    alert_on_breach boolean DEFAULT false,
    alert_channels text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid,
    updated_by uuid,
    CONSTRAINT benchmarks_source_check CHECK (((source)::text = ANY (ARRAY[('grafana'::character varying)::text, ('dynatrace'::character varying)::text, ('timescaledb'::character varying)::text, ('influxdb'::character varying)::text, ('prometheus'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: TABLE benchmarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.benchmarks IS 'Multi-source performance benchmarks supporting Grafana, Dynatrace, TimescaleDB and other monitoring sources';


--
-- Name: COLUMN benchmarks.system_under_test_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.system_under_test_id IS 'Foreign key to systems_under_test table, identifies which system this benchmark applies to';


--
-- Name: COLUMN benchmarks.workload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.workload IS 'Workload type for the benchmark (previously test_type), equivalent to workload in the modern schema';


--
-- Name: COLUMN benchmarks.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.source IS 'Source system for the benchmark (grafana, dynatrace, timescaledb, influxdb, prometheus, custom)';


--
-- Name: COLUMN benchmarks.grafana_instance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.grafana_instance IS 'Grafana instance label, only applicable when source=grafana';


--
-- Name: COLUMN benchmarks.dashboard_uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.dashboard_uid IS 'Grafana dashboard UID, only applicable when source=grafana';


--
-- Name: COLUMN benchmarks.configuration; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.configuration IS 'JSONB structure containing source-specific configuration (panel config for Grafana, metric queries for others)';


--
-- Name: COLUMN benchmarks.config_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.config_title IS 'Generated column extracting title from configuration for easier querying (source-agnostic)';


--
-- Name: COLUMN benchmarks.config_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.config_id IS 'Generated column extracting id from configuration (panel ID for Grafana, custom ID for others)';


--
-- Name: COLUMN benchmarks.evaluate_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.evaluate_type IS 'Generated column extracting evaluation type (max, min, avg, etc.) for easier querying';


--
-- Name: COLUMN benchmarks.requirement_operator; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.requirement_operator IS 'Generated column extracting requirement operator for easier querying';


--
-- Name: COLUMN benchmarks.requirement_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.requirement_value IS 'Generated column extracting requirement value for easier querying';


--
-- Name: COLUMN benchmarks.average_all; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.average_all IS 'Average all metric series when comparing test runs (from MongoDB legacy)';


--
-- Name: COLUMN benchmarks.match_pattern; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.match_pattern IS 'Only apply to series matching this regex pattern (from MongoDB legacy)';


--
-- Name: COLUMN benchmarks.validate_with_default_if_no_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.validate_with_default_if_no_data IS 'Evaluate default value if no data available (from MongoDB legacy)';


--
-- Name: COLUMN benchmarks.validate_with_default_if_no_data_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.validate_with_default_if_no_data_value IS 'Default value to use when no data is available (from MongoDB legacy)';


--
-- Name: COLUMN benchmarks.exclude_ramp_up_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.benchmarks.exclude_ramp_up_time IS 'Exclude ramp up time when evaluating test run (from MongoDB legacy)';


--
-- Name: grafana_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grafana_dashboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grafana_instance_id uuid NOT NULL,
    grafana_id integer NOT NULL,
    datasource_type character varying(100),
    uid character varying(100) NOT NULL,
    slug character varying(255),
    name character varying(255) NOT NULL,
    uri text,
    templating_variables jsonb,
    panels jsonb NOT NULL,
    variables jsonb,
    tags text[],
    used_by_sut text[],
    template_dashboard_uid character varying(100),
    template_profile character varying(255),
    template_test_run_variables jsonb,
    template_create_date timestamp with time zone,
    application_dashboard_variables jsonb,
    grafana_json jsonb,
    updated timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE grafana_dashboards; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grafana_dashboards IS 'Grafana dashboard metadata with panels and templating information';


--
-- Name: COLUMN grafana_dashboards.grafana_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_dashboards.grafana_id IS 'Internal Grafana dashboard ID';


--
-- Name: COLUMN grafana_dashboards.uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_dashboards.uid IS 'Grafana dashboard UID (unique identifier)';


--
-- Name: COLUMN grafana_dashboards.templating_variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_dashboards.templating_variables IS 'Dashboard templating variables configuration';


--
-- Name: COLUMN grafana_dashboards.panels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_dashboards.panels IS 'JSON configuration of dashboard panels';


--
-- Name: COLUMN grafana_dashboards.used_by_sut; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_dashboards.used_by_sut IS 'List of systems under test that use this dashboard';


--
-- Name: grafana_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grafana_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(255) NOT NULL,
    client_url text NOT NULL,
    server_url text,
    org_id character varying(50) NOT NULL,
    api_key text,
    username character varying(255),
    password text,
    snapshot_instance boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE grafana_instances; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grafana_instances IS 'Grafana instance configurations with connection details and settings';


--
-- Name: COLUMN grafana_instances.label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_instances.label IS 'Unique identifier/name for the Grafana instance';


--
-- Name: COLUMN grafana_instances.client_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_instances.client_url IS 'URL used by browser clients to access Grafana';


--
-- Name: COLUMN grafana_instances.server_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_instances.server_url IS 'URL used by server-side components to access Grafana';


--
-- Name: COLUMN grafana_instances.snapshot_instance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.grafana_instances.snapshot_instance IS 'Whether this instance is used for storing snapshots';


--
-- Name: systems_under_test; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.systems_under_test (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    tracing_service character varying(255),
    pyroscope_application character varying(255),
    pyroscope_profiler character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: benchmarks_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.benchmarks_view AS
 SELECT b.id,
    b.system_under_test_id,
    b.test_environment,
    b.workload AS test_type,
    b.source,
    b.grafana_instance,
    b.dashboard_label,
    b.dashboard_id,
    b.dashboard_uid,
    b.application_dashboard_id,
    b.generic_check_id,
    b.configuration,
    b.config_title,
    b.config_id,
    b.config_type,
    b.evaluate_type,
    b.requirement_operator,
    b.requirement_value,
    b.enabled,
    b.valid,
    b.description,
    b.tags,
    b.average_all,
    b.match_pattern,
    b.validate_with_default_if_no_data,
    b.validate_with_default_if_no_data_value,
    b.exclude_ramp_up_time,
    b.panel_title AS metric_name,
    b.metric_unit,
    b.baseline_test_run_id,
    b.alert_on_breach,
    b.alert_channels,
    b.metadata,
    b.created_at,
    b.updated_at,
    b.created_by,
    b.updated_by,
    sut.name AS system_name,
    sut.description AS system_description,
    gi.label AS grafana_instance_label,
    gi.client_url AS grafana_url,
    gd.name AS grafana_dashboard_name,
    gd.tags AS dashboard_tags,
        CASE
            WHEN (((b.requirement_operator)::text = 'lt'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must be less than '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            WHEN (((b.requirement_operator)::text = 'gt'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must be greater than '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            WHEN (((b.requirement_operator)::text = 'lte'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must be less than or equal to '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            WHEN (((b.requirement_operator)::text = 'gte'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must be greater than or equal to '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            WHEN (((b.requirement_operator)::text = 'eq'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must equal '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            WHEN (((b.requirement_operator)::text = 'ne'::text) AND (b.requirement_value IS NOT NULL)) THEN ((('Value must not equal '::text || b.requirement_value) || ' '::text) || (COALESCE(b.metric_unit, ''::character varying))::text)
            ELSE 'No requirement defined'::text
        END AS requirement_description
   FROM (((public.benchmarks b
     LEFT JOIN public.systems_under_test sut ON ((b.system_under_test_id = sut.id)))
     LEFT JOIN public.grafana_instances gi ON (((b.grafana_instance)::text = (gi.label)::text)))
     LEFT JOIN public.grafana_dashboards gd ON ((((b.dashboard_uid)::text = (gd.uid)::text) AND (gd.grafana_instance_id = gi.id))));


--
-- Name: check_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    test_run_id character varying(255) NOT NULL,
    source character varying(50) DEFAULT 'grafana'::character varying NOT NULL,
    grafana_instance character varying(255),
    dashboard_label character varying(500),
    dashboard_uid character varying(255),
    panel_title character varying(500),
    panel_id integer,
    panel_type character varying(100),
    panel_description text,
    panel_y_axes_format character varying(100),
    dynatrace_entity_id character varying(255),
    dynatrace_metric_key character varying(255),
    dynatrace_dimension_filters jsonb DEFAULT '{}'::jsonb,
    metric_name character varying(255),
    metric_unit character varying(50),
    generic_check_id character varying(500),
    benchmark_id character varying(255) NOT NULL,
    status character varying(50) NOT NULL,
    message text,
    average_all boolean DEFAULT false NOT NULL,
    evaluate_type character varying(100) NOT NULL,
    exclude_ramp_up_time boolean DEFAULT true NOT NULL,
    ramp_up integer,
    match_pattern text,
    requirement jsonb DEFAULT '{}'::jsonb,
    benchmark jsonb DEFAULT '{}'::jsonb,
    panel_average numeric,
    meets_requirement boolean,
    is_artificial boolean DEFAULT false,
    targets jsonb DEFAULT '[]'::jsonb,
    validate_with_default_if_no_data boolean DEFAULT false,
    validate_with_default_if_no_data_value numeric,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by uuid,
    updated_by uuid,
    tags text[],
    application_dashboard_id uuid,
    CONSTRAINT check_results_source_check CHECK (((source)::text = ANY (ARRAY[('grafana'::character varying)::text, ('dynatrace'::character varying)::text, ('timescaledb'::character varying)::text, ('influxdb'::character varying)::text, ('prometheus'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: TABLE check_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.check_results IS 'Performance check results from various monitoring sources (Grafana, Dynatrace, etc.) - Real-time enabled for live updates';


--
-- Name: COLUMN check_results.system_under_test_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.system_under_test_id IS 'Foreign key to systems_under_test table';


--
-- Name: COLUMN check_results.workload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.workload IS 'Workload/test type identifier';


--
-- Name: COLUMN check_results.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.source IS 'Monitoring source: grafana, dynatrace, timescaledb, influxdb, prometheus, custom';


--
-- Name: COLUMN check_results.dynatrace_dimension_filters; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.dynatrace_dimension_filters IS 'Dynatrace-specific dimension filters for metric queries';


--
-- Name: COLUMN check_results.requirement; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.requirement IS 'JSON object with operator and value fields for requirements';


--
-- Name: COLUMN check_results.benchmark; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.benchmark IS 'JSON object with operator, value, and absoluteFailureThreshold fields';


--
-- Name: COLUMN check_results.targets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.targets IS 'Array of target objects with value, target, and meets_requirement fields';


--
-- Name: COLUMN check_results.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.check_results.metadata IS 'Additional metadata for extensibility and source-specific data';


--
-- Name: compare_filter_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compare_filter_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    preset_type character varying(20) DEFAULT 'generic'::character varying NOT NULL,
    series_search_text character varying(255),
    show_percentiles boolean DEFAULT false,
    panel_id integer,
    panel_title character varying(255),
    baseline_test_run_id character varying(255),
    is_global boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    application_dashboard_id uuid,
    created_for_test_run_id character varying(255)
);


--
-- Name: COLUMN compare_filter_presets.baseline_test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compare_filter_presets.baseline_test_run_id IS 'Baseline test run used for comparison - part of the comparison configuration';


--
-- Name: COLUMN compare_filter_presets.application_dashboard_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compare_filter_presets.application_dashboard_id IS 'References application_dashboards table for application-specific dashboard configuration';


--
-- Name: COLUMN compare_filter_presets.created_for_test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compare_filter_presets.created_for_test_run_id IS 'Test run where this preset was created - used for filtering specific presets';


--
-- Name: compare_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compare_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid,
    test_environment character varying NOT NULL,
    workload character varying NOT NULL,
    test_run_id character varying NOT NULL,
    baseline_test_run_id character varying,
    grafana character varying,
    dashboard_label character varying,
    dashboard_uid character varying,
    panel_title character varying,
    panel_id integer,
    panel_type character varying,
    panel_description text,
    panel_y_axes_format character varying,
    status character varying NOT NULL,
    message text,
    detailed_message text,
    label character varying,
    exclude_ramp_up_time boolean DEFAULT true,
    ramp_up integer,
    average_all boolean DEFAULT false,
    evaluate_type character varying,
    match_pattern character varying,
    title_replacer character varying,
    benchmark jsonb,
    panel_average numeric,
    benchmark_baseline_test_run_panel_average numeric,
    benchmark_baseline_test_run_panel_average_delta numeric,
    benchmark_baseline_test_run_panel_average_delta_pct numeric,
    benchmark_baseline_test_run_ok boolean,
    targets jsonb DEFAULT '[]'::jsonb,
    validate_with_default_if_no_data boolean DEFAULT false,
    validate_with_default_if_no_data_value numeric DEFAULT 0,
    perfana_info character varying,
    ad_hoc character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE compare_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.compare_results IS 'Performance test comparison results from MongoDB compareResults collection';


--
-- Name: COLUMN compare_results.system_under_test_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compare_results.system_under_test_id IS 'Maps from application field in MongoDB';


--
-- Name: COLUMN compare_results.workload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.compare_results.workload IS 'Maps from testType field in MongoDB';


--
-- Name: configuration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuration (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    value text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: data_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    source_type character varying(100) NOT NULL,
    instance_name character varying(255) NOT NULL,
    connection_config jsonb NOT NULL,
    supports_real_time boolean DEFAULT false,
    supports_historical boolean DEFAULT true,
    query_rate_limit integer,
    is_active boolean DEFAULT true,
    last_health_check timestamp with time zone,
    health_status character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: deep_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deep_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    url text NOT NULL,
    template_deep_link_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ds_adapt_conclusion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_adapt_conclusion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id character varying(255) NOT NULL,
    control_group_id character varying(255),
    regressions uuid[],
    improvements uuid[],
    differences uuid[],
    tracked_regressions uuid[] DEFAULT '{}'::uuid[],
    conclusion character varying(50) NOT NULL,
    details jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ds_adapt_conclusion_conclusion_check CHECK (((conclusion)::text = ANY (ARRAY[('REGRESSION'::character varying)::text, ('PASSED'::character varying)::text, ('SKIPPED'::character varying)::text, ('ERROR'::character varying)::text, ('UNRELIABLE'::character varying)::text])))
);


--
-- Name: TABLE ds_adapt_conclusion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_adapt_conclusion IS 'Adapt conclusions and summaries per test run. Migrated from MongoDB dsAdaptConclusion collection.';


--
-- Name: COLUMN ds_adapt_conclusion.test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.test_run_id IS 'Unique ID of the test run - one conclusion per test run';


--
-- Name: COLUMN ds_adapt_conclusion.control_group_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.control_group_id IS 'ID of the control group used for comparison, can be NULL for certain conclusion types';


--
-- Name: COLUMN ds_adapt_conclusion.regressions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.regressions IS 'Array of ds_adapt_results.id that represent regressions';


--
-- Name: COLUMN ds_adapt_conclusion.improvements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.improvements IS 'Array of ds_adapt_results.id that represent improvements';


--
-- Name: COLUMN ds_adapt_conclusion.differences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.differences IS 'Array of ds_adapt_results.id that represent other significant differences';


--
-- Name: COLUMN ds_adapt_conclusion.tracked_regressions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.tracked_regressions IS 'Array of ds_adapt_tracked_results.id for trend analysis';


--
-- Name: COLUMN ds_adapt_conclusion.conclusion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.conclusion IS 'Overall conclusion: REGRESSION, PASSED, SKIPPED, ERROR, or UNRELIABLE';


--
-- Name: COLUMN ds_adapt_conclusion.details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_conclusion.details IS 'Additional details including message and metadata';


--
-- Name: ds_adapt_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_adapt_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id character varying(255) NOT NULL,
    control_group_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    metric_name character varying(500) NOT NULL,
    dashboard_uid character varying(255) NOT NULL,
    dashboard_label character varying(500) NOT NULL,
    panel_title character varying(500) NOT NULL,
    unit character varying(100),
    test_run_start timestamp with time zone NOT NULL,
    benchmark_ids text[],
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    mean jsonb,
    min jsonb,
    max jsonb,
    std jsonb,
    median jsonb,
    q10 jsonb,
    q25 jsonb,
    q75 jsonb,
    q90 jsonb,
    q95 jsonb,
    q99 jsonb,
    last_value jsonb,
    n jsonb,
    n_missing jsonb,
    n_non_zero jsonb,
    iqr jsonb,
    idr jsonb,
    is_constant jsonb,
    all_missing jsonb,
    exists_data jsonb,
    pct_missing jsonb,
    compare_config jsonb NOT NULL,
    metric_classification jsonb,
    statistic jsonb NOT NULL,
    conditions jsonb NOT NULL,
    thresholds jsonb NOT NULL,
    checks jsonb NOT NULL,
    conclusion jsonb NOT NULL,
    uses_default_value boolean DEFAULT false,
    default_value numeric,
    config_hash_used character varying(32),
    is_stale boolean DEFAULT false,
    stale_reason character varying(255),
    stale_at timestamp with time zone
);


--
-- Name: TABLE ds_adapt_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_adapt_results IS 'Final adapt analysis results comparing test vs control group metrics. Migrated from MongoDB dsAdaptResults collection.';


--
-- Name: COLUMN ds_adapt_results.test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.test_run_id IS 'ID of the test run being analyzed';


--
-- Name: COLUMN ds_adapt_results.control_group_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.control_group_id IS 'ID of the control group used for comparison';


--
-- Name: COLUMN ds_adapt_results.compare_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.compare_config IS 'Complete compare configuration with thresholds and source tracking';


--
-- Name: COLUMN ds_adapt_results.statistic; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.statistic IS 'Primary statistic used for the comparison (median, mean, etc.)';


--
-- Name: COLUMN ds_adapt_results.conclusion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.conclusion IS 'Final analysis conclusion with label (no difference, increase, decrease, regression, improvement, etc.)';


--
-- Name: COLUMN ds_adapt_results.config_hash_used; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.config_hash_used IS 'Hash of the configuration used when this result was calculated';


--
-- Name: COLUMN ds_adapt_results.is_stale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.is_stale IS 'Indicates if this result is outdated due to configuration changes';


--
-- Name: COLUMN ds_adapt_results.stale_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.stale_reason IS 'Reason why the result was marked as stale';


--
-- Name: COLUMN ds_adapt_results.stale_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_results.stale_at IS 'Timestamp when the result was marked as stale';


--
-- Name: ds_adapt_tracked_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_adapt_tracked_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id character varying NOT NULL,
    control_group_id character varying NOT NULL,
    tracked_test_run_id character varying NOT NULL,
    tracked_difference_id character varying,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    metric_name character varying NOT NULL,
    dashboard_uid character varying,
    dashboard_label character varying,
    panel_title character varying,
    unit character varying,
    benchmark_ids text[],
    test_run_start timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mean jsonb,
    median jsonb,
    min_value jsonb,
    max_value jsonb,
    std_dev jsonb,
    q10 jsonb,
    q25 jsonb,
    q75 jsonb,
    q90 jsonb,
    q95 jsonb,
    q99 jsonb,
    iqr jsonb,
    idr jsonb,
    count jsonb,
    n_missing jsonb,
    n_non_zero jsonb,
    pct_missing jsonb,
    is_constant jsonb,
    all_missing jsonb,
    last_value jsonb,
    exists_flags jsonb,
    uses_default_value boolean DEFAULT false,
    default_value numeric,
    compare_config jsonb,
    metric_classification jsonb,
    statistic jsonb,
    conditions jsonb,
    thresholds jsonb,
    checks jsonb,
    conclusion jsonb,
    tracked_conclusion jsonb
);


--
-- Name: TABLE ds_adapt_tracked_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_adapt_tracked_results IS 'Tracks adapt results over time for trend analysis and historical comparison. Migrated from MongoDB dsAdaptTrackedResults collection.';


--
-- Name: COLUMN ds_adapt_tracked_results.test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.test_run_id IS 'Current test run being analyzed (UUID reference to test_runs table)';


--
-- Name: COLUMN ds_adapt_tracked_results.tracked_test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.tracked_test_run_id IS 'The historical test run being tracked/compared against';


--
-- Name: COLUMN ds_adapt_tracked_results.application_dashboard_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.application_dashboard_id IS 'Dashboard being analyzed (UUID reference to application_dashboards table)';


--
-- Name: COLUMN ds_adapt_tracked_results.mean; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.mean IS 'Mean statistics as JSONB: {test, control, diff, pctDiff, absDiff, iqrDiff}';


--
-- Name: COLUMN ds_adapt_tracked_results.count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.count IS 'Count statistics as JSONB: {test, control, diff, pctDiff, absDiff}';


--
-- Name: COLUMN ds_adapt_tracked_results.is_constant; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.is_constant IS 'Constant flags as JSONB: {test, control}';


--
-- Name: COLUMN ds_adapt_tracked_results.compare_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.compare_config IS 'Embedded compare configuration for performance';


--
-- Name: COLUMN ds_adapt_tracked_results.metric_classification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.metric_classification IS 'Metric classification with higherIsBetter flag for proper conclusion labeling';


--
-- Name: COLUMN ds_adapt_tracked_results.conclusion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.conclusion IS 'Final analysis conclusion with proper regression/improvement labels';


--
-- Name: COLUMN ds_adapt_tracked_results.tracked_conclusion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_adapt_tracked_results.tracked_conclusion IS 'Conclusion from previous tracked analysis for comparison';


--
-- Name: ds_change_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_change_points (
    id integer NOT NULL,
    system_under_test_id character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    test_environment character varying(255) NOT NULL,
    test_run_id character varying(255) NOT NULL,
    application_dashboard_id uuid,
    panel_title character varying(500),
    dashboard_label character varying(255),
    dashboard_uid character varying(255),
    panel_id integer,
    metric_name character varying(255),
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ds_change_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ds_change_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ds_change_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ds_change_points_id_seq OWNED BY public.ds_change_points.id;


--
-- Name: ds_compare_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_compare_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    config_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metric_name character varying(255),
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    config_hash character varying(32),
    last_modified_at timestamp with time zone DEFAULT now()
);


--
-- Name: COLUMN ds_compare_config.config_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_compare_config.config_hash IS 'MD5 hash of the config_data for change detection';


--
-- Name: COLUMN ds_compare_config.last_modified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_compare_config.last_modified_at IS 'Last modification timestamp of the configuration';


--
-- Name: ds_control_group_statistics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_control_group_statistics (
    id integer NOT NULL,
    control_group_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    metric_name character varying(255),
    mean double precision,
    median double precision,
    min_value double precision,
    max_value double precision,
    std_dev double precision,
    last_value double precision,
    count integer NOT NULL,
    n_missing integer DEFAULT 0 NOT NULL,
    n_non_zero integer DEFAULT 0 NOT NULL,
    q10 double precision,
    q25 double precision,
    q75 double precision,
    q90 double precision,
    q95 double precision,
    q99 double precision,
    is_constant boolean DEFAULT false NOT NULL,
    all_missing boolean DEFAULT false NOT NULL,
    pct_missing double precision,
    iqr double precision,
    idr double precision,
    unit character varying(50),
    timestep double precision,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    test_run_id character varying(255),
    dashboard_uid character varying(255),
    dashboard_label character varying(500),
    panel_title character varying(500),
    benchmark_ids character varying(255)[]
);


--
-- Name: TABLE ds_control_group_statistics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_control_group_statistics IS 'Control group statistics with field names matching ds_metric_statistics for consistency';


--
-- Name: ds_control_group_statistics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ds_control_group_statistics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ds_control_group_statistics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ds_control_group_statistics_id_seq OWNED BY public.ds_control_group_statistics.id;


--
-- Name: ds_control_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_control_groups (
    id integer NOT NULL,
    control_group_id character varying(255) NOT NULL,
    system_under_test_id character varying(255),
    workload character varying(255),
    test_environment character varying(255),
    n_test_runs integer DEFAULT 0 NOT NULL,
    test_runs text[],
    first_datetime timestamp with time zone,
    last_datetime timestamp with time zone,
    metric_filters jsonb DEFAULT '{}'::jsonb,
    change_point jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ds_control_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ds_control_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ds_control_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ds_control_groups_id_seq OWNED BY public.ds_control_groups.id;


--
-- Name: ds_metric_classification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_metric_classification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid,
    test_environment character varying(255),
    workload character varying(255),
    dashboard_uid character varying(255),
    dashboard_label character varying(255),
    application_dashboard_id uuid,
    panel_id integer,
    panel_title character varying(500),
    metric_name character varying(255),
    regex boolean DEFAULT false,
    higher_is_better boolean,
    metric_classification character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE ds_metric_classification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_metric_classification IS 'Metric classification rules determining whether increases/decreases are regressions or improvements';


--
-- Name: COLUMN ds_metric_classification.higher_is_better; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metric_classification.higher_is_better IS 'If true: increases=improvements, decreases=regressions. If false: increases=regressions, decreases=improvements';


--
-- Name: ds_metric_statistics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_metric_statistics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    benchmark_id uuid,
    count bigint,
    mean double precision,
    median double precision,
    min_value double precision,
    max_value double precision,
    std_dev double precision,
    percentiles jsonb,
    iqr double precision,
    idr double precision,
    missing_percentage double precision,
    constant_value boolean,
    updated_at timestamp with time zone DEFAULT now(),
    metric_name character varying(255),
    test_run_start timestamp with time zone,
    dashboard_uid character varying(255),
    dashboard_label character varying(255),
    panel_title character varying(500),
    unit character varying(50),
    q10 double precision,
    q25 double precision,
    q75 double precision,
    q90 double precision,
    q95 double precision,
    q99 double precision,
    is_constant boolean,
    all_missing boolean,
    pct_missing double precision,
    last_value double precision,
    n_missing integer,
    n_non_zero integer
);


--
-- Name: ds_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_metrics (
    test_run_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL,
    dashboard_uid character varying(255) NOT NULL,
    panel_id integer NOT NULL,
    panel_title character varying(500),
    dashboard_label character varying(255),
    benchmark_ids text[],
    errors jsonb,
    metric_name character varying(255),
    "time" timestamp with time zone NOT NULL,
    timestep double precision,
    ramp_up boolean,
    value double precision,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    unit character varying(50)
);


--
-- Name: TABLE ds_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_metrics IS 'Time-series metrics data equivalent to MongoDB dsMetrics collection';


--
-- Name: COLUMN ds_metrics.test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.test_run_id IS 'Test run identifier (string format to match MongoDB)';


--
-- Name: COLUMN ds_metrics.application_dashboard_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.application_dashboard_id IS 'Application dashboard ID from MongoDB applicationDashboards collection';


--
-- Name: COLUMN ds_metrics.dashboard_uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.dashboard_uid IS 'Grafana dashboard UID';


--
-- Name: COLUMN ds_metrics.panel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.panel_id IS 'Grafana panel ID';


--
-- Name: COLUMN ds_metrics.panel_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.panel_title IS 'Panel title from Grafana dashboard';


--
-- Name: COLUMN ds_metrics.dashboard_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.dashboard_label IS 'Dashboard label for identification';


--
-- Name: COLUMN ds_metrics.benchmark_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.benchmark_ids IS 'Array of benchmark IDs associated with this metric data';


--
-- Name: COLUMN ds_metrics.errors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.errors IS 'Any errors encountered during metric collection';


--
-- Name: COLUMN ds_metrics.metric_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.metric_name IS 'Name of the metric (equivalent to metricName in data array)';


--
-- Name: COLUMN ds_metrics."time"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics."time" IS 'Timestamp of the metric data point';


--
-- Name: COLUMN ds_metrics.timestep; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.timestep IS 'Timestep value from the data point';


--
-- Name: COLUMN ds_metrics.ramp_up; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.ramp_up IS 'Whether this data point is from ramp-up period';


--
-- Name: COLUMN ds_metrics.value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_metrics.value IS 'Metric value';


--
-- Name: ds_panels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_panels (
    id integer NOT NULL,
    test_run_id character varying(255) NOT NULL,
    application_dashboard_id uuid NOT NULL,
    dashboard_uid character varying(255) NOT NULL,
    panel_id integer NOT NULL,
    panel_title character varying(500) NOT NULL,
    dashboard_label character varying(255) NOT NULL,
    benchmark_ids jsonb DEFAULT '[]'::jsonb,
    panel jsonb NOT NULL,
    query_variables jsonb DEFAULT '{}'::jsonb,
    datasource_type character varying(100),
    requests jsonb DEFAULT '[]'::jsonb,
    errors jsonb,
    warnings jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE ds_panels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ds_panels IS 'Stores panel information for data science analysis and metrics processing';


--
-- Name: COLUMN ds_panels.test_run_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.test_run_id IS 'Test run identifier in the format: system-environment-workload-sequence';


--
-- Name: COLUMN ds_panels.application_dashboard_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.application_dashboard_id IS 'Reference to application dashboard configuration';


--
-- Name: COLUMN ds_panels.dashboard_uid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.dashboard_uid IS 'Grafana dashboard unique identifier';


--
-- Name: COLUMN ds_panels.panel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.panel_id IS 'Grafana panel ID within the dashboard';


--
-- Name: COLUMN ds_panels.panel_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.panel_title IS 'Display title of the panel';


--
-- Name: COLUMN ds_panels.dashboard_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.dashboard_label IS 'Human-readable dashboard label';


--
-- Name: COLUMN ds_panels.benchmark_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.benchmark_ids IS 'Array of benchmark IDs associated with this panel';


--
-- Name: COLUMN ds_panels.panel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.panel IS 'Complete panel configuration and metadata from Grafana';


--
-- Name: COLUMN ds_panels.query_variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.query_variables IS 'Query variables and their values used for this panel';


--
-- Name: COLUMN ds_panels.datasource_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.datasource_type IS 'Type of datasource (influxdb, prometheus, etc.)';


--
-- Name: COLUMN ds_panels.requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.requests IS 'HTTP requests and queries executed for this panel';


--
-- Name: COLUMN ds_panels.errors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.errors IS 'Any errors encountered during panel processing';


--
-- Name: COLUMN ds_panels.warnings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ds_panels.warnings IS 'Non-fatal warnings during panel processing';


--
-- Name: ds_panels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ds_panels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ds_panels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ds_panels_id_seq OWNED BY public.ds_panels.id;


--
-- Name: ds_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_type character varying(100) NOT NULL,
    source_instance character varying(255) NOT NULL,
    query_name character varying(255),
    query_hash character varying(64) NOT NULL,
    query_definition jsonb NOT NULL,
    query_parameters jsonb,
    target_reference jsonb,
    expected_metrics text[],
    execution_timeout integer DEFAULT 120,
    retry_count integer DEFAULT 3,
    avg_execution_time_ms integer,
    last_execution_time timestamp with time zone,
    success_rate numeric(5,2),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ds_query_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_query_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query_id uuid NOT NULL,
    test_run_id uuid,
    executed_at timestamp with time zone DEFAULT now(),
    execution_parameters jsonb,
    status character varying(50) NOT NULL,
    execution_time_ms integer,
    rows_returned integer,
    data_points_collected integer,
    error_code character varying(100),
    error_message text,
    retry_attempt integer DEFAULT 0,
    metrics_stored_count integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ds_tracked_differences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ds_tracked_differences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    application_dashboard_id uuid NOT NULL,
    panel_id integer NOT NULL,
    benchmark_id uuid,
    difference_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dynatrace_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynatrace_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    perfana_test_run_id_attribute character varying(255),
    perfana_request_name_attribute character varying(255)
);


--
-- Name: TABLE dynatrace_configs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dynatrace_configs IS 'Dynatrace configuration for mapping Perfana test run attributes';


--
-- Name: COLUMN dynatrace_configs.host; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_configs.host IS 'Dynatrace host URL (unique)';


--
-- Name: dynatrace_query; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynatrace_query (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id character varying(255) NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    dashboard_label character varying(255) NOT NULL,
    panel_title character varying(255) NOT NULL,
    query_query text NOT NULL,
    match_metric_pattern character varying(500),
    omit_group_by_variable_from_metric_name text[],
    template_variables jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    application_dashboard_id uuid NOT NULL,
    panel_id integer,
    metric_unit character varying(50)
);


--
-- Name: TABLE dynatrace_query; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dynatrace_query IS 'Stores Dynatrace DQL queries for performance monitoring and analysis';


--
-- Name: COLUMN dynatrace_query.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.id IS 'Unique identifier for the DQL query';


--
-- Name: COLUMN dynatrace_query.system_under_test_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.system_under_test_id IS 'Reference to the system being monitored';


--
-- Name: COLUMN dynatrace_query.test_environment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.test_environment IS 'Environment where the monitoring applies (e.g., production, staging)';


--
-- Name: COLUMN dynatrace_query.workload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.workload IS 'Workload identifier for the monitoring scope';


--
-- Name: COLUMN dynatrace_query.dashboard_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.dashboard_label IS 'Human-readable label for the dashboard';


--
-- Name: COLUMN dynatrace_query.panel_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.panel_title IS 'Title of the specific panel within the dashboard';


--
-- Name: COLUMN dynatrace_query.query_query; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.query_query IS 'The actual Dynatrace DQL query string';


--
-- Name: COLUMN dynatrace_query.match_metric_pattern; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.match_metric_pattern IS 'Pattern to match metrics (e.g., response_time_*)';


--
-- Name: COLUMN dynatrace_query.omit_group_by_variable_from_metric_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.omit_group_by_variable_from_metric_name IS 'Array of variable names to omit from metric grouping';


--
-- Name: COLUMN dynatrace_query.template_variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.template_variables IS 'JSON object containing template variable key-value pairs (e.g., {"Cluster": "production-cluster"})';


--
-- Name: COLUMN dynatrace_query.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.created_at IS 'Timestamp when the DQL query was created';


--
-- Name: COLUMN dynatrace_query.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.updated_at IS 'Timestamp when the DQL query was last updated';


--
-- Name: COLUMN dynatrace_query.application_dashboard_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.application_dashboard_id IS 'UUID identifier linking to application dashboard configuration - generated for import groups or reused for manual additions';


--
-- Name: COLUMN dynatrace_query.panel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dynatrace_query.panel_id IS 'Auto-generated number based on dashboard_label and panel_title for ordering and identification';


--
-- Name: dynatrace_entity_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynatrace_entity_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255),
    workload character varying(255),
    entity_id character varying(255) NOT NULL,
    entity_display_name character varying(500) NOT NULL,
    entity_type character varying(100) NOT NULL,
    level character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dynatrace_entity_mappings_level_check CHECK (((level)::text = ANY ((ARRAY['sut'::character varying, 'sut_testenv'::character varying, 'sut_testenv_workload'::character varying])::text[])))
);


--
-- Name: expected_config_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expected_config_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    config_key character varying(500) NOT NULL,
    expected_value text,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE expected_config_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expected_config_changes IS 'Expected configuration changes for test runs, used to flag known vs unexpected configuration differences';


--
-- Name: generic_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    check_name character varying(255) NOT NULL,
    profile character varying(255) NOT NULL,
    add_for_workloads_matching_regex character varying(255),
    check_id character varying(255) NOT NULL,
    dashboard_name character varying(255) NOT NULL,
    dashboard_uid character varying(100) NOT NULL,
    grafana_label character varying(255) DEFAULT 'Default'::character varying NOT NULL,
    panel jsonb NOT NULL,
    update_test_runs character varying(10) DEFAULT 'false'::character varying,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE generic_checks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.generic_checks IS 'Generic check configurations that can be applied to test runs for validation and alerting';


--
-- Name: COLUMN generic_checks.add_for_workloads_matching_regex; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.generic_checks.add_for_workloads_matching_regex IS 'Regex pattern to match workload names (e.g., "load.*")';


--
-- Name: COLUMN generic_checks.panel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.generic_checks.panel IS 'Complete panel configuration including validation rules and thresholds';


--
-- Name: generic_deep_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_deep_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile character varying(255) NOT NULL,
    link_name character varying(255) NOT NULL,
    link_type character varying(100) NOT NULL,
    url_template text NOT NULL,
    description text,
    icon character varying(100),
    category character varying(100),
    variables jsonb,
    enabled boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE generic_deep_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.generic_deep_links IS 'Generic deep link templates for system/environment/workload combinations';


--
-- Name: COLUMN generic_deep_links.url_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.generic_deep_links.url_template IS 'URL template with variable placeholders for dynamic link generation';


--
-- Name: COLUMN generic_deep_links.variables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.generic_deep_links.variables IS 'Variable definitions used in URL template replacement';


--
-- Name: generic_report_panels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_report_panels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile character varying(255) NOT NULL,
    panel_name character varying(255) NOT NULL,
    panel_type character varying(100) NOT NULL,
    description text,
    configuration jsonb NOT NULL,
    enabled boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE generic_report_panels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.generic_report_panels IS 'Generic report panel templates for system/environment/workload combinations';


--
-- Name: licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(255) NOT NULL,
    license_type integer,
    customer_name character varying(255),
    public_key text,
    valid_until timestamp with time zone,
    all_ok boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: pending_ds_compare_config_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_ds_compare_config_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ds_compare_config_id uuid NOT NULL,
    pending_changes jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    tags text[],
    read_only boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_panels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_panels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    panel_name character varying(255) NOT NULL,
    panel_type character varying(100) NOT NULL,
    description text,
    configuration jsonb NOT NULL,
    data_query jsonb,
    visualization_config jsonb,
    layout_config jsonb,
    enabled boolean DEFAULT true,
    display_order integer DEFAULT 0,
    tags text[],
    generated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE report_panels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.report_panels IS 'Test run specific report panels for detailed analysis and visualization';


--
-- Name: COLUMN report_panels.data_query; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.report_panels.data_query IS 'Query configuration for retrieving panel data';


--
-- Name: COLUMN report_panels.visualization_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.report_panels.visualization_config IS 'Visualization-specific settings (colors, axes, legends, etc.)';


--
-- Name: system_under_test_test_environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_under_test_test_environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    tracing_service character varying(255),
    pyroscope_application character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_under_test_workloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_under_test_workloads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_test_environment_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    config jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: test_run_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_run_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    level character varying(50) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: test_run_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_run_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid,
    key character varying(255) NOT NULL,
    value text,
    tags text[],
    created_at timestamp with time zone DEFAULT now(),
    test_run_id_string character varying(255)
);


--
-- Name: test_run_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_run_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    event_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_under_test_id uuid NOT NULL,
    test_environment character varying(255) NOT NULL,
    workload character varying(255) NOT NULL,
    test_run_id character varying(255) NOT NULL,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    duration integer,
    planned_duration integer,
    ramp_up integer,
    completed boolean DEFAULT false,
    abort boolean DEFAULT false,
    status jsonb,
    consolidated_result jsonb,
    annotations text[],
    tags text[],
    application_release character varying(255),
    ci_build_results_url character varying(255),
    expires timestamp with time zone,
    expired boolean DEFAULT false,
    valid boolean DEFAULT true,
    reasons_not_valid text[],
    adapt_config jsonb,
    variables jsonb,
    deep_links jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: trends_filter_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trends_filter_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    preset_type character varying(20) DEFAULT 'generic'::character varying NOT NULL,
    application_dashboard_id uuid,
    panel_id integer,
    panel_title character varying(255),
    created_for_test_run_id character varying(255),
    is_global boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    component character varying(255) NOT NULL,
    version character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


--
-- Name: messages_2025_10_05; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_05 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_06; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_06 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_07; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_07 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_08; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_08 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_09; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_09 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_10; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_10 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: messages_2025_10_11; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2025_10_11 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: iceberg_namespaces; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.iceberg_namespaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: iceberg_tables; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.iceberg_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace_id uuid NOT NULL,
    bucket_id text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    location text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    level integer
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: prefixes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.prefixes (
    bucket_id text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    level integer GENERATED ALWAYS AS (storage.get_level(name)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hooks; Type: TABLE; Schema: supabase_functions; Owner: -
--

CREATE TABLE supabase_functions.hooks (
    id bigint NOT NULL,
    hook_table_id integer NOT NULL,
    hook_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_id bigint
);


--
-- Name: TABLE hooks; Type: COMMENT; Schema: supabase_functions; Owner: -
--

COMMENT ON TABLE supabase_functions.hooks IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';


--
-- Name: hooks_id_seq; Type: SEQUENCE; Schema: supabase_functions; Owner: -
--

CREATE SEQUENCE supabase_functions.hooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hooks_id_seq; Type: SEQUENCE OWNED BY; Schema: supabase_functions; Owner: -
--

ALTER SEQUENCE supabase_functions.hooks_id_seq OWNED BY supabase_functions.hooks.id;


--
-- Name: migrations; Type: TABLE; Schema: supabase_functions; Owner: -
--

CREATE TABLE supabase_functions.migrations (
    version text NOT NULL,
    inserted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 FOR VALUES IN ('__pgboss__send-it');


--
-- Name: messages_2025_10_05; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_05 FOR VALUES FROM ('2025-10-05 00:00:00') TO ('2025-10-06 00:00:00');


--
-- Name: messages_2025_10_06; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_06 FOR VALUES FROM ('2025-10-06 00:00:00') TO ('2025-10-07 00:00:00');


--
-- Name: messages_2025_10_07; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_07 FOR VALUES FROM ('2025-10-07 00:00:00') TO ('2025-10-08 00:00:00');


--
-- Name: messages_2025_10_08; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_08 FOR VALUES FROM ('2025-10-08 00:00:00') TO ('2025-10-09 00:00:00');


--
-- Name: messages_2025_10_09; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_09 FOR VALUES FROM ('2025-10-09 00:00:00') TO ('2025-10-10 00:00:00');


--
-- Name: messages_2025_10_10; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_10 FOR VALUES FROM ('2025-10-10 00:00:00') TO ('2025-10-11 00:00:00');


--
-- Name: messages_2025_10_11; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2025_10_11 FOR VALUES FROM ('2025-10-11 00:00:00') TO ('2025-10-12 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: ds_change_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_change_points ALTER COLUMN id SET DEFAULT nextval('public.ds_change_points_id_seq'::regclass);


--
-- Name: ds_control_group_statistics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_control_group_statistics ALTER COLUMN id SET DEFAULT nextval('public.ds_control_group_statistics_id_seq'::regclass);


--
-- Name: ds_control_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_control_groups ALTER COLUMN id SET DEFAULT nextval('public.ds_control_groups_id_seq'::regclass);


--
-- Name: ds_panels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_panels ALTER COLUMN id SET DEFAULT nextval('public.ds_panels_id_seq'::regclass);


--
-- Name: hooks id; Type: DEFAULT; Schema: supabase_functions; Owner: -
--

ALTER TABLE ONLY supabase_functions.hooks ALTER COLUMN id SET DEFAULT nextval('supabase_functions.hooks_id_seq'::regclass);


--
-- Name: extensions extensions_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.extensions
    ADD CONSTRAINT extensions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: archive archive_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.archive
    ADD CONSTRAINT archive_pkey PRIMARY KEY (name, id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (name, id);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey PRIMARY KEY (name, id);


--
-- Name: queue queue_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_pkey PRIMARY KEY (name);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (name);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (event, name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version);


--
-- Name: api_keys api_keys_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_api_key_key UNIQUE (api_key);


--
-- Name: api_keys api_keys_description_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_description_key UNIQUE (description);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: application_dashboards application_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_dashboards
    ADD CONSTRAINT application_dashboards_pkey PRIMARY KEY (id);


--
-- Name: system_under_test_test_environments application_test_environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_test_environments
    ADD CONSTRAINT application_test_environments_pkey PRIMARY KEY (id);


--
-- Name: system_under_test_workloads application_test_types_application_test_environment_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_workloads
    ADD CONSTRAINT application_test_types_application_test_environment_id_name_key UNIQUE (system_under_test_test_environment_id, name);


--
-- Name: system_under_test_workloads application_test_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_workloads
    ADD CONSTRAINT application_test_types_pkey PRIMARY KEY (id);


--
-- Name: systems_under_test applications_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.systems_under_test
    ADD CONSTRAINT applications_name_key UNIQUE (name);


--
-- Name: systems_under_test applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.systems_under_test
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: profile_grafana_dashboards profile_grafana_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_grafana_dashboards
    ADD CONSTRAINT profile_grafana_dashboards_pkey PRIMARY KEY (id);


--
-- Name: benchmarks benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmarks
    ADD CONSTRAINT benchmarks_pkey PRIMARY KEY (id);


--
-- Name: check_results check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_pkey PRIMARY KEY (id);


--
-- Name: compare_filter_presets compare_filter_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compare_filter_presets
    ADD CONSTRAINT compare_filter_presets_pkey PRIMARY KEY (id);


--
-- Name: compare_results compare_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compare_results
    ADD CONSTRAINT compare_results_pkey PRIMARY KEY (id);


--
-- Name: configuration configuration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuration
    ADD CONSTRAINT configuration_pkey PRIMARY KEY (id);


--
-- Name: configuration configuration_type_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuration
    ADD CONSTRAINT configuration_type_key_key UNIQUE (type, key);


--
-- Name: data_sources data_sources_organization_id_source_type_instance_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_organization_id_source_type_instance_name_key UNIQUE (organization_id, source_type, instance_name);


--
-- Name: data_sources data_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_pkey PRIMARY KEY (id);


--
-- Name: deep_links deep_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_links
    ADD CONSTRAINT deep_links_pkey PRIMARY KEY (id);


--
-- Name: ds_adapt_conclusion ds_adapt_conclusion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_conclusion
    ADD CONSTRAINT ds_adapt_conclusion_pkey PRIMARY KEY (id);


--
-- Name: ds_adapt_conclusion ds_adapt_conclusion_test_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_conclusion
    ADD CONSTRAINT ds_adapt_conclusion_test_run_id_key UNIQUE (test_run_id);


--
-- Name: ds_adapt_results ds_adapt_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_results
    ADD CONSTRAINT ds_adapt_results_pkey PRIMARY KEY (id);


--
-- Name: ds_adapt_tracked_results ds_adapt_tracked_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_tracked_results
    ADD CONSTRAINT ds_adapt_tracked_results_pkey PRIMARY KEY (id);


--
-- Name: ds_adapt_tracked_results ds_adapt_tracked_results_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_tracked_results
    ADD CONSTRAINT ds_adapt_tracked_results_unique UNIQUE (test_run_id, application_dashboard_id, panel_id, metric_name, tracked_test_run_id);


--
-- Name: ds_change_points ds_change_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_change_points
    ADD CONSTRAINT ds_change_points_pkey PRIMARY KEY (id);


--
-- Name: ds_compare_config ds_compare_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_compare_config
    ADD CONSTRAINT ds_compare_config_pkey PRIMARY KEY (id);


--
-- Name: ds_control_group_statistics ds_control_group_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_control_group_statistics
    ADD CONSTRAINT ds_control_group_statistics_pkey PRIMARY KEY (id);


--
-- Name: ds_control_groups ds_control_groups_control_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_control_groups
    ADD CONSTRAINT ds_control_groups_control_group_id_key UNIQUE (control_group_id);


--
-- Name: ds_control_groups ds_control_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_control_groups
    ADD CONSTRAINT ds_control_groups_pkey PRIMARY KEY (id);


--
-- Name: ds_metric_classification ds_metric_classification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_metric_classification
    ADD CONSTRAINT ds_metric_classification_pkey PRIMARY KEY (id);


--
-- Name: ds_metric_statistics ds_metric_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_metric_statistics
    ADD CONSTRAINT ds_metric_statistics_pkey PRIMARY KEY (id);


--
-- Name: ds_metric_statistics ds_metric_statistics_unique_metric; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_metric_statistics
    ADD CONSTRAINT ds_metric_statistics_unique_metric UNIQUE (test_run_id, application_dashboard_id, panel_id, metric_name);


--
-- Name: ds_panels ds_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_panels
    ADD CONSTRAINT ds_panels_pkey PRIMARY KEY (id);


--
-- Name: ds_queries ds_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_queries
    ADD CONSTRAINT ds_queries_pkey PRIMARY KEY (id);


--
-- Name: ds_queries ds_queries_source_type_source_instance_query_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_queries
    ADD CONSTRAINT ds_queries_source_type_source_instance_query_hash_key UNIQUE (source_type, source_instance, query_hash);


--
-- Name: ds_query_executions ds_query_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_query_executions
    ADD CONSTRAINT ds_query_executions_pkey PRIMARY KEY (id);


--
-- Name: ds_tracked_differences ds_tracked_differences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_tracked_differences
    ADD CONSTRAINT ds_tracked_differences_pkey PRIMARY KEY (id);


--
-- Name: dynatrace_configs dynatrace_configs_host_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynatrace_configs
    ADD CONSTRAINT dynatrace_configs_host_key UNIQUE (host);


--
-- Name: dynatrace_configs dynatrace_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynatrace_configs
    ADD CONSTRAINT dynatrace_configs_pkey PRIMARY KEY (id);


--
-- Name: dynatrace_query dynatrace_query_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynatrace_query
    ADD CONSTRAINT dynatrace_query_pkey PRIMARY KEY (id);


--
-- Name: dynatrace_entity_mappings dynatrace_entity_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynatrace_entity_mappings
    ADD CONSTRAINT dynatrace_entity_mappings_pkey PRIMARY KEY (id);


--
-- Name: expected_config_changes expected_config_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expected_config_changes
    ADD CONSTRAINT expected_config_changes_pkey PRIMARY KEY (id);


--
-- Name: expected_config_changes expected_config_changes_system_under_test_id_test_environme_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expected_config_changes
    ADD CONSTRAINT expected_config_changes_system_under_test_id_test_environme_key UNIQUE (system_under_test_id, test_environment, workload, config_key);


--
-- Name: generic_checks generic_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_checks
    ADD CONSTRAINT generic_checks_pkey PRIMARY KEY (id);


--
-- Name: generic_deep_links generic_deep_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_deep_links
    ADD CONSTRAINT generic_deep_links_pkey PRIMARY KEY (id);


--
-- Name: generic_report_panels generic_report_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_report_panels
    ADD CONSTRAINT generic_report_panels_pkey PRIMARY KEY (id);


--
-- Name: grafana_dashboards grafana_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grafana_dashboards
    ADD CONSTRAINT grafana_dashboards_pkey PRIMARY KEY (id);


--
-- Name: grafana_instances grafana_instances_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grafana_instances
    ADD CONSTRAINT grafana_instances_label_key UNIQUE (label);


--
-- Name: grafana_instances grafana_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grafana_instances
    ADD CONSTRAINT grafana_instances_pkey PRIMARY KEY (id);


--
-- Name: licenses licenses_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_key_key UNIQUE (key);


--
-- Name: licenses licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: pending_ds_compare_config_changes pending_ds_compare_config_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_ds_compare_config_changes
    ADD CONSTRAINT pending_ds_compare_config_changes_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_name_key UNIQUE (name);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: report_panels report_panels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_panels
    ADD CONSTRAINT report_panels_pkey PRIMARY KEY (id);


--
-- Name: system_under_test_test_environments system_under_test_test_environments_system_under_test_id_name_k; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_test_environments
    ADD CONSTRAINT system_under_test_test_environments_system_under_test_id_name_k UNIQUE (system_under_test_id, name);


--
-- Name: teams teams_organization_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: test_run_alerts test_run_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_alerts
    ADD CONSTRAINT test_run_alerts_pkey PRIMARY KEY (id);


--
-- Name: test_run_configs test_run_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_configs
    ADD CONSTRAINT test_run_configs_pkey PRIMARY KEY (id);


--
-- Name: test_run_configs test_run_configs_test_run_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_configs
    ADD CONSTRAINT test_run_configs_test_run_id_key_key UNIQUE (test_run_id, key);


--
-- Name: test_run_events test_run_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_events
    ADD CONSTRAINT test_run_events_pkey PRIMARY KEY (id);


--
-- Name: test_runs test_runs_application_id_test_environment_test_type_test_ru_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_runs
    ADD CONSTRAINT test_runs_application_id_test_environment_test_type_test_ru_key UNIQUE (system_under_test_id, test_environment, workload, test_run_id);


--
-- Name: test_runs test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_runs
    ADD CONSTRAINT test_runs_pkey PRIMARY KEY (id);


--
-- Name: trends_filter_presets trends_filter_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trends_filter_presets
    ADD CONSTRAINT trends_filter_presets_pkey PRIMARY KEY (id);


--
-- Name: ds_adapt_results uk_ds_adapt_results_business_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_adapt_results
    ADD CONSTRAINT uk_ds_adapt_results_business_key UNIQUE (test_run_id, control_group_id, application_dashboard_id, panel_id, metric_name);


--
-- Name: versions versions_component_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.versions
    ADD CONSTRAINT versions_component_version_key UNIQUE (component, version);


--
-- Name: versions versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.versions
    ADD CONSTRAINT versions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_05 messages_2025_10_05_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_05
    ADD CONSTRAINT messages_2025_10_05_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_06 messages_2025_10_06_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_06
    ADD CONSTRAINT messages_2025_10_06_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_07 messages_2025_10_07_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_07
    ADD CONSTRAINT messages_2025_10_07_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_08 messages_2025_10_08_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_08
    ADD CONSTRAINT messages_2025_10_08_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_09 messages_2025_10_09_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_09
    ADD CONSTRAINT messages_2025_10_09_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_10 messages_2025_10_10_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_10
    ADD CONSTRAINT messages_2025_10_10_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2025_10_11 messages_2025_10_11_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2025_10_11
    ADD CONSTRAINT messages_2025_10_11_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: iceberg_namespaces iceberg_namespaces_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_pkey PRIMARY KEY (id);


--
-- Name: iceberg_tables iceberg_tables_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: prefixes prefixes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT prefixes_pkey PRIMARY KEY (bucket_id, level, name);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: hooks hooks_pkey; Type: CONSTRAINT; Schema: supabase_functions; Owner: -
--

ALTER TABLE ONLY supabase_functions.hooks
    ADD CONSTRAINT hooks_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: supabase_functions; Owner: -
--

ALTER TABLE ONLY supabase_functions.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (version);


--
-- Name: extensions_tenant_external_id_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE INDEX extensions_tenant_external_id_index ON _realtime.extensions USING btree (tenant_external_id);


--
-- Name: extensions_tenant_external_id_type_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE UNIQUE INDEX extensions_tenant_external_id_type_index ON _realtime.extensions USING btree (tenant_external_id, type);


--
-- Name: tenants_external_id_index; Type: INDEX; Schema: _realtime; Owner: -
--

CREATE UNIQUE INDEX tenants_external_id_index ON _realtime.tenants USING btree (external_id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: archive_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX archive_i1 ON pgboss.archive USING btree (archived_on);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i1 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i2 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i3 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i4 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_i5 ON pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: ds_compare_config_metric_level_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ds_compare_config_metric_level_unique ON public.ds_compare_config USING btree (application_dashboard_id, panel_id, metric_name) WHERE (metric_name IS NOT NULL);


--
-- Name: ds_compare_config_panel_level_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ds_compare_config_panel_level_unique ON public.ds_compare_config USING btree (application_dashboard_id, panel_id) WHERE (metric_name IS NULL);


--
-- Name: ds_metrics_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ds_metrics_time_idx ON public.ds_metrics USING btree ("time" DESC);


--
-- Name: idx_application_dashboards_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_dashboard_id ON public.application_dashboards USING btree (grafana_dashboard_id);


--
-- Name: idx_application_dashboards_environment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_environment ON public.application_dashboards USING btree (test_environment);


--
-- Name: idx_application_dashboards_grafana_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_grafana_id ON public.application_dashboards USING btree (grafana_instance_id);


--
-- Name: idx_application_dashboards_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_label ON public.application_dashboards USING btree (dashboard_label);


--
-- Name: idx_application_dashboards_system_env; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_system_env ON public.application_dashboards USING btree (system_under_test_id, test_environment);


--
-- Name: idx_application_dashboards_system_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_system_id ON public.application_dashboards USING btree (system_under_test_id);


--
-- Name: idx_application_dashboards_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_dashboards_uid ON public.application_dashboards USING btree (dashboard_uid);


--
-- Name: idx_applications_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_name ON public.systems_under_test USING btree (name);


--
-- Name: idx_applications_team_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_team_id ON public.systems_under_test USING btree (team_id);


--
-- Name: idx_profile_grafana_dashboards_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profile_grafana_dashboards_dashboard_uid ON public.profile_grafana_dashboards USING btree (dashboard_uid);


--
-- Name: idx_profile_grafana_dashboards_grafana_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profile_grafana_dashboards_grafana_label ON public.profile_grafana_dashboards USING btree (grafana_label);


--
-- Name: idx_profile_grafana_dashboards_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profile_grafana_dashboards_profile ON public.profile_grafana_dashboards USING btree (profile);


--
-- Name: idx_benchmarks_config_title; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_config_title ON public.benchmarks USING btree (config_title);


--
-- Name: idx_benchmarks_configuration_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_configuration_gin ON public.benchmarks USING gin (configuration);


--
-- Name: idx_benchmarks_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_dashboard_uid ON public.benchmarks USING btree (dashboard_uid) WHERE ((source)::text = 'grafana'::text);


--
-- Name: idx_benchmarks_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_enabled ON public.benchmarks USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_benchmarks_evaluate_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_evaluate_type ON public.benchmarks USING btree (evaluate_type);


--
-- Name: idx_benchmarks_generic_check_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_generic_check_id ON public.benchmarks USING btree (generic_check_id) WHERE (generic_check_id IS NOT NULL);


--
-- Name: idx_benchmarks_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_source ON public.benchmarks USING btree (source);


--
-- Name: idx_benchmarks_sut_source_env_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_sut_source_env_workload ON public.benchmarks USING btree (system_under_test_id, source, test_environment, workload);


--
-- Name: idx_benchmarks_system_under_test_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_system_under_test_id ON public.benchmarks USING btree (system_under_test_id);


--
-- Name: idx_benchmarks_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_tags_gin ON public.benchmarks USING gin (tags);


--
-- Name: idx_benchmarks_test_env; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_test_env ON public.benchmarks USING btree (test_environment);


--
-- Name: idx_benchmarks_unique_grafana; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_benchmarks_unique_grafana ON public.benchmarks USING btree (system_under_test_id, source, test_environment, workload, dashboard_uid, config_id, dashboard_label) WHERE ((enabled = true) AND ((source)::text = 'grafana'::text));


--
-- Name: idx_benchmarks_unique_non_grafana; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_benchmarks_unique_non_grafana ON public.benchmarks USING btree (system_under_test_id, source, test_environment, workload, config_title) WHERE ((enabled = true) AND ((source)::text <> 'grafana'::text));


--
-- Name: idx_benchmarks_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_valid ON public.benchmarks USING btree (valid) WHERE (valid = true);


--
-- Name: idx_benchmarks_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_benchmarks_workload ON public.benchmarks USING btree (workload);


--
-- Name: idx_check_results_benchmark_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_benchmark_gin ON public.check_results USING gin (benchmark);


--
-- Name: idx_check_results_benchmark_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_benchmark_id ON public.check_results USING btree (benchmark_id);


--
-- Name: idx_check_results_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_dashboard_uid ON public.check_results USING btree (dashboard_uid) WHERE ((source)::text = 'grafana'::text);


--
-- Name: idx_check_results_dynatrace_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_dynatrace_entity ON public.check_results USING btree (dynatrace_entity_id) WHERE ((source)::text = 'dynatrace'::text);


--
-- Name: idx_check_results_dynatrace_filters_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_dynatrace_filters_gin ON public.check_results USING gin (dynatrace_dimension_filters);


--
-- Name: idx_check_results_evaluate_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_evaluate_type ON public.check_results USING btree (evaluate_type);


--
-- Name: idx_check_results_meets_requirement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_meets_requirement ON public.check_results USING btree (meets_requirement) WHERE (meets_requirement IS NOT NULL);


--
-- Name: idx_check_results_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_metadata_gin ON public.check_results USING gin (metadata);


--
-- Name: idx_check_results_metric_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_metric_name ON public.check_results USING btree (metric_name) WHERE (metric_name IS NOT NULL);


--
-- Name: idx_check_results_requirement_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_requirement_gin ON public.check_results USING gin (requirement);


--
-- Name: idx_check_results_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_source ON public.check_results USING btree (source);


--
-- Name: idx_check_results_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_status ON public.check_results USING btree (status);


--
-- Name: idx_check_results_sut_source_env_workload_testrun; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_sut_source_env_workload_testrun ON public.check_results USING btree (system_under_test_id, source, test_environment, workload, test_run_id);


--
-- Name: idx_check_results_system_under_test_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_system_under_test_id ON public.check_results USING btree (system_under_test_id);


--
-- Name: idx_check_results_targets_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_targets_gin ON public.check_results USING gin (targets);


--
-- Name: idx_check_results_test_env; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_test_env ON public.check_results USING btree (test_environment);


--
-- Name: idx_check_results_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_test_run_id ON public.check_results USING btree (test_run_id);


--
-- Name: idx_check_results_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_results_workload ON public.check_results USING btree (workload);


--
-- Name: idx_compare_config_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_config_lookup ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name);


--
-- Name: idx_compare_filter_presets_app_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_app_dashboard ON public.compare_filter_presets USING btree (application_dashboard_id) WHERE (application_dashboard_id IS NOT NULL);


--
-- Name: idx_compare_filter_presets_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_created_by ON public.compare_filter_presets USING btree (created_by);


--
-- Name: idx_compare_filter_presets_created_for_test_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_created_for_test_run ON public.compare_filter_presets USING btree (created_for_test_run_id) WHERE (created_for_test_run_id IS NOT NULL);


--
-- Name: idx_compare_filter_presets_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_global ON public.compare_filter_presets USING btree (is_global);


--
-- Name: idx_compare_filter_presets_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_name ON public.compare_filter_presets USING btree (name);


--
-- Name: idx_compare_filter_presets_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_filter_presets_type ON public.compare_filter_presets USING btree (preset_type);


--
-- Name: idx_compare_results_baseline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_baseline ON public.compare_results USING btree (baseline_test_run_id);


--
-- Name: idx_compare_results_benchmark; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_benchmark ON public.compare_results USING gin (benchmark);


--
-- Name: idx_compare_results_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_status ON public.compare_results USING btree (status);


--
-- Name: idx_compare_results_system_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_system_test ON public.compare_results USING btree (system_under_test_id, test_environment, workload);


--
-- Name: idx_compare_results_targets; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_targets ON public.compare_results USING gin (targets);


--
-- Name: idx_compare_results_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compare_results_test_run_id ON public.compare_results USING btree (test_run_id);


--
-- Name: idx_deep_links_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deep_links_lookup ON public.deep_links USING btree (system_under_test_id, test_environment, workload);


--
-- Name: idx_deep_links_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deep_links_template ON public.deep_links USING btree (template_deep_link_id) WHERE (template_deep_link_id IS NOT NULL);


--
-- Name: idx_ds_adapt_conclusion_conclusion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_conclusion ON public.ds_adapt_conclusion USING btree (conclusion);


--
-- Name: idx_ds_adapt_conclusion_control_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_control_group_id ON public.ds_adapt_conclusion USING btree (control_group_id) WHERE (control_group_id IS NOT NULL);


--
-- Name: idx_ds_adapt_conclusion_details_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_details_gin ON public.ds_adapt_conclusion USING gin (details);


--
-- Name: idx_ds_adapt_conclusion_details_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_details_message ON public.ds_adapt_conclusion USING btree (((details ->> 'message'::text)));


--
-- Name: idx_ds_adapt_conclusion_differences_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_differences_gin ON public.ds_adapt_conclusion USING gin (differences);


--
-- Name: idx_ds_adapt_conclusion_improvements_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_improvements_gin ON public.ds_adapt_conclusion USING gin (improvements);


--
-- Name: idx_ds_adapt_conclusion_regressions_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_regressions_gin ON public.ds_adapt_conclusion USING gin (regressions);


--
-- Name: idx_ds_adapt_conclusion_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_test_run_id ON public.ds_adapt_conclusion USING btree (test_run_id);


--
-- Name: idx_ds_adapt_conclusion_tracked_regressions_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_tracked_regressions_gin ON public.ds_adapt_conclusion USING gin (tracked_regressions);


--
-- Name: idx_ds_adapt_conclusion_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_conclusion_updated_at ON public.ds_adapt_conclusion USING btree (updated_at DESC);


--
-- Name: idx_ds_adapt_results_compare_config_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_compare_config_gin ON public.ds_adapt_results USING gin (compare_config);


--
-- Name: idx_ds_adapt_results_conclusion_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_conclusion_gin ON public.ds_adapt_results USING gin (conclusion);


--
-- Name: idx_ds_adapt_results_conclusion_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_conclusion_label ON public.ds_adapt_results USING btree (((conclusion ->> 'label'::text)));


--
-- Name: idx_ds_adapt_results_control_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_control_group_id ON public.ds_adapt_results USING btree (control_group_id);


--
-- Name: idx_ds_adapt_results_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_dashboard ON public.ds_adapt_results USING btree (application_dashboard_id, panel_id);


--
-- Name: idx_ds_adapt_results_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_metric ON public.ds_adapt_results USING btree (metric_name);


--
-- Name: idx_ds_adapt_results_stale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_stale ON public.ds_adapt_results USING btree (test_run_id, is_stale) WHERE (is_stale = true);


--
-- Name: idx_ds_adapt_results_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_test_run_id ON public.ds_adapt_results USING btree (test_run_id);


--
-- Name: idx_ds_adapt_results_test_run_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_test_run_start ON public.ds_adapt_results USING btree (test_run_start);


--
-- Name: idx_ds_adapt_results_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_results_updated_at ON public.ds_adapt_results USING btree (updated_at);


--
-- Name: idx_ds_adapt_tracked_results_checks_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_checks_gin ON public.ds_adapt_tracked_results USING gin (checks);


--
-- Name: idx_ds_adapt_tracked_results_conclusion_analysis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_conclusion_analysis ON public.ds_adapt_tracked_results USING gin (((conclusion -> 'label'::text))) WHERE (conclusion IS NOT NULL);


--
-- Name: idx_ds_adapt_tracked_results_control_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_control_group ON public.ds_adapt_tracked_results USING btree (control_group_id, test_run_start DESC);


--
-- Name: idx_ds_adapt_tracked_results_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_dashboard ON public.ds_adapt_tracked_results USING btree (application_dashboard_id, test_run_start DESC);


--
-- Name: idx_ds_adapt_tracked_results_mean_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_mean_gin ON public.ds_adapt_tracked_results USING gin (mean);


--
-- Name: idx_ds_adapt_tracked_results_median_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_median_gin ON public.ds_adapt_tracked_results USING gin (median);


--
-- Name: idx_ds_adapt_tracked_results_metric_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_metric_tracking ON public.ds_adapt_tracked_results USING btree (application_dashboard_id, panel_id, metric_name, control_group_id, test_run_start DESC);


--
-- Name: idx_ds_adapt_tracked_results_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_panel ON public.ds_adapt_tracked_results USING btree (application_dashboard_id, panel_id, test_run_start DESC);


--
-- Name: idx_ds_adapt_tracked_results_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_test_run_id ON public.ds_adapt_tracked_results USING btree (test_run_id);


--
-- Name: idx_ds_adapt_tracked_results_time_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_time_series ON public.ds_adapt_tracked_results USING btree (application_dashboard_id, panel_id, metric_name, test_run_start DESC);


--
-- Name: idx_ds_adapt_tracked_results_tracked_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_adapt_tracked_results_tracked_test_run_id ON public.ds_adapt_tracked_results USING btree (tracked_test_run_id);


--
-- Name: idx_ds_change_points_application_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_application_dashboard_id ON public.ds_change_points USING btree (application_dashboard_id);


--
-- Name: idx_ds_change_points_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_composite ON public.ds_change_points USING btree (system_under_test_id, workload, test_environment);


--
-- Name: idx_ds_change_points_metric_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_metric_name ON public.ds_change_points USING btree (metric_name);


--
-- Name: idx_ds_change_points_panel_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_panel_composite ON public.ds_change_points USING btree (application_dashboard_id, panel_id, metric_name);


--
-- Name: idx_ds_change_points_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_panel_id ON public.ds_change_points USING btree (panel_id);


--
-- Name: idx_ds_change_points_system_under_test_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_system_under_test_id ON public.ds_change_points USING btree (system_under_test_id);


--
-- Name: idx_ds_change_points_test_environment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_test_environment ON public.ds_change_points USING btree (test_environment);


--
-- Name: idx_ds_change_points_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_test_run_id ON public.ds_change_points USING btree (test_run_id);


--
-- Name: idx_ds_change_points_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_change_points_workload ON public.ds_change_points USING btree (workload);


--
-- Name: idx_ds_compare_config_dashboard_fallback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_dashboard_fallback ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id) WHERE ((metric_name IS NULL) AND (panel_id IS NULL));


--
-- Name: idx_ds_compare_config_environment_fallback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_environment_fallback ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload) WHERE ((metric_name IS NULL) AND (panel_id IS NULL) AND (application_dashboard_id IS NULL));


--
-- Name: idx_ds_compare_config_global_fallback; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_global_fallback ON public.ds_compare_config USING btree (system_under_test_id, workload) WHERE ((metric_name IS NULL) AND (panel_id IS NULL) AND (application_dashboard_id IS NULL) AND (test_environment IS NULL));


--
-- Name: idx_ds_compare_config_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_hash ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, config_hash);


--
-- Name: idx_ds_compare_config_metric_specific; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_metric_specific ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name) WHERE (metric_name IS NOT NULL);


--
-- Name: idx_ds_compare_config_panel_specific; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_compare_config_panel_specific ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id) WHERE (metric_name IS NULL);


--
-- Name: idx_ds_control_group_statistics_application_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_group_statistics_application_dashboard_id ON public.ds_control_group_statistics USING btree (application_dashboard_id);


--
-- Name: idx_ds_control_group_statistics_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_group_statistics_composite ON public.ds_control_group_statistics USING btree (control_group_id, application_dashboard_id, panel_id);


--
-- Name: idx_ds_control_group_statistics_control_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_group_statistics_control_group_id ON public.ds_control_group_statistics USING btree (control_group_id);


--
-- Name: idx_ds_control_group_statistics_metric_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_group_statistics_metric_name ON public.ds_control_group_statistics USING btree (metric_name);


--
-- Name: idx_ds_control_group_statistics_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_group_statistics_panel_id ON public.ds_control_group_statistics USING btree (panel_id);


--
-- Name: idx_ds_control_group_stats_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ds_control_group_stats_unique ON public.ds_control_group_statistics USING btree (control_group_id, application_dashboard_id, panel_id, metric_name);


--
-- Name: idx_ds_control_groups_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_composite ON public.ds_control_groups USING btree (system_under_test_id, workload, test_environment);


--
-- Name: idx_ds_control_groups_control_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_control_group_id ON public.ds_control_groups USING btree (control_group_id);


--
-- Name: idx_ds_control_groups_system_under_test_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_system_under_test_id ON public.ds_control_groups USING btree (system_under_test_id);


--
-- Name: idx_ds_control_groups_test_environment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_test_environment ON public.ds_control_groups USING btree (test_environment);


--
-- Name: idx_ds_control_groups_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_updated_at ON public.ds_control_groups USING btree (updated_at);


--
-- Name: idx_ds_control_groups_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_control_groups_workload ON public.ds_control_groups USING btree (workload);


--
-- Name: idx_ds_metric_classification_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_classification_lookup ON public.ds_metric_classification USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name);


--
-- Name: idx_ds_metric_classification_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_classification_metric ON public.ds_metric_classification USING btree (metric_name) WHERE (metric_name IS NOT NULL);


--
-- Name: idx_ds_metric_classification_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_classification_panel ON public.ds_metric_classification USING btree (application_dashboard_id, panel_id);


--
-- Name: idx_ds_metric_statistics_application_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_application_dashboard_id ON public.ds_metric_statistics USING btree (application_dashboard_id);


--
-- Name: idx_ds_metric_statistics_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_composite ON public.ds_metric_statistics USING btree (test_run_id, application_dashboard_id, panel_id);


--
-- Name: idx_ds_metric_statistics_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_dashboard ON public.ds_metric_statistics USING btree (dashboard_uid, dashboard_label, panel_id);


--
-- Name: idx_ds_metric_statistics_dashboard_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_dashboard_label ON public.ds_metric_statistics USING btree (dashboard_label);


--
-- Name: idx_ds_metric_statistics_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_dashboard_uid ON public.ds_metric_statistics USING btree (dashboard_uid);


--
-- Name: idx_ds_metric_statistics_metric_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_metric_name ON public.ds_metric_statistics USING btree (metric_name);


--
-- Name: idx_ds_metric_statistics_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_panel_id ON public.ds_metric_statistics USING btree (panel_id);


--
-- Name: idx_ds_metric_statistics_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_test_run_id ON public.ds_metric_statistics USING btree (test_run_id);


--
-- Name: idx_ds_metric_statistics_test_run_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_test_run_start ON public.ds_metric_statistics USING btree (test_run_start);


--
-- Name: idx_ds_metric_statistics_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_statistics_unit ON public.ds_metric_statistics USING btree (unit);


--
-- Name: idx_ds_metric_stats_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_stats_composite ON public.ds_metric_statistics USING btree (application_dashboard_id, panel_id);


--
-- Name: idx_ds_metric_stats_percentiles; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_stats_percentiles ON public.ds_metric_statistics USING gin (percentiles);


--
-- Name: idx_ds_metric_stats_test_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metric_stats_test_run ON public.ds_metric_statistics USING btree (test_run_id);


--
-- Name: idx_ds_metrics_application_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_application_dashboard_id ON public.ds_metrics USING btree (application_dashboard_id);


--
-- Name: idx_ds_metrics_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_composite ON public.ds_metrics USING btree (test_run_id, application_dashboard_id, panel_id);


--
-- Name: idx_ds_metrics_metric_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_metric_name ON public.ds_metrics USING btree (metric_name);


--
-- Name: idx_ds_metrics_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_panel_id ON public.ds_metrics USING btree (panel_id);


--
-- Name: idx_ds_metrics_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_test_run_id ON public.ds_metrics USING btree (test_run_id);


--
-- Name: idx_ds_metrics_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_time ON public.ds_metrics USING btree ("time");


--
-- Name: idx_ds_metrics_upsert_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ds_metrics_upsert_key ON public.ds_metrics USING btree (test_run_id, application_dashboard_id, panel_id, metric_name, "time");


--
-- Name: idx_ds_metrics_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_metrics_value ON public.ds_metrics USING btree (value);


--
-- Name: idx_ds_panels_application_dashboard_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_application_dashboard_id ON public.ds_panels USING btree (application_dashboard_id);


--
-- Name: idx_ds_panels_benchmark_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_benchmark_ids ON public.ds_panels USING gin (benchmark_ids);


--
-- Name: idx_ds_panels_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_composite ON public.ds_panels USING btree (test_run_id, application_dashboard_id, panel_id);


--
-- Name: idx_ds_panels_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_dashboard_uid ON public.ds_panels USING btree (dashboard_uid);


--
-- Name: idx_ds_panels_datasource_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_datasource_type ON public.ds_panels USING btree (datasource_type);


--
-- Name: idx_ds_panels_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_panel_id ON public.ds_panels USING btree (panel_id);


--
-- Name: idx_ds_panels_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_test_run_id ON public.ds_panels USING btree (test_run_id);


--
-- Name: idx_ds_panels_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_panels_updated_at ON public.ds_panels USING btree (updated_at);


--
-- Name: idx_ds_queries_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_queries_hash ON public.ds_queries USING btree (query_hash);


--
-- Name: idx_ds_queries_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_queries_source ON public.ds_queries USING btree (source_type, source_instance);


--
-- Name: idx_ds_query_executions_query_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_query_executions_query_id ON public.ds_query_executions USING btree (query_id);


--
-- Name: idx_ds_query_executions_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ds_query_executions_test_run_id ON public.ds_query_executions USING btree (test_run_id);


--
-- Name: idx_dynatrace_configs_host; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dynatrace_configs_host ON public.dynatrace_configs USING btree (host);


--
-- Name: idx_dynatrace_query_application_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_query_application_dashboard ON public.dynatrace_query USING btree (application_dashboard_id, dashboard_label);


--
-- Name: idx_dynatrace_query_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_query_created_at ON public.dynatrace_query USING btree (created_at DESC);


--
-- Name: idx_dynatrace_query_dashboard_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_query_dashboard_panel ON public.dynatrace_query USING btree (dashboard_label, panel_title);


--
-- Name: idx_dynatrace_query_panel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_query_panel_id ON public.dynatrace_query USING btree (panel_id);


--
-- Name: idx_dynatrace_query_system_env_workload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_query_system_env_workload ON public.dynatrace_query USING btree (system_under_test_id, test_environment, workload);


--
-- Name: idx_dynatrace_entity_mappings_system_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dynatrace_entity_mappings_system_level ON public.dynatrace_entity_mappings USING btree (system_under_test_id, level);


--
-- Name: idx_dynatrace_entity_mappings_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dynatrace_entity_mappings_unique ON public.dynatrace_entity_mappings USING btree (system_under_test_id, COALESCE(test_environment, ''::character varying), COALESCE(workload, ''::character varying), entity_id);


--
-- Name: idx_expected_config_changes_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expected_config_changes_composite ON public.expected_config_changes USING btree (system_under_test_id, test_environment, workload);


--
-- Name: idx_expected_config_changes_config_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expected_config_changes_config_key ON public.expected_config_changes USING btree (config_key);


--
-- Name: idx_generic_checks_dashboard_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_checks_dashboard_uid ON public.generic_checks USING btree (dashboard_uid);


--
-- Name: idx_generic_checks_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_checks_enabled ON public.generic_checks USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_generic_checks_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_checks_profile ON public.generic_checks USING btree (profile);


--
-- Name: idx_generic_checks_workload_regex; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_checks_workload_regex ON public.generic_checks USING btree (add_for_workloads_matching_regex);


--
-- Name: idx_generic_deep_links_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_deep_links_category ON public.generic_deep_links USING btree (category);


--
-- Name: idx_generic_deep_links_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_deep_links_enabled ON public.generic_deep_links USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_generic_deep_links_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_deep_links_profile ON public.generic_deep_links USING btree (profile);


--
-- Name: idx_generic_deep_links_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_deep_links_type ON public.generic_deep_links USING btree (link_type);


--
-- Name: idx_generic_report_panels_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_report_panels_enabled ON public.generic_report_panels USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_generic_report_panels_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_report_panels_profile ON public.generic_report_panels USING btree (profile);


--
-- Name: idx_generic_report_panels_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generic_report_panels_type ON public.generic_report_panels USING btree (panel_type);


--
-- Name: idx_grafana_dashboards_grafana_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_grafana_id ON public.grafana_dashboards USING btree (grafana_instance_id);


--
-- Name: idx_grafana_dashboards_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_name ON public.grafana_dashboards USING btree (name);


--
-- Name: idx_grafana_dashboards_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_tags ON public.grafana_dashboards USING gin (tags);


--
-- Name: idx_grafana_dashboards_template_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_template_profile ON public.grafana_dashboards USING btree (template_profile) WHERE (template_profile IS NOT NULL);


--
-- Name: idx_grafana_dashboards_template_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_template_uid ON public.grafana_dashboards USING btree (template_dashboard_uid) WHERE (template_dashboard_uid IS NOT NULL);


--
-- Name: idx_grafana_dashboards_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_uid ON public.grafana_dashboards USING btree (uid);


--
-- Name: idx_grafana_dashboards_used_by_sut; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_dashboards_used_by_sut ON public.grafana_dashboards USING gin (used_by_sut);


--
-- Name: idx_grafana_instances_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_instances_label ON public.grafana_instances USING btree (label);


--
-- Name: idx_grafana_instances_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grafana_instances_snapshot ON public.grafana_instances USING btree (snapshot_instance) WHERE (snapshot_instance = true);


--
-- Name: idx_organizations_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_name ON public.organizations USING btree (name);


--
-- Name: idx_report_panels_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_panels_enabled ON public.report_panels USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_report_panels_test_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_panels_test_run ON public.report_panels USING btree (test_run_id);


--
-- Name: idx_report_panels_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_panels_type ON public.report_panels USING btree (panel_type);


--
-- Name: idx_teams_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_name ON public.teams USING btree (organization_id, name);


--
-- Name: idx_teams_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_organization_id ON public.teams USING btree (organization_id);


--
-- Name: idx_test_run_alerts_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_run_alerts_test_run_id ON public.test_run_alerts USING btree (test_run_id);


--
-- Name: idx_test_run_configs_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_run_configs_test_run_id ON public.test_run_configs USING btree (test_run_id);


--
-- Name: idx_test_run_configs_test_run_id_string; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_run_configs_test_run_id_string ON public.test_run_configs USING btree (test_run_id_string);


--
-- Name: idx_test_run_events_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_run_events_test_run_id ON public.test_run_events USING btree (test_run_id);


--
-- Name: idx_test_runs_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_runs_application_id ON public.test_runs USING btree (system_under_test_id);


--
-- Name: idx_test_runs_composite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_runs_composite ON public.test_runs USING btree (system_under_test_id, test_environment, workload);


--
-- Name: idx_test_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_runs_created_at ON public.test_runs USING btree (created_at DESC);


--
-- Name: idx_test_runs_test_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_test_runs_test_run_id ON public.test_runs USING btree (test_run_id);


--
-- Name: idx_trends_filter_presets_app_dashboard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_app_dashboard ON public.trends_filter_presets USING btree (application_dashboard_id) WHERE (application_dashboard_id IS NOT NULL);


--
-- Name: idx_trends_filter_presets_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_created_by ON public.trends_filter_presets USING btree (created_by);


--
-- Name: idx_trends_filter_presets_created_for_test_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_created_for_test_run ON public.trends_filter_presets USING btree (created_for_test_run_id) WHERE (created_for_test_run_id IS NOT NULL);


--
-- Name: idx_trends_filter_presets_global; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_global ON public.trends_filter_presets USING btree (is_global);


--
-- Name: idx_trends_filter_presets_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_name ON public.trends_filter_presets USING btree (name);


--
-- Name: idx_trends_filter_presets_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trends_filter_presets_type ON public.trends_filter_presets USING btree (preset_type);


--
-- Name: uniq_ds_compare_config_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_ds_compare_config_metric ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id, metric_name) WHERE (metric_name IS NOT NULL);


--
-- Name: uniq_ds_compare_config_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_ds_compare_config_panel ON public.ds_compare_config USING btree (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id) WHERE (metric_name IS NULL);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: subscription_subscription_id_entity_filters_key; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_key ON realtime.subscription USING btree (subscription_id, entity, filters);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: idx_iceberg_namespaces_bucket_id; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_iceberg_namespaces_bucket_id ON storage.iceberg_namespaces USING btree (bucket_id, name);


--
-- Name: idx_iceberg_tables_namespace_id; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_iceberg_tables_namespace_id ON storage.iceberg_tables USING btree (namespace_id, name);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_name_bucket_level_unique; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_name_bucket_level_unique ON storage.objects USING btree (name COLLATE "C", bucket_id, level);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_lower_name ON storage.objects USING btree ((path_tokens[level]), lower(name) text_pattern_ops, bucket_id, level);


--
-- Name: idx_prefixes_lower_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_prefixes_lower_name ON storage.prefixes USING btree (bucket_id, level, ((string_to_array(name, '/'::text))[level]), lower(name) text_pattern_ops);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_bucket_id_level_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX objects_bucket_id_level_idx ON storage.objects USING btree (bucket_id, level, name COLLATE "C");


--
-- Name: supabase_functions_hooks_h_table_id_h_name_idx; Type: INDEX; Schema: supabase_functions; Owner: -
--

CREATE INDEX supabase_functions_hooks_h_table_id_h_name_idx ON supabase_functions.hooks USING btree (hook_table_id, hook_name);


--
-- Name: supabase_functions_hooks_request_id_idx; Type: INDEX; Schema: supabase_functions; Owner: -
--

CREATE INDEX supabase_functions_hooks_request_id_idx ON supabase_functions.hooks USING btree (request_id);


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3_pkey;


--
-- Name: messages_2025_10_05_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_05_pkey;


--
-- Name: messages_2025_10_06_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_06_pkey;


--
-- Name: messages_2025_10_07_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_07_pkey;


--
-- Name: messages_2025_10_08_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_08_pkey;


--
-- Name: messages_2025_10_09_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_09_pkey;


--
-- Name: messages_2025_10_10_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_10_pkey;


--
-- Name: messages_2025_10_11_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2025_10_11_pkey;


--
-- Name: ds_adapt_results auto_mark_fresh_on_analysis; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auto_mark_fresh_on_analysis BEFORE INSERT OR UPDATE ON public.ds_adapt_results FOR EACH ROW EXECUTE FUNCTION public.mark_results_fresh_on_analysis();


--
-- Name: ds_compare_config trigger_mark_stale_on_config_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_mark_stale_on_config_update AFTER UPDATE ON public.ds_compare_config FOR EACH ROW EXECUTE FUNCTION public.mark_results_stale_on_config_change();


--
-- Name: dynatrace_query trigger_update_dynatrace_query_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_dynatrace_query_updated_at BEFORE UPDATE ON public.dynatrace_query FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: api_keys update_api_keys_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: application_dashboards update_application_dashboards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_application_dashboards_updated_at BEFORE UPDATE ON public.application_dashboards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: systems_under_test update_applications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON public.systems_under_test FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profile_grafana_dashboards update_profile_grafana_dashboards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profile_grafana_dashboards_updated_at BEFORE UPDATE ON public.profile_grafana_dashboards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: benchmarks update_benchmarks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_benchmarks_updated_at BEFORE UPDATE ON public.benchmarks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: check_results update_check_results_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_check_results_updated_at BEFORE UPDATE ON public.check_results FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: compare_filter_presets update_compare_filter_presets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_compare_filter_presets_updated_at BEFORE UPDATE ON public.compare_filter_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: configuration update_configuration_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_configuration_updated_at BEFORE UPDATE ON public.configuration FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: data_sources update_data_sources_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_data_sources_updated_at BEFORE UPDATE ON public.data_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ds_compare_config update_ds_compare_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ds_compare_config_updated_at BEFORE UPDATE ON public.ds_compare_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ds_control_groups update_ds_control_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ds_control_groups_updated_at BEFORE UPDATE ON public.ds_control_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ds_panels update_ds_panels_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ds_panels_updated_at BEFORE UPDATE ON public.ds_panels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ds_queries update_ds_queries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ds_queries_updated_at BEFORE UPDATE ON public.ds_queries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: generic_checks update_generic_checks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_generic_checks_updated_at BEFORE UPDATE ON public.generic_checks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: generic_deep_links update_generic_deep_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_generic_deep_links_updated_at BEFORE UPDATE ON public.generic_deep_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: generic_report_panels update_generic_report_panels_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_generic_report_panels_updated_at BEFORE UPDATE ON public.generic_report_panels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: grafana_instances update_grafana_instances_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_grafana_instances_updated_at BEFORE UPDATE ON public.grafana_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: licenses update_licenses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_licenses_updated_at BEFORE UPDATE ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: organizations update_organizations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teams update_teams_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: test_runs update_test_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_test_runs_updated_at BEFORE UPDATE ON public.test_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: trends_filter_presets update_trends_filter_presets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_trends_filter_presets_updated_at BEFORE UPDATE ON public.trends_filter_presets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: benchmarks validate_benchmark_configuration_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER validate_benchmark_configuration_trigger BEFORE INSERT OR UPDATE ON public.benchmarks FOR EACH ROW EXECUTE FUNCTION public.validate_benchmark_configuration();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: objects objects_delete_delete_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- Name: objects objects_insert_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();


--
-- Name: objects objects_update_create_prefix; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();


--
-- Name: prefixes prefixes_create_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();


--
-- Name: prefixes prefixes_delete_hierarchy; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: extensions extensions_tenant_external_id_fkey; Type: FK CONSTRAINT; Schema: _realtime; Owner: -
--

ALTER TABLE ONLY _realtime.extensions
    ADD CONSTRAINT extensions_tenant_external_id_fkey FOREIGN KEY (tenant_external_id) REFERENCES _realtime.tenants(external_id) ON DELETE CASCADE;


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3 q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.j3f168501ed9816b51a9f5765e0742e1eb034ab6bf72c9ae3f3a975e3
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: queue queue_dead_letter_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);


--
-- Name: schedule schedule_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: subscription subscription_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: application_dashboards application_dashboards_grafana_dashboard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_dashboards
    ADD CONSTRAINT application_dashboards_grafana_dashboard_id_fkey FOREIGN KEY (grafana_dashboard_id) REFERENCES public.grafana_dashboards(id) ON DELETE CASCADE;


--
-- Name: application_dashboards application_dashboards_grafana_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_dashboards
    ADD CONSTRAINT application_dashboards_grafana_instance_id_fkey FOREIGN KEY (grafana_instance_id) REFERENCES public.grafana_instances(id) ON DELETE CASCADE;


--
-- Name: application_dashboards application_dashboards_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_dashboards
    ADD CONSTRAINT application_dashboards_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: systems_under_test applications_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.systems_under_test
    ADD CONSTRAINT applications_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id);


--
-- Name: benchmarks benchmarks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmarks
    ADD CONSTRAINT benchmarks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: benchmarks benchmarks_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmarks
    ADD CONSTRAINT benchmarks_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: benchmarks benchmarks_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmarks
    ADD CONSTRAINT benchmarks_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: check_results check_results_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: check_results check_results_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: check_results check_results_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: compare_filter_presets compare_filter_presets_application_dashboard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compare_filter_presets
    ADD CONSTRAINT compare_filter_presets_application_dashboard_id_fkey FOREIGN KEY (application_dashboard_id) REFERENCES public.application_dashboards(id) ON DELETE SET NULL;


--
-- Name: compare_filter_presets compare_filter_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compare_filter_presets
    ADD CONSTRAINT compare_filter_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: compare_results compare_results_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compare_results
    ADD CONSTRAINT compare_results_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: data_sources data_sources_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_sources
    ADD CONSTRAINT data_sources_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: deep_links deep_links_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_links
    ADD CONSTRAINT deep_links_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: deep_links deep_links_template_deep_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deep_links
    ADD CONSTRAINT deep_links_template_deep_link_id_fkey FOREIGN KEY (template_deep_link_id) REFERENCES public.generic_deep_links(id);


--
-- Name: ds_query_executions ds_query_executions_query_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_query_executions
    ADD CONSTRAINT ds_query_executions_query_id_fkey FOREIGN KEY (query_id) REFERENCES public.ds_queries(id) ON DELETE CASCADE;


--
-- Name: ds_query_executions ds_query_executions_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_query_executions
    ADD CONSTRAINT ds_query_executions_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id);


--
-- Name: ds_tracked_differences ds_tracked_differences_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_tracked_differences
    ADD CONSTRAINT ds_tracked_differences_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id);


--
-- Name: expected_config_changes expected_config_changes_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expected_config_changes
    ADD CONSTRAINT expected_config_changes_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: ds_compare_config fk_ds_compare_config_application_dashboard; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_compare_config
    ADD CONSTRAINT fk_ds_compare_config_application_dashboard FOREIGN KEY (application_dashboard_id) REFERENCES public.application_dashboards(id);


--
-- Name: ds_compare_config fk_ds_compare_config_system_under_test; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ds_compare_config
    ADD CONSTRAINT fk_ds_compare_config_system_under_test FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id);


--
-- Name: dynatrace_entity_mappings fk_dynatrace_entity_mappings_system; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynatrace_entity_mappings
    ADD CONSTRAINT fk_dynatrace_entity_mappings_system FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: grafana_dashboards grafana_dashboards_grafana_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grafana_dashboards
    ADD CONSTRAINT grafana_dashboards_grafana_instance_id_fkey FOREIGN KEY (grafana_instance_id) REFERENCES public.grafana_instances(id) ON DELETE CASCADE;


--
-- Name: pending_ds_compare_config_changes pending_ds_compare_config_changes_ds_compare_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_ds_compare_config_changes
    ADD CONSTRAINT pending_ds_compare_config_changes_ds_compare_config_id_fkey FOREIGN KEY (ds_compare_config_id) REFERENCES public.ds_compare_config(id) ON DELETE CASCADE;


--
-- Name: report_panels report_panels_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_panels
    ADD CONSTRAINT report_panels_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;


--
-- Name: system_under_test_test_environments system_under_test_test_environments_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_test_environments
    ADD CONSTRAINT system_under_test_test_environments_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id) ON DELETE CASCADE;


--
-- Name: system_under_test_workloads system_under_test_test_types_system_under_test_test_environment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_under_test_workloads
    ADD CONSTRAINT system_under_test_test_types_system_under_test_test_environment FOREIGN KEY (system_under_test_test_environment_id) REFERENCES public.system_under_test_test_environments(id) ON DELETE CASCADE;


--
-- Name: teams teams_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: test_run_alerts test_run_alerts_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_alerts
    ADD CONSTRAINT test_run_alerts_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;


--
-- Name: test_run_configs test_run_configs_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_configs
    ADD CONSTRAINT test_run_configs_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;


--
-- Name: test_run_events test_run_events_test_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_run_events
    ADD CONSTRAINT test_run_events_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES public.test_runs(id) ON DELETE CASCADE;


--
-- Name: test_runs test_runs_system_under_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_runs
    ADD CONSTRAINT test_runs_system_under_test_id_fkey FOREIGN KEY (system_under_test_id) REFERENCES public.systems_under_test(id);


--
-- Name: trends_filter_presets trends_filter_presets_application_dashboard_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trends_filter_presets
    ADD CONSTRAINT trends_filter_presets_application_dashboard_id_fkey FOREIGN KEY (application_dashboard_id) REFERENCES public.application_dashboards(id) ON DELETE SET NULL;


--
-- Name: trends_filter_presets trends_filter_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trends_filter_presets
    ADD CONSTRAINT trends_filter_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: iceberg_namespaces iceberg_namespaces_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_namespace_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_namespace_id_fkey FOREIGN KEY (namespace_id) REFERENCES storage.iceberg_namespaces(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: prefixes prefixes_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.prefixes
    ADD CONSTRAINT "prefixes_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: application_dashboards Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.application_dashboards TO authenticated USING (true);


--
-- Name: profile_grafana_dashboards Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.profile_grafana_dashboards TO authenticated USING (true);


--
-- Name: deep_links Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.deep_links TO authenticated USING (true);


--
-- Name: generic_checks Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.generic_checks TO authenticated USING (true);


--
-- Name: generic_deep_links Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.generic_deep_links TO authenticated USING (true);


--
-- Name: generic_report_panels Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.generic_report_panels TO authenticated USING (true);


--
-- Name: grafana_dashboards Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.grafana_dashboards TO authenticated USING (true);


--
-- Name: grafana_instances Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.grafana_instances TO authenticated USING (true);


--
-- Name: report_panels Allow all operations for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all operations for authenticated users" ON public.report_panels TO authenticated USING (true);


--
-- Name: generic_deep_links Authenticated users can create generic deep links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create generic deep links" ON public.generic_deep_links FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: generic_deep_links Authenticated users can delete generic deep links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can delete generic deep links" ON public.generic_deep_links FOR DELETE TO authenticated USING (true);


--
-- Name: generic_deep_links Authenticated users can update generic deep links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can update generic deep links" ON public.generic_deep_links FOR UPDATE TO authenticated USING (true);


--
-- Name: generic_deep_links Authenticated users can view generic deep links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view generic deep links" ON public.generic_deep_links FOR SELECT TO authenticated USING (true);


--
-- Name: compare_filter_presets Users can create own presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own presets" ON public.compare_filter_presets FOR INSERT WITH CHECK ((created_by = auth.uid()));


--
-- Name: trends_filter_presets Users can create own trends presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create own trends presets" ON public.trends_filter_presets FOR INSERT WITH CHECK ((created_by = auth.uid()));


--
-- Name: compare_filter_presets Users can delete own presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own presets" ON public.compare_filter_presets FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: trends_filter_presets Users can delete own trends presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own trends presets" ON public.trends_filter_presets FOR DELETE USING ((created_by = auth.uid()));


--
-- Name: compare_filter_presets Users can read own and global presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own and global presets" ON public.compare_filter_presets FOR SELECT USING (((created_by = auth.uid()) OR (is_global = true)));


--
-- Name: trends_filter_presets Users can read own and global trends presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own and global trends presets" ON public.trends_filter_presets FOR SELECT USING (((created_by = auth.uid()) OR (is_global = true)));


--
-- Name: compare_filter_presets Users can update own presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own presets" ON public.compare_filter_presets FOR UPDATE USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- Name: trends_filter_presets Users can update own trends presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own trends presets" ON public.trends_filter_presets FOR UPDATE USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- Name: application_dashboards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_dashboards ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_grafana_dashboards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_grafana_dashboards ENABLE ROW LEVEL SECURITY;

--
-- Name: benchmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.benchmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: benchmarks benchmarks_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benchmarks_delete_policy ON public.benchmarks FOR DELETE TO authenticated USING (true);


--
-- Name: benchmarks benchmarks_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benchmarks_insert_policy ON public.benchmarks FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: benchmarks benchmarks_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benchmarks_read_policy ON public.benchmarks FOR SELECT TO authenticated USING (true);


--
-- Name: benchmarks benchmarks_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY benchmarks_update_policy ON public.benchmarks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: check_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.check_results ENABLE ROW LEVEL SECURITY;

--
-- Name: check_results check_results_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY check_results_delete_policy ON public.check_results FOR DELETE TO authenticated USING (true);


--
-- Name: check_results check_results_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY check_results_insert_policy ON public.check_results FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: check_results check_results_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY check_results_read_policy ON public.check_results FOR SELECT TO authenticated USING (true);


--
-- Name: check_results check_results_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY check_results_update_policy ON public.check_results FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: compare_filter_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compare_filter_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: deep_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deep_links ENABLE ROW LEVEL SECURITY;

--
-- Name: generic_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generic_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: generic_deep_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generic_deep_links ENABLE ROW LEVEL SECURITY;

--
-- Name: generic_report_panels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generic_report_panels ENABLE ROW LEVEL SECURITY;

--
-- Name: grafana_dashboards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grafana_dashboards ENABLE ROW LEVEL SECURITY;

--
-- Name: grafana_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grafana_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: report_panels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_panels ENABLE ROW LEVEL SECURITY;

--
-- Name: trends_filter_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trends_filter_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_namespaces; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.iceberg_namespaces ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_tables; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.iceberg_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: prefixes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.prefixes ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime check_results; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.check_results;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict vfpPc72u8UtVbBCMXJYqAW7FZRdrPhh1dBEFbdbIriDQyf4ZC4GixKu6Hh2QHM5

