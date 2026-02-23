#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
EXECUTOR_FILE="$ROOT/src/lib/swarm-executor.ts"

# 1) Ensure NEXT_PUBLIC_BASE_URL exists (replace if exists, append if not)
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^NEXT_PUBLIC_BASE_URL=' "$ENV_FILE"; then
    awk 'BEGIN{done=0} /^NEXT_PUBLIC_BASE_URL=/{if(!done){print "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3005"; done=1} next} {print} END{if(!done) print "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3005"}' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '\nNEXT_PUBLIC_BASE_URL=http://127.0.0.1:3005\n' >> "$ENV_FILE"
  fi
else
  cat > "$ENV_FILE" <<'EOV'
NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3005
EOV
fi

# 2) Patch executor deep-link base URL + metadata column check
python3 - <<'PY'
from pathlib import Path
p = Path("/Users/josh/.openclaw/workspace/mission-control/src/lib/swarm-executor.ts")
s = p.read_text()

if "function resolvePublicBaseUrl()" not in s:
    insert_after = "const TELEGRAM_CHUNK_SIZE = 4000;\n"
    helper = """

function resolvePublicBaseUrl() {
  const base = String(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005').trim();
  return base.replace(/\/$/, '');
}
"""
    s = s.replace(insert_after, insert_after + helper)

s = s.replace(
"  const deepLink = `\\n\\n🔗 대시보드에서 확인하기: http://127.0.0.1:3005/workspace/default?taskId=${taskId}`;",
"  const baseUrl = resolvePublicBaseUrl();\n  const deepLink = `\\n\\n🔗 대시보드에서 확인하기: ${baseUrl}/workspace/default?taskId=${taskId}`;"
)

s = s.replace(
"  const hasMetadataColumn = !!queryOne<{ exists: number }>(\n    `SELECT 1 as exists FROM pragma_table_info('swarm_tasks') WHERE name = 'metadata' LIMIT 1`\n  );",
"  const hasMetadataColumn = queryAll<{ name: string }>(\"PRAGMA table_info(swarm_tasks)\").some((c) => c.name === 'metadata');"
)

s = s.replace("import { run, queryOne, queryAll } from '@/lib/db';", "import { run, queryAll } from '@/lib/db';")

p.write_text(s)
PY

echo "[ok] dynamic base URL architecture applied"
