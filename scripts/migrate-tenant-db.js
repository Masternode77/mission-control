#!/usr/bin/env node
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);

try {
  const cols = db.prepare("PRAGMA table_info(swarm_tasks)").all();
  const hasTenant = cols.some(c => c.name === 'tenant_id');

  if (!hasTenant) {
    db.exec("ALTER TABLE swarm_tasks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_swarm_tasks_tenant_id ON swarm_tasks(tenant_id)");
    console.log('[migrate-tenant-db] tenant_id column added + index created');
  } else {
    db.exec("CREATE INDEX IF NOT EXISTS idx_swarm_tasks_tenant_id ON swarm_tasks(tenant_id)");
    console.log('[migrate-tenant-db] tenant_id already exists; index ensured');
  }

  const changed = db.prepare("UPDATE swarm_tasks SET tenant_id='default' WHERE tenant_id IS NULL OR tenant_id='' ").run();
  console.log(`[migrate-tenant-db] normalized rows: ${changed.changes}`);
  process.exit(0);
} catch (e) {
  console.error('[migrate-tenant-db] failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  try { db.close(); } catch {}
}
