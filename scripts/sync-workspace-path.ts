import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const repoRoot = process.cwd();
const dbPath = path.join(repoRoot, 'mission-control.db');
const envPath = path.join(repoRoot, '.env.local');

const targetBasePath = process.argv[2] || '/Users/josh/.openclaw/workspace';
const targetProjectsPath = process.argv[3] || path.join(targetBasePath, 'PROJECTS');

function upsertEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) return content.replace(regex, line);
  return `${content.trim()}\n${line}\n`;
}

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
env = upsertEnv(env, 'WORKSPACE_BASE_PATH', targetBasePath);
env = upsertEnv(env, 'PROJECTS_PATH', targetProjectsPath);
fs.writeFileSync(envPath, env, 'utf8');
console.log('[sync-workspace-path] Updated .env.local');

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

const upsert = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);

upsert.run('workspaceBasePath', targetBasePath);
upsert.run('projectsPath', targetProjectsPath);

console.log('[sync-workspace-path] Updated app_settings table');
console.log(`[sync-workspace-path] WORKSPACE_BASE_PATH=${targetBasePath}`);
console.log(`[sync-workspace-path] PROJECTS_PATH=${targetProjectsPath}`);

db.close();
