#!/bin/sh
set -e

echo "Verifying Coolify database..."

COOLIFY_DB_URL="postgres://core_open:2477fM_f8TDKMkYmqDHLDnieDYJkcxsv@xfhfxgfl3hk2oii3rxj52bew:5432/core_open"

export PGPASSWORD="2477fM_f8TDKMkYmqDHLDnieDYJkcxsv"

echo "Listing tables in public schema:"
psql "$COOLIFY_DB_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

echo ""
echo "Row counts for key tables:"
psql "$COOLIFY_DB_URL" -c "
SELECT 
  schemaname,
  relname as table_name,
  n_live_tup as row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
"

echo ""
echo "Verification complete!"