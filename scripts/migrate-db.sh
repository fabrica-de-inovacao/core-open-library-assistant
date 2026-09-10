#!/bin/sh
set -e

echo "Starting database migration..."

EXTERNAL_DB_URL="postgres://coreola:wg6c2beMz4IkA9gNsMISjg7nANZLtepUIGoR4tQ1vnDS976ZvTYb1Ae1JtDNgSC4@100.80.242.75:5457/coreola"
COOLIFY_DB_URL="postgres://core_open:2477fM_f8TDKMkYmqDHLDnieDYJkcxsv@xfhfxgfl3hk2oii3rxj52bew:5432/core_open"

DUMP_FILE="/tmp/external_db_dump.sql"

echo "Dumping external database..."
export PGPASSWORD="wg6c2beMz4IkA9gNsMISjg7nANZLtepUIGoR4tQ1vnDS976ZvTYb1Ae1JtDNgSC4"
pg_dump "$EXTERNAL_DB_URL" --no-owner --no-privileges --clean --if-exists > "$DUMP_FILE"

echo "External database dumped successfully. Restoring to Coolify database..."

export PGPASSWORD="2477fM_f8TDKMkYmqDHLDnieDYJkcxsv"
psql "$COOLIFY_DB_URL" -f "$DUMP_FILE"

echo "Migration completed successfully!"