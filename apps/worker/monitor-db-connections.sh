#!/bin/bash

# Monitor PostgreSQL connections from the worker
echo "=== PostgreSQL Connection Monitor ==="
echo "Press Ctrl+C to stop"
echo ""

while true; do
    clear
    echo "=== PostgreSQL Connection Stats - $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo ""
    
    # Query PostgreSQL for connection information
    psql postgresql://postgres:postgres@localhost:54322/postgres -c "
        SELECT 
            state,
            COUNT(*) as count,
            MAX(EXTRACT(EPOCH FROM (NOW() - state_change))) as max_duration_seconds
        FROM pg_stat_activity 
        WHERE datname = 'postgres'
        GROUP BY state
        ORDER BY count DESC;
    " 2>/dev/null
    
    echo ""
    echo "=== Active Connections Detail ==="
    psql postgresql://postgres:postgres@localhost:54322/postgres -c "
        SELECT 
            pid,
            state,
            EXTRACT(EPOCH FROM (NOW() - state_change))::int as duration_sec,
            LEFT(query, 100) as query_preview
        FROM pg_stat_activity 
        WHERE datname = 'postgres' 
          AND state != 'idle'
        ORDER BY state_change
        LIMIT 10;
    " 2>/dev/null
    
    echo ""
    echo "=== Pool Stats (from pg_stat_database) ==="
    psql postgresql://postgres:postgres@localhost:54322/postgres -c "
        SELECT 
            numbackends as total_connections,
            xact_commit as commits,
            xact_rollback as rollbacks,
            blks_read,
            blks_hit,
            ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) as cache_hit_ratio
        FROM pg_stat_database 
        WHERE datname = 'postgres';
    " 2>/dev/null
    
    sleep 2
done
