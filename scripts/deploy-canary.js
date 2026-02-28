#!/usr/bin/env node
const { execSync } = require('child_process');

const CANARY_URL = process.env.CANARY_URL || 'http://127.0.0.1:3006';

function run(cmd) {
  console.log(`[deploy-canary] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

async function waitForHealth(url, timeoutMs = 30000) {
  const start = Date.now();
  const endpoints = ['/api/openclaw/status', '/api/workspaces'];

  while (Date.now() - start < timeoutMs) {
    let allOk = true;
    for (const ep of endpoints) {
      try {
        const res = await fetch(`${url}${ep}`);
        if (!res.ok) {
          allOk = false;
          break;
        }
      } catch {
        allOk = false;
        break;
      }
    }
    if (allOk) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }

  return false;
}

(async function main() {
  try {
    run('npm run build');
    run('pm2 start ecosystem.config.js --only mission-control-canary');

    const healthy = await waitForHealth(CANARY_URL, 40000);
    if (!healthy) {
      console.error('[deploy-canary] ❌ Canary health check failed');
      process.exit(1);
    }

    console.log('[deploy-canary] ✅ Canary health check passed');
    process.exit(0);
  } catch (error) {
    console.error('[deploy-canary] failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
