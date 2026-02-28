#!/usr/bin/env node
const { execSync } = require('child_process');

const APPLY = process.argv.includes('--apply');

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.stdio || 'pipe' }).trim();
}

function runInherit(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function findLastGoodCommit() {
  // Priority 1: explicit override
  if (process.env.LAST_GOOD_COMMIT && process.env.LAST_GOOD_COMMIT.trim()) {
    return process.env.LAST_GOOD_COMMIT.trim();
  }

  // Priority 2: scan recent commits for known stable checkpoints
  const log = run("git log --pretty=format:%H%x09%s -n 80");
  const lines = log.split('\n').filter(Boolean);
  const patterns = [
    /Day 3 Canary deployment framework/i,
    /Day 2 E2E deep tracking and scenario expansion/i,
    /Day 1 E2E and Policy test integration/i,
    /Zero-Trust and Telemetry patches/i,
    /Canary deployment/i,
    /ci:gate/i,
    /stable/i,
  ];

  for (const line of lines) {
    const [hash, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    if (patterns.some((p) => p.test(subject))) return hash;
  }

  // Fallback: previous commit
  return run('git rev-parse HEAD~1');
}

(function main() {
  try {
    const target = findLastGoodCommit();
    const head = run('git rev-parse --short HEAD');
    const targetShort = run(`git rev-parse --short ${target}`);
    const subject = run(`git show -s --format=%s ${target}`);

    console.log(`[rollback] current HEAD: ${head}`);
    console.log(`[rollback] target commit: ${targetShort} :: ${subject}`);

    if (!APPLY) {
      console.log('[rollback] DRY-RUN mode (default). No state changes applied.');
      console.log('[rollback] Would run:');
      console.log(`  git checkout ${target}`);
      console.log('  npm run build');
      console.log('  pm2 reload ecosystem.config.js');
      process.exit(0);
    }

    runInherit(`git checkout ${target}`);
    runInherit('npm run build');
    runInherit('pm2 reload ecosystem.config.js');

    console.log('[rollback] ✅ rollback applied and services reloaded');
    process.exit(0);
  } catch (e) {
    console.error('[rollback] failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
})();
