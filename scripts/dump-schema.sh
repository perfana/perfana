#!/usr/bin/env bash
# dump-schema.sh — Regenerate packages/shared/src/database/migrations/schema-sql.ts
#
# Usage: bash scripts/dump-schema.sh [CONTAINER] [DB_USER] [DB_NAME]
#
# Defaults:
#   CONTAINER = perfana-postgres
#   DB_USER   = perfana
#   DB_NAME   = perfana
#
# After running, commit the updated schema-sql.ts as part of the next migration
# consolidation cycle. See docs/superpowers/plans/2026-05-14-migration-consolidation.md
# for the full consolidation procedure.

set -euo pipefail

CONTAINER="${1:-perfana-postgres}"
DB_USER="${2:-perfana}"
DB_NAME="${3:-perfana}"
SCHEMA_FILE="packages/shared/src/database/migrations/schema-sql.ts"
TMP_DUMP=$(mktemp /tmp/perfana-schema-XXXXXX.sql)
TMP_CLEAN=$(mktemp /tmp/perfana-schema-clean-XXXXXX.sql)

cleanup() { rm -f "$TMP_DUMP" "$TMP_CLEAN"; }
trap cleanup EXIT

echo "Dumping schema from $CONTAINER ($DB_USER@$DB_NAME)..."
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  --schema-only \
  --no-owner \
  --schema=public \
  "$DB_NAME" > "$TMP_DUMP"

echo "Cleaning dump and writing TypeScript file..."

# Use Python to:
#   1. Clean the pg_dump output (strip SET, metacommands, OWNED BY, etc.)
#   2. Escape backticks (template literal delimiters)
#   3. Write the final TypeScript module
# Using Python avoids shell heredoc expansion issues with PostgreSQL special
# characters like $1/$2 parameter refs and $$ function body delimiters.
python3 - "$TMP_DUMP" "$TMP_CLEAN" "$SCHEMA_FILE" << 'PYEOF'
import sys, re, datetime

src, cleaned_out, ts_out = sys.argv[1], sys.argv[2], sys.argv[3]

with open(src) as f:
    lines = f.readlines()

out = []
past_header = False
for line in lines:
    stripped = line.rstrip('\n')
    if not past_header:
        if re.match(r'^(CREATE|ALTER|INSERT|GRANT|SET search_path)', stripped):
            past_header = True
        else:
            continue
    # Strip psql metacommands (\connect, \!, etc.)
    if stripped.startswith('\\'):
        continue
    # Strip pure SET statements (session config noise)
    if re.match(r'^SET\s+\w+\s*=', stripped):
        continue
    # Strip SELECT pg_catalog.set_config lines
    if re.match(r'^SELECT pg_catalog\.set_config', stripped):
        continue
    # Strip ALTER SEQUENCE ... OWNED BY (TypeORM manages sequences via entities)
    if re.match(r'^ALTER SEQUENCE\s+\S+\s+OWNED BY', stripped):
        continue
    out.append(line)

with open(cleaned_out, 'w') as f:
    f.writelines(out)

print(f"  Kept {len(out)}/{len(lines)} lines after cleaning")

sql = ''.join(out)
# Escape backticks (TypeScript template literal delimiter)
sql = sql.replace('`', '\\`')
# Escape ${...} to prevent TypeScript template literal interpolation
sql = sql.replace('${', '\\${')

generation_date = datetime.date.today().isoformat()

ts_content = f'''/**
 * Embedded schema SQL - generated from pg_dump on {generation_date}
 *
 * This module embeds the complete database schema as a string constant so that
 * the ConsolidatedSchema migration is self-contained and does not depend on an
 * external .sql file at runtime.
 *
 * To regenerate:
 *   bash scripts/dump-schema.sh
 *
 * Post-generation manual steps (see migration-consolidation plan for details):
 *   1. Verify can_access_resource/can_modify_resource: 3-arg versions must precede 2-arg wrappers
 *   2. Run: DB_NAME=perfana_test npm run migration:run  (fresh-DB smoke test)
 *   3. Verify table count matches live DB
 *   4. Run: npm run preflight
 */
export const SCHEMA_SQL = `{sql}`;
'''

with open(ts_out, 'w') as f:
    f.write(ts_content)

print(f"  Written to {ts_out}")
PYEOF

echo "Done. Review the diff before committing:"
echo "  git diff $SCHEMA_FILE | head -80"
echo ""
echo "Post-generation checklist:"
echo "  1. Verify can_access_resource 3-arg precedes 2-arg (grep for 'can_access_resource' in the file)"
echo "  2. Fresh-DB smoke test: DB_NAME=perfana_test npm run migration:run"
echo "  3. npm run preflight"
