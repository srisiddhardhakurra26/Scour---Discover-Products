#!/bin/sh
set -e

# Apply any pending migrations to the SQLite file on the persistent volume
# (DATABASE_URL points there, e.g. file:/data/scour.db).
echo "[scour] applying database migrations…"
npx prisma migrate deploy

# Seed the default retailers. The seed is idempotent (upsert), so it's safe to
# run on every boot; a fresh volume gets its sources, an existing one is left
# as-is. Non-fatal so a seed hiccup never blocks startup.
echo "[scour] seeding default retailers…"
npx tsx prisma/seed.ts || echo "[scour] seed skipped"

echo "[scour] starting Next.js on :${PORT:-3000}"
exec npm run start -- -H 0.0.0.0 -p "${PORT:-3000}"
